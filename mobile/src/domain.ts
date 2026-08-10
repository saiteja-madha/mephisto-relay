import type { ActiveSession, LiveAnalysisProps, PlayerColor, RelayEvent } from './types.ts';

const INITIAL_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

export function normalizeServerUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+/i.test(normalized)) {
    throw new Error('Server URL must start with http:// or https://');
  }
  return normalized;
}

export function normalizeGameInput(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('Enter a Chess.com game ID or URL');
  }
  return normalized;
}

export function absoluteUrl(serverUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${normalizeServerUrl(serverUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

export function waitingProps(session: ActiveSession): LiveAnalysisProps {
  return {
    gameId: session.gameId,
    playerColor: session.playerColor,
    phase: 'waiting',
    status: 'Waiting for the first position',
    turn: 'player',
    sideToMove: session.playerColor,
    bestMove: '…',
    bestMoveLabel: 'Next best move',
    responseMove: '',
    responseLabel: '',
    fen: INITIAL_FEN,
    showBoard: false,
    updatedAt: Date.now(),
  };
}

export function toLiveAnalysisProps(
  event: RelayEvent,
  session: ActiveSession,
): LiveAnalysisProps {
  const turn = event.turn ?? 'player';
  const sideToMove = event.sideToMove ?? session.playerColor;
  const waitingForOpponent = session.playerOnly && turn === 'opponent';

  if (event.type !== 'analysis') {
    return {
      ...waitingProps(session),
      phase: event.type === 'analysis-error' ? 'error' : event.type === 'stopped' ? 'stopped' : 'waiting',
      status: event.message ?? 'Waiting for analysis',
      turn,
      sideToMove,
      updatedAt: event.timestamp ?? Date.now(),
    };
  }

  if (waitingForOpponent) {
    return {
      ...waitingProps(session),
      phase: 'waiting',
      status: 'Waiting for your opponent',
      turn,
      sideToMove,
      fen: event.fen ?? INITIAL_FEN,
      updatedAt: event.timestamp ?? Date.now(),
    };
  }

  return {
    gameId: event.gameId ?? session.gameId,
    playerColor: session.playerColor,
    phase: 'analysis',
    status: turn === 'player' ? 'Your turn' : "Opponent's turn",
    turn,
    sideToMove,
    bestMove: event.primaryMove ?? '—',
    bestMoveLabel: event.primaryLabel ?? 'Current best move',
    responseMove: session.playerOnly ? '' : (event.responseMove ?? '—'),
    responseLabel: session.playerOnly ? '' : (event.responseLabel ?? 'Best response'),
    fen: event.fen ?? INITIAL_FEN,
    showBoard: true,
    updatedAt: event.timestamp ?? Date.now(),
  };
}

export function oppositeColor(color: PlayerColor): PlayerColor {
  return color === 'white' ? 'black' : 'white';
}
