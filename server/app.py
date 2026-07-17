import json
import logging
import os
from pathlib import Path
from queue import Empty

from flask import (
    Flask,
    Response,
    jsonify,
    request,
    send_from_directory,
    stream_with_context,
)

from .domain import normalize_game_target
from .engine_client import RemoteEngineClient
from .monitor import MonitoringSession, PlaywrightMonitor, SessionRegistry

ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = Path(__file__).resolve().parent / "static"
LOGGER = logging.getLogger(__name__)


def create_app(start_monitor: bool = True) -> Flask:
    app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
    registry = SessionRegistry()
    engine = RemoteEngineClient(
        os.environ.get("MEPHISTO_ENGINE_URL", "http://127.0.0.1:9090"),
        int(os.environ.get("MEPHISTO_COMPUTE_TIME_MS", "1500")),
    )
    monitor = PlaywrightMonitor(
        cdp_url=os.environ.get("PLAYWRIGHT_CDP_URL", "http://127.0.0.1:9222"),
        engine=engine,
        adapter_path=ROOT / "src" / "scripts" / "chesscom-adapter.js",
        storage_state_path=Path(
            os.environ.get(
                "MEPHISTO_STORAGE_STATE",
                ROOT / "server" / ".auth" / "chesscom-storage-state.json",
            )
        ),
        poll_interval=float(os.environ.get("MEPHISTO_POLL_INTERVAL", "0.25")),
    )
    app.extensions["mephisto_registry"] = registry
    app.extensions["mephisto_monitor"] = monitor

    if start_monitor:
        monitor.start()

    @app.after_request
    def add_api_headers(response):
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/")
    def index():
        return send_from_directory(STATIC_DIR, "index.html")

    @app.get("/assets/<path:filename>")
    def assets(filename):
        return send_from_directory(ROOT / "res", filename)

    @app.post("/api/sessions")
    def create_session():
        data = request.get_json(silent=True) or {}
        try:
            target = normalize_game_target(data.get("gameId"), data.get("color"))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        session = MonitoringSession(target=target)
        registry.add(session)
        monitor.start_session(session)
        LOGGER.info(
            "Created session %s for game %s as %s",
            session.id,
            target.game_id,
            target.player_color,
        )
        return (
            jsonify(
                {
                    "sessionId": session.id,
                    "gameId": target.game_id,
                    "playerColor": target.player_color,
                    "opponentColor": target.opponent_color,
                    "eventsUrl": f"/api/sessions/{session.id}/events",
                }
            ),
            201,
        )

    @app.get("/api/sessions/<session_id>/events")
    def session_events(session_id):
        session = registry.get(session_id)
        if not session:
            return jsonify({"error": "session not found"}), 404
        subscriber = session.subscribe()

        @stream_with_context
        def generate():
            try:
                while True:
                    try:
                        event = subscriber.get(timeout=15)
                        yield f"event: {event.get('type', 'message')}\n"
                        yield f"data: {json.dumps(event, separators=(',', ':'))}\n\n"
                        if event.get("type") == "stopped":
                            break
                    except Empty:
                        yield ": heartbeat\n\n"
            finally:
                session.unsubscribe(subscriber)

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @app.get("/api/sessions/<session_id>/latest.svg")
    def latest_image(session_id):
        session = registry.get(session_id)
        if not session:
            return jsonify({"error": "session not found"}), 404
        with session.lock:
            image = session.latest_svg
        if image is None:
            return jsonify({"error": "analysis image is not ready"}), 404
        return Response(image, mimetype="image/svg+xml")

    @app.get("/api/sessions/<session_id>/latest-player.svg")
    def latest_player_image(session_id):
        session = registry.get(session_id)
        if not session:
            return jsonify({"error": "session not found"}), 404
        with session.lock:
            image = session.latest_player_svg
        if image is None:
            return jsonify({"error": "analysis image is not ready"}), 404
        return Response(image, mimetype="image/svg+xml")

    @app.delete("/api/sessions/<session_id>")
    def stop_session(session_id):
        session = registry.stop(session_id)
        if not session:
            return jsonify({"error": "session not found"}), 404
        LOGGER.info("Stopping session %s", session_id)
        return "", 204

    return app


if __name__ == "__main__":
    logging.basicConfig(
        level=getattr(
            logging,
            os.environ.get("MEPHISTO_LOG_LEVEL", "DEBUG").upper(),
            logging.DEBUG,
        ),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    create_app().run(
        host=os.environ.get("MEPHISTO_HOST", "127.0.0.1"),
        port=int(os.environ.get("MEPHISTO_PORT", "8080")),
        threaded=True,
        use_reloader=False,
    )
