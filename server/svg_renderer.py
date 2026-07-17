from base64 import b64encode
from functools import lru_cache
from html import escape
from pathlib import Path

BOARD_SIZE = 560
SQUARE_SIZE = BOARD_SIZE // 8
PIECE_ROOT = Path(__file__).resolve().parents[1] / "res" / "chesspieces" / "neo"


@lru_cache(maxsize=12)
def _piece_data_url(piece: str) -> str:
    image = (PIECE_ROOT / f"{piece}.png").read_bytes()
    return "data:image/png;base64," + b64encode(image).decode("ascii")


def _pieces_from_fen(fen: str):
    ranks = fen.split()[0].split("/")
    if len(ranks) != 8:
        raise ValueError("invalid FEN")
    for rank_index, rank in enumerate(ranks):
        file_index = 0
        for token in rank:
            if token.isdigit():
                file_index += int(token)
            else:
                color = "w" if token.isupper() else "b"
                yield color + token.upper(), file_index, rank_index
                file_index += 1
        if file_index != 8:
            raise ValueError("invalid FEN rank")


def _display_square(square: str, orientation: str):
    file_index = ord(square[0]) - ord("a")
    rank_index = int(square[1]) - 1
    if orientation == "white":
        return file_index, 7 - rank_index
    return 7 - file_index, rank_index


def _arrow(move: str, orientation: str, color: str, marker: str):
    if not move or move == "(none)" or len(move) < 4 or "@" in move:
        return ""
    start_x, start_y = _display_square(move[:2], orientation)
    end_x, end_y = _display_square(move[2:4], orientation)
    x1 = (start_x + 0.5) * SQUARE_SIZE
    y1 = (start_y + 0.5) * SQUARE_SIZE
    x2 = (end_x + 0.5) * SQUARE_SIZE
    y2 = (end_y + 0.5) * SQUARE_SIZE
    return (
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
        f'stroke="{color}" stroke-width="8" stroke-linecap="round" '
        f'opacity="0.72" marker-end="url(#{marker})" />'
    )


def render_analysis_svg(
    fen: str,
    orientation: str,
    primary_move: str,
    response_move: str,
) -> bytes:
    orientation = "black" if orientation == "black" else "white"
    pieces = list(_pieces_from_fen(fen))
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{BOARD_SIZE}" height="{BOARD_SIZE}" '
        f'viewBox="0 0 {BOARD_SIZE} {BOARD_SIZE}" role="img" '
        f'aria-label="Best move {escape(primary_move)}; response {escape(response_move)}">',
        "<defs>",
        '<marker id="best-arrow" markerUnits="userSpaceOnUse" markerWidth="22" markerHeight="22" '
        'refX="18" refY="11" orient="auto"><path d="M0,0 L0,22 L22,11 z" fill="#1769d2" /></marker>',
        '<marker id="response-arrow" markerUnits="userSpaceOnUse" markerWidth="22" markerHeight="22" '
        'refX="18" refY="11" orient="auto"><path d="M0,0 L0,22 L22,11 z" fill="#d64a3a" /></marker>',
    ]
    for piece in sorted({item[0] for item in pieces}):
        parts.append(
            f'<image id="piece-{piece}" href="{_piece_data_url(piece)}" '
            f'width="{SQUARE_SIZE - 6}" height="{SQUARE_SIZE - 6}" />'
        )
    parts.append("</defs>")

    for row in range(8):
        for column in range(8):
            color = "#eed9b5" if (row + column) % 2 == 0 else "#b58863"
            parts.append(
                f'<rect x="{column * SQUARE_SIZE}" y="{row * SQUARE_SIZE}" '
                f'width="{SQUARE_SIZE}" height="{SQUARE_SIZE}" fill="{color}" />'
            )

    for piece, file_index, rank_index in pieces:
        if orientation == "black":
            file_index = 7 - file_index
            rank_index = 7 - rank_index
        parts.append(
            f'<use href="#piece-{piece}" x="{file_index * SQUARE_SIZE + 3}" '
            f'y="{rank_index * SQUARE_SIZE + 3}" />'
        )

    parts.append(_arrow(primary_move, orientation, "#1769d2", "best-arrow"))
    parts.append(_arrow(response_move, orientation, "#d64a3a", "response-arrow"))
    parts.append("</svg>")
    return "".join(parts).encode("utf-8")
