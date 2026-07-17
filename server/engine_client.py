import json
import logging
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

LOGGER = logging.getLogger(__name__)


class RemoteEngineClient:
    """Small client for the repository's existing remote-engine.py server."""

    def __init__(self, base_url: str, compute_time_ms: int = 1500):
        self.analyse_url = base_url.rstrip("/") + "/analyse"
        self.compute_time_ms = compute_time_ms

    def analyse(self, fen: str) -> dict:
        body = json.dumps({"fen": fen, "time": self.compute_time_ms}).encode("utf-8")
        request = Request(
            self.analyse_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        LOGGER.debug("Requesting engine analysis for FEN %s", fen)
        try:
            with urlopen(request, timeout=max(10, self.compute_time_ms / 1000 + 5)) as response:
                result = json.loads(response.read())
        except HTTPError as exc:
            response_body = exc.read().decode("utf-8", errors="replace")
            try:
                error_data = json.loads(response_body)
                detail = error_data.get("error") or response_body
                error_type = error_data.get("type")
                if error_type:
                    detail = f"{error_type}: {detail}"
            except json.JSONDecodeError:
                detail = response_body.strip() or str(exc)
            raise RuntimeError(f"engine request failed (HTTP {exc.code}): {detail}") from exc
        except (URLError, TimeoutError) as exc:
            raise RuntimeError(f"engine request failed: {exc}") from exc

        best_move = result.get("bestmove", "(none)")
        response_move = result.get("threat", "(none)")
        return {
            **result,
            "bestmove": best_move,
            "threat": response_move,
        }
