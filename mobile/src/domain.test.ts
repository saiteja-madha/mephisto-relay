import assert from 'node:assert/strict';
import test from 'node:test';

import {
  absoluteUrl,
  normalizeGameInput,
  normalizeServerUrl,
  toLiveAnalysisProps,
} from './domain.ts';
import type { ActiveSession, RelayEvent } from './types.ts';

const session: ActiveSession = {
  serverUrl: 'http://192.168.1.10:8080',
  sessionId: 'session-1',
  gameId: '123',
  playerColor: 'white',
  playerOnly: false,
};

const opponentAnalysis: RelayEvent = {
  type: 'analysis',
  gameId: '123',
  turn: 'opponent',
  sideToMove: 'black',
  primaryMove: 'e7e5',
  primaryLabel: 'Opponent to move — best move',
  responseMove: 'g1f3',
  responseLabel: 'Your best response',
  fen: '8/8/8/8/8/8/8/8 b - - 0 1',
};

test('normalizes relay and image URLs', () => {
  assert.equal(normalizeServerUrl(' http://192.168.1.10:8080/// '), 'http://192.168.1.10:8080');
  assert.equal(absoluteUrl(session.serverUrl, '/api/image.svg'), 'http://192.168.1.10:8080/api/image.svg');
  assert.equal(normalizeGameInput(' https://www.chess.com/game/123/ '), 'https://www.chess.com/game/123');
});

test('shows opponent analysis when opponent responses are enabled', () => {
  const props = toLiveAnalysisProps(opponentAnalysis, session);
  assert.equal(props.status, "Opponent's turn");
  assert.equal(props.bestMove, 'e7e5');
  assert.equal(props.responseMove, 'g1f3');
  assert.equal(props.showBoard, true);
});

test('waits without a stale move in player-only mode on opponent turn', () => {
  const props = toLiveAnalysisProps(opponentAnalysis, { ...session, playerOnly: true });
  assert.equal(props.status, 'Waiting for your opponent');
  assert.equal(props.bestMove, '…');
  assert.equal(props.responseMove, '');
  assert.equal(props.showBoard, false);
});
