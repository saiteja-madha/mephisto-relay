import asyncio
from concurrent.futures import Future
from dataclasses import dataclass, field
import json
import logging
from pathlib import Path
from queue import Queue
import threading
import time
from typing import Optional
from uuid import uuid4

import chess
from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from .domain import GameTarget, build_analysis_payload
from .browser_launcher import cdp_is_reachable, local_cdp_address
from .engine_client import RemoteEngineClient
from .svg_renderer import render_analysis_svg

LOGGER = logging.getLogger(__name__)


@dataclass
class MonitoringSession:
    target: GameTarget
    id: str = field(default_factory=lambda: uuid4().hex)
    stopped: threading.Event = field(default_factory=threading.Event)
    subscribers: set[Queue] = field(default_factory=set)
    latest_event: dict = field(default_factory=lambda: {"type": "connecting"})
    latest_svg: Optional[bytes] = None
    latest_player_svg: Optional[bytes] = None
    version: int = 0
    task: Optional[Future] = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def publish(self, event: dict):
        event = {**event, "sessionId": self.id, "timestamp": int(time.time() * 1000)}
        with self.lock:
            self.latest_event = event
            subscribers = tuple(self.subscribers)
        LOGGER.debug("Session %s event: %s", self.id, event)
        for subscriber in subscribers:
            subscriber.put(event)

    def subscribe(self) -> Queue:
        subscriber = Queue()
        with self.lock:
            self.subscribers.add(subscriber)
            subscriber.put(self.latest_event)
        return subscriber

    def unsubscribe(self, subscriber: Queue):
        with self.lock:
            self.subscribers.discard(subscriber)

    def set_analysis_images(self, image: bytes, player_image: bytes) -> int:
        with self.lock:
            self.latest_svg = image
            self.latest_player_svg = player_image
            self.version += 1
            return self.version


class SessionRegistry:
    def __init__(self):
        self._sessions: dict[str, MonitoringSession] = {}
        self._lock = threading.Lock()

    def add(self, session: MonitoringSession):
        with self._lock:
            self._sessions[session.id] = session

    def get(self, session_id: str) -> Optional[MonitoringSession]:
        with self._lock:
            return self._sessions.get(session_id)

    def stop(self, session_id: str) -> Optional[MonitoringSession]:
        session = self.get(session_id)
        if session:
            session.stopped.set()
        return session


class PlaywrightMonitor:
    """Owns one always-on CDP connection and all monitored game tabs."""

    def __init__(
        self,
        cdp_url: str,
        engine: RemoteEngineClient,
        adapter_path: Path,
        storage_state_path: Optional[Path] = None,
        poll_interval: float = 0.25,
    ):
        self.cdp_url = cdp_url
        self.engine = engine
        self.adapter_path = adapter_path
        self.storage_state_path = storage_state_path
        self.poll_interval = poll_interval
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._started = threading.Event()
        self._shutdown = threading.Event()
        self._attach_failures = 0
        self._thread = threading.Thread(
            target=self._thread_main, name="playwright-monitor", daemon=True
        )

    def start(self):
        if self._thread.is_alive():
            return
        self._thread.start()
        if not self._started.wait(timeout=5):
            raise RuntimeError("Playwright monitor event loop did not start")

    def start_session(self, session: MonitoringSession):
        self.start()
        session.publish(
            {
                "type": "connecting",
                "gameId": session.target.game_id,
                "message": "Waiting for the Playwright browser connection",
            }
        )
        session.task = asyncio.run_coroutine_threadsafe(self._monitor_session(session), self._loop)

    def close(self):
        self._shutdown.set()

    def _thread_main(self):
        asyncio.run(self._run())

    async def _run(self):
        self._loop = asyncio.get_running_loop()
        self._started.set()
        async with async_playwright() as playwright:
            connection_task = asyncio.create_task(self._maintain_connection(playwright))
            while not self._shutdown.is_set():
                await asyncio.sleep(0.25)
            connection_task.cancel()
            await asyncio.gather(connection_task, return_exceptions=True)

    async def _maintain_connection(self, playwright):
        retry_delay = 1
        while not self._shutdown.is_set():
            disconnected = asyncio.get_running_loop().create_future()
            try:
                LOGGER.info("Connecting Playwright to CDP endpoint %s", self.cdp_url)
                browser = await playwright.chromium.connect_over_cdp(self.cdp_url)
                context = browser.contexts[0] if browser.contexts else await browser.new_context()
                if self.storage_state_path and self.storage_state_path.is_file():
                    LOGGER.info("Loading Chess.com login state from %s", self.storage_state_path)
                    await self._load_storage_state(context)
                else:
                    LOGGER.warning(
                        "No saved Chess.com login state found at %s; using the browser's default context",
                        self.storage_state_path,
                    )
                self._context = context
                self._browser = browser
                self._attach_failures = 0
                retry_delay = 1
                LOGGER.info("Playwright CDP connection established")

                def on_disconnected(*_):
                    if not disconnected.done():
                        disconnected.set_result(None)

                browser.on("disconnected", on_disconnected)
                await disconnected
                LOGGER.warning("Playwright CDP connection disconnected")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._attach_failures += 1
                local_address = local_cdp_address(self.cdp_url)
                endpoint_reachable = bool(
                    local_address and await asyncio.to_thread(cdp_is_reachable, *local_address)
                )
                if endpoint_reachable:
                    LOGGER.warning(
                        "CDP endpoint is reachable, but Playwright attach attempt %s failed (%s); retrying",
                        self._attach_failures,
                        exc,
                    )
                elif local_address:
                    LOGGER.error(
                        "CDP endpoint %s is unavailable; run `python server/scripts/launch_browser.py` "
                        "and leave that browser running",
                        self.cdp_url,
                    )
                else:
                    LOGGER.error(
                        "Unable to connect to remote Playwright CDP endpoint %s (%s)",
                        self.cdp_url,
                        exc,
                    )
            finally:
                self._browser = None
                self._context = None

            if not self._shutdown.is_set():
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 15)

    async def _load_storage_state(self, context: BrowserContext):
        state = json.loads(self.storage_state_path.read_text())
        cookies = state.get("cookies") or []
        if cookies:
            await context.add_cookies(cookies)

        origin_state = {
            item["origin"]: item.get("localStorage") or [] for item in state.get("origins") or []
        }
        if origin_state:
            serialized_state = json.dumps(origin_state)
            await context.add_init_script(script=f"""
                (() => {{
                    const states = {serialized_state};
                    for (const item of (states[window.location.origin] || [])) {{
                        window.localStorage.setItem(item.name, item.value);
                    }}
                }})();
            """)

    async def _wait_for_browser(self, session: MonitoringSession) -> Optional[Browser]:
        while not session.stopped.is_set() and not self._shutdown.is_set():
            if self._browser and self._browser.is_connected():
                return self._browser
            await asyncio.sleep(0.25)
        return None

    async def _monitor_session(self, session: MonitoringSession):
        page = None
        while not session.stopped.is_set() and not self._shutdown.is_set():
            browser = await self._wait_for_browser(session)
            if not browser:
                break
            try:
                context = self._context
                if not context:
                    await asyncio.sleep(0.25)
                    continue
                page = await context.new_page()
                LOGGER.info("Session %s opening %s", session.id, session.target.url)
                await page.add_init_script(path=str(self.adapter_path))
                await page.goto(session.target.url, wait_until="domcontentloaded", timeout=45_000)
                await page.wait_for_function(
                    "window.MephistoChessComAdapter && window.MephistoChessComAdapter.getBoard()",
                    timeout=45_000,
                )
                session.publish(
                    {
                        "type": "monitoring",
                        "gameId": session.target.game_id,
                        "playerColor": session.target.player_color,
                        "opponentColor": session.target.opponent_color,
                        "message": "Game detected; waiting for analysis",
                    }
                )
                await self._poll_page(session, page)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                if not session.stopped.is_set():
                    LOGGER.exception("Session %s monitor failed", session.id)
                    session.publish(
                        {
                            "type": "reconnecting",
                            "message": f"Browser monitor interrupted: {exc}",
                        }
                    )
                    await asyncio.sleep(1)
            finally:
                if page:
                    try:
                        await page.close()
                    except Exception:
                        LOGGER.debug(
                            "Unable to close page for session %s",
                            session.id,
                            exc_info=True,
                        )
                    page = None

        session.publish({"type": "stopped", "message": "Monitoring stopped"})

    async def _poll_page(self, session: MonitoringSession, page: Page):
        last_fen = None
        last_failed_at = 0.0
        while not session.stopped.is_set():
            snapshot = await page.evaluate("window.MephistoChessComAdapter.snapshot()")
            if not snapshot or snapshot.get("animating"):
                await asyncio.sleep(self.poll_interval)
                continue

            board = self._board_from_snapshot(snapshot)
            fen = board.fen()
            retry_failed = (
                fen == last_fen and last_failed_at > 0 and time.monotonic() - last_failed_at >= 5
            )
            if fen != last_fen or retry_failed:
                last_fen = fen
                try:
                    result = await asyncio.to_thread(self.engine.analyse, fen)
                    if session.stopped.is_set():
                        break
                    best_move = result.get("bestmove", "(none)")
                    response_move = result.get("threat", "(none)")
                    side_to_move = "white" if board.turn == chess.WHITE else "black"
                    payload = build_analysis_payload(
                        session.target,
                        side_to_move,
                        best_move,
                        response_move,
                    )
                    svg = render_analysis_svg(
                        fen,
                        session.target.player_color,
                        best_move,
                        response_move,
                    )
                    player_move = best_move if payload["turn"] == "player" else "(none)"
                    player_svg = render_analysis_svg(
                        fen,
                        session.target.player_color,
                        player_move,
                        "(none)",
                    )
                    version = session.set_analysis_images(svg, player_svg)
                    lines = result.get("lines") or [{}]
                    payload.update(
                        {
                            "fen": fen,
                            "imageUrl": f"/api/sessions/{session.id}/latest.svg?v={version}",
                            "playerImageUrl": f"/api/sessions/{session.id}/latest-player.svg?v={version}",
                            "evaluation": lines[0],
                        }
                    )
                    session.publish(payload)
                    last_failed_at = 0.0
                    LOGGER.info(
                        "Session %s: %s to move, %s then %s",
                        session.id,
                        side_to_move,
                        best_move,
                        response_move,
                    )
                except Exception as exc:
                    last_failed_at = time.monotonic()
                    LOGGER.exception("Session %s analysis failed", session.id)
                    session.publish(
                        {
                            "type": "analysis-error",
                            "message": str(exc),
                            "retrying": True,
                        }
                    )
            await asyncio.sleep(self.poll_interval)

    @staticmethod
    def _board_from_snapshot(snapshot: dict) -> chess.Board:
        board = chess.Board()
        try:
            for notation in snapshot.get("moves", []):
                if notation in {"1-0", "0-1", "1/2-1/2", "*"}:
                    continue
                board.push_san(notation)
            pieces = snapshot.get("pieces") or []
            expected = {
                chess.parse_square(item["square"]): (
                    item["type"].upper() if item["color"] == "w" else item["type"].lower()
                )
                for item in pieces
            }
            observed = {square: piece.symbol() for square, piece in board.piece_map().items()}
            if not pieces or observed == expected:
                return board
            LOGGER.warning("SAN position differs from the board DOM; using piece snapshot")
        except ValueError:
            LOGGER.warning(
                "Could not parse SAN move list %s; using piece snapshot",
                snapshot.get("moves"),
            )

        board.clear()
        for item in snapshot.get("pieces", []):
            symbol = item["type"].upper() if item["color"] == "w" else item["type"].lower()
            board.set_piece_at(chess.parse_square(item["square"]), chess.Piece.from_symbol(symbol))
        board.turn = chess.WHITE if snapshot.get("turn") == "white" else chess.BLACK
        board.clear_stack()
        return board
