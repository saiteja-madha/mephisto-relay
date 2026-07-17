import unittest
from unittest.mock import Mock

from server.app import create_app


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(start_monitor=False)
        self.app.config.update(TESTING=True)
        self.monitor = self.app.extensions["mephisto_monitor"]
        self.monitor.start_session = Mock()
        self.client = self.app.test_client()

    def create_session(self):
        response = self.client.post(
            "/api/sessions",
            json={"gameId": "123456789", "color": "white"},
        )
        self.assertEqual(response.status_code, 201)
        return response.get_json()["sessionId"]

    def test_create_session_normalizes_input_and_starts_monitor(self):
        session_id = self.create_session()
        self.assertTrue(session_id)
        self.monitor.start_session.assert_called_once()
        session = self.monitor.start_session.call_args.args[0]
        self.assertEqual(session.target.url, "https://www.chess.com/game/123456789")
        self.assertEqual(session.target.opponent_color, "black")

    def test_invalid_session_request_returns_400(self):
        response = self.client.post(
            "/api/sessions",
            json={"gameId": "https://example.com/game/1", "color": "white"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.get_json())

    def test_latest_svg_and_stop_routes(self):
        session_id = self.create_session()
        registry = self.app.extensions["mephisto_registry"]
        session = registry.get(session_id)
        session.set_analysis_images(b"<svg id='all'></svg>", b"<svg id='player'></svg>")

        image_response = self.client.get(f"/api/sessions/{session_id}/latest.svg")
        self.assertEqual(image_response.status_code, 200)
        self.assertEqual(image_response.mimetype, "image/svg+xml")

        player_response = self.client.get(f"/api/sessions/{session_id}/latest-player.svg")
        self.assertEqual(player_response.status_code, 200)
        self.assertIn(b"player", player_response.data)

        stop_response = self.client.delete(f"/api/sessions/{session_id}")
        self.assertEqual(stop_response.status_code, 204)
        self.assertTrue(session.stopped.is_set())

    def test_unknown_session_returns_404(self):
        response = self.client.get("/api/sessions/missing/latest.svg")
        self.assertEqual(response.status_code, 404)

    def test_sse_uses_named_events(self):
        session_id = self.create_session()
        registry = self.app.extensions["mephisto_registry"]
        registry.get(session_id).publish({"type": "stopped", "message": "done"})
        response = self.client.get(f"/api/sessions/{session_id}/events")
        body = response.get_data(as_text=True)
        self.assertIn("event: stopped", body)
        self.assertIn('"message":"done"', body)


if __name__ == "__main__":
    unittest.main()
