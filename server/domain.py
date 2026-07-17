from dataclasses import dataclass
import re
from urllib.parse import urlparse

GAME_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class GameTarget:
    game_id: str
    url: str
    player_color: str
    opponent_color: str


def normalize_game_target(game_id_or_url: object, color: object) -> GameTarget:
    if not isinstance(game_id_or_url, str) or not game_id_or_url.strip():
        raise ValueError("gameId is required")
    if not isinstance(color, str) or color.lower() not in {"white", "black"}:
        raise ValueError("color must be either 'white' or 'black'")

    value = game_id_or_url.strip().rstrip("/")
    if "://" in value:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
            "chess.com",
            "www.chess.com",
        }:
            raise ValueError("game URL must be on www.chess.com")
        segments = [segment for segment in parsed.path.split("/") if segment]
        if len(segments) < 2 or segments[0] != "game":
            raise ValueError("expected a Chess.com URL in the form /game/<gameId>")
        if segments[1] in {"live", "daily"}:
            if len(segments) < 3:
                raise ValueError("game URL is missing its game ID")
            game_id = segments[2]
        else:
            game_id = segments[1]
    else:
        game_id = value

    if not GAME_ID_PATTERN.fullmatch(game_id):
        raise ValueError("gameId contains unsupported characters")

    player_color = color.lower()
    opponent_color = "black" if player_color == "white" else "white"
    return GameTarget(
        game_id=game_id,
        url=f"https://www.chess.com/game/{game_id}",
        player_color=player_color,
        opponent_color=opponent_color,
    )


def build_analysis_payload(
    target: GameTarget,
    side_to_move: str,
    best_move: str,
    response_move: str,
) -> dict:
    side_to_move = side_to_move.lower()
    player_turn = side_to_move == target.player_color
    if player_turn:
        turn = "player"
        primary_owner = "player"
        response_owner = "opponent"
        primary_label = "Your best move"
        response_label = "Opponent's best response"
    else:
        turn = "opponent"
        primary_owner = "opponent"
        response_owner = "player"
        primary_label = "Opponent to move — best move"
        response_label = "Your best response"

    return {
        "type": "analysis",
        "gameId": target.game_id,
        "playerColor": target.player_color,
        "opponentColor": target.opponent_color,
        "turn": turn,
        "sideToMove": side_to_move,
        "primaryMove": best_move,
        "primaryMoveOwner": primary_owner,
        "primaryLabel": primary_label,
        "responseMove": response_move,
        "responseMoveOwner": response_owner,
        "responseLabel": response_label,
    }
