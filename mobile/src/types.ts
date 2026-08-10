export type PlayerColor = 'white' | 'black';
export type TurnOwner = 'player' | 'opponent';

export type SessionStartResponse = {
  sessionId: string;
  gameId: string;
  playerColor: PlayerColor;
  opponentColor: PlayerColor;
  eventsUrl: string;
};

export type RelayEvent = {
  type:
    | 'connecting'
    | 'monitoring'
    | 'analysis'
    | 'analysis-error'
    | 'reconnecting'
    | 'stopped';
  sessionId?: string;
  gameId?: string;
  playerColor?: PlayerColor;
  opponentColor?: PlayerColor;
  turn?: TurnOwner;
  sideToMove?: PlayerColor;
  primaryMove?: string;
  primaryMoveOwner?: TurnOwner;
  primaryLabel?: string;
  responseMove?: string;
  responseMoveOwner?: TurnOwner;
  responseLabel?: string;
  fen?: string;
  imageUrl?: string;
  playerImageUrl?: string;
  evaluation?: {
    score?: number | string;
    depth?: number;
    [key: string]: unknown;
  };
  message?: string;
  retrying?: boolean;
  timestamp?: number;
};

export type ActiveSession = {
  serverUrl: string;
  sessionId: string;
  gameId: string;
  playerColor: PlayerColor;
  playerOnly: boolean;
};

export type LiveAnalysisProps = {
  gameId: string;
  playerColor: PlayerColor;
  phase: 'waiting' | 'analysis' | 'error' | 'stopped';
  status: string;
  turn: TurnOwner;
  sideToMove: PlayerColor;
  bestMove: string;
  bestMoveLabel: string;
  responseMove: string;
  responseLabel: string;
  fen: string;
  showBoard: boolean;
  updatedAt: number;
};
