import unittest

from server.svg_renderer import render_analysis_svg

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


class SvgRendererTests(unittest.TestCase):
    def test_renders_board_pieces_and_two_arrows(self):
        svg = render_analysis_svg(START_FEN, "white", "e2e4", "e7e5").decode()
        self.assertTrue(svg.startswith("<svg"))
        self.assertEqual(svg.count("<rect "), 64)
        self.assertEqual(svg.count("<use "), 32)
        self.assertEqual(svg.count("<line "), 2)
        self.assertIn('id="piece-wK" href="data:image/png;base64,', svg)
        self.assertIn('marker-end="url(#best-arrow)"', svg)
        self.assertIn('marker-end="url(#response-arrow)"', svg)
        self.assertIn('markerUnits="userSpaceOnUse" markerWidth="22"', svg)
        self.assertIn('stroke-width="8"', svg)

    def test_black_orientation_flips_piece_coordinates(self):
        white_svg = render_analysis_svg(START_FEN, "white", "e2e4", "e7e5").decode()
        black_svg = render_analysis_svg(START_FEN, "black", "e2e4", "e7e5").decode()
        self.assertIn('href="#piece-wR" x="3" y="493"', white_svg)
        self.assertIn('href="#piece-wR" x="493" y="3"', black_svg)

    def test_terminal_move_omits_arrow(self):
        svg = render_analysis_svg(START_FEN, "white", "(none)", "(none)").decode()
        self.assertNotIn("<line ", svg)


if __name__ == "__main__":
    unittest.main()
