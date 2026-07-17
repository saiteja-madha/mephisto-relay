import unittest

import chess

from server.monitor import PlaywrightMonitor


class PositionParsingTests(unittest.TestCase):
    def test_builds_position_from_san_history(self):
        board = PlaywrightMonitor._board_from_snapshot(
            {
                "moves": ["e4", "e5", "Nf3"],
                "pieces": [],
                "turn": "black",
            }
        )
        self.assertEqual(board.turn, chess.BLACK)
        self.assertEqual(board.piece_at(chess.F3).symbol(), "N")
        self.assertEqual(board.piece_at(chess.E5).symbol(), "p")

    def test_falls_back_to_piece_snapshot_for_invalid_san(self):
        board = PlaywrightMonitor._board_from_snapshot(
            {
                "moves": ["not-a-move"],
                "pieces": [
                    {"color": "w", "type": "k", "square": "e1"},
                    {"color": "b", "type": "k", "square": "e8"},
                    {"color": "b", "type": "q", "square": "a3"},
                ],
                "turn": "white",
            }
        )
        self.assertEqual(board.turn, chess.WHITE)
        self.assertEqual(board.piece_at(chess.A3).symbol(), "q")


if __name__ == "__main__":
    unittest.main()
