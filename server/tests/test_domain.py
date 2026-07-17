import unittest

from server.domain import build_analysis_payload, normalize_game_target


class NormalizeGameTargetTests(unittest.TestCase):
    def test_accepts_game_id(self):
        target = normalize_game_target("123456789", "White")
        self.assertEqual(target.game_id, "123456789")
        self.assertEqual(target.url, "https://www.chess.com/game/123456789")
        self.assertEqual(target.player_color, "white")
        self.assertEqual(target.opponent_color, "black")

    def test_accepts_supported_chess_com_urls(self):
        direct = normalize_game_target("https://www.chess.com/game/abc-123", "black")
        live = normalize_game_target("https://chess.com/game/live/98765?tab=analysis", "white")
        self.assertEqual(direct.game_id, "abc-123")
        self.assertEqual(live.game_id, "98765")

    def test_rejects_non_chess_com_url(self):
        with self.assertRaisesRegex(ValueError, "www.chess.com"):
            normalize_game_target("https://example.com/game/123", "white")

    def test_rejects_invalid_color(self):
        with self.assertRaisesRegex(ValueError, "color"):
            normalize_game_target("123", "green")


class AnalysisPayloadTests(unittest.TestCase):
    def test_player_turn_labels_are_explicit(self):
        target = normalize_game_target("123", "white")
        result = build_analysis_payload(target, "white", "e2e4", "e7e5")
        self.assertEqual(result["turn"], "player")
        self.assertEqual(result["primaryLabel"], "Your best move")
        self.assertEqual(result["responseLabel"], "Opponent's best response")
        self.assertEqual(result["primaryMoveOwner"], "player")

    def test_opponent_turn_labels_are_explicit(self):
        target = normalize_game_target("123", "white")
        result = build_analysis_payload(target, "black", "e7e5", "g1f3")
        self.assertEqual(result["turn"], "opponent")
        self.assertEqual(result["primaryLabel"], "Opponent to move — best move")
        self.assertEqual(result["responseLabel"], "Your best response")
        self.assertEqual(result["primaryMoveOwner"], "opponent")


if __name__ == "__main__":
    unittest.main()
