from functools import lru_cache
from hashlib import blake2s
from html import escape
from pathlib import Path
from xml.etree import ElementTree

BOARD_SIZE = 560
SQUARE_SIZE = BOARD_SIZE // 8
PIECE_ROOT = Path(__file__).resolve().parents[1] / "res" / "chesspieces" / "riohacha"

ElementTree.register_namespace("", "http://www.w3.org/2000/svg")


@lru_cache(maxsize=12)
def _piece_vector(piece: str) -> tuple[str, str]:
    root = ElementTree.parse(PIECE_ROOT / f"{piece}.svg").getroot()
    view_box = root.attrib.get("viewBox")
    if not view_box:
        raise ValueError(f"piece {piece} does not define a viewBox")
    contents = "".join(ElementTree.tostring(child, encoding="unicode") for child in root)
    contents = contents.replace(' xmlns="http://www.w3.org/2000/svg"', "")
    return view_box, contents


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
    render_token = blake2s(
        f"{fen}|{orientation}|{primary_move}|{response_move}".encode(), digest_size=4
    ).hexdigest()
    best_marker = f"best-arrow-{render_token}"
    response_marker = f"response-arrow-{render_token}"
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{BOARD_SIZE}" height="{BOARD_SIZE}" '
        f'viewBox="0 0 {BOARD_SIZE} {BOARD_SIZE}" role="img" '
        f'aria-label="Best move {escape(primary_move)}; response {escape(response_move)}">',
        "<defs>",
        f'<marker id="{best_marker}" markerUnits="userSpaceOnUse" markerWidth="22" markerHeight="22" '
        'refX="18" refY="11" orient="auto"><path d="M0,0 L0,22 L22,11 z" fill="#1769d2" /></marker>',
        f'<marker id="{response_marker}" markerUnits="userSpaceOnUse" markerWidth="22" markerHeight="22" '
        'refX="18" refY="11" orient="auto"><path d="M0,0 L0,22 L22,11 z" fill="#d64a3a" /></marker>',
    ]
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
        view_box, contents = _piece_vector(piece)
        parts.append(
            f'<svg x="{file_index * SQUARE_SIZE + 3}" y="{rank_index * SQUARE_SIZE + 3}" '
            f'width="{SQUARE_SIZE - 6}" height="{SQUARE_SIZE - 6}" '
            f'viewBox="{view_box}" preserveAspectRatio="xMidYMid meet">'
            f"{contents}</svg>"
        )

    parts.append(_arrow(primary_move, orientation, "#1769d2", best_marker))
    parts.append(_arrow(response_move, orientation, "#d64a3a", response_marker))
    parts.append("</svg>")
    return "".join(parts).encode("utf-8")
