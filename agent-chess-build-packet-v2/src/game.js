import { Chess } from 'chess.js';
import { MESSAGE_TYPES, PROTOCOL_VERSION } from './protocol.js';

const PIECE_NAMES = Object.freeze({
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
});

export function toUci(move) {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function parseUci(uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    throw new Error(`MALFORMED_MOVE: ${uci}`);
  }
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    ...(uci.length === 5 ? { promotion: uci[4] } : {}),
  };
}

export class AgentChessGame {
  constructor({ fen, white = 'Agent', black = 'Stockfish' } = {}) {
    this.chess = new Chess(fen);
    this.movesUci = [];
    this.initialFen = fen ?? new Chess().fen();
    this.chess.header('White', white, 'Black', black, 'Event', 'Agent Chess');
  }

  legalMoves() {
    return this.chess.moves({ verbose: true }).map((move) => ({
      uci: toUci(move),
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion ?? null,
    }));
  }

  getRecentMoves(limitPlies = 12) {
    const history = this.chess.history({ verbose: true });
    return history.slice(-limitPlies).map((move, index, moves) => ({
      ply: history.length - moves.length + index + 1,
      color: move.color === 'w' ? 'white' : 'black',
      uci: toUci(move),
      san: move.san,
    }));
  }

  getMovablePieces() {
    const squares = new Set(this.legalMoves().map((move) => move.from));
    return [...squares]
      .sort()
      .map((square) => ({ square, piece: PIECE_NAMES[this.chess.get(square).type] }));
  }

  getMovesForSquare(square) {
    return this.legalMoves().filter((move) => move.from === square);
  }

  validateCandidate(moveUci) {
    const move = this.legalMoves().find((candidate) => candidate.uci === moveUci);
    return {
      moveUci,
      legal: Boolean(move),
      san: move?.san ?? null,
      reason: move ? null : 'MOVE_NOT_LEGAL',
    };
  }

  buildTurnSnapshot({
    gameId,
    turnId,
    agentColor,
    steering,
    deadline,
    recentMoveWindowPlies = 12,
  }) {
    return {
      type: MESSAGE_TYPES.TURN_START,
      protocolVersion: PROTOCOL_VERSION,
      gameId,
      turnId,
      variant: 'standard',
      agentColor,
      sideToMove: this.chess.turn() === 'w' ? 'white' : 'black',
      fen: this.chess.fen({ forceEnpassantSquare: true }),
      ply: this.movesUci.length,
      recentMoves: this.getRecentMoves(recentMoveWindowPlies),
      positionStatus: {
        inCheck: this.chess.isCheck(),
        movablePieces: this.getMovablePieces(),
      },
      steering,
      deadline,
    };
  }

  applyMove(uci) {
    const legal = this.legalMoves().find((move) => move.uci === uci);
    if (!legal) {
      throw new Error(`ILLEGAL_MOVE: ${uci}`);
    }

    const move = this.chess.move(parseUci(uci));
    this.movesUci.push(uci);
    return {
      uci,
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion ?? null,
    };
  }

  snapshot() {
    return {
      initialFen: this.initialFen,
      fen: this.chess.fen({ forceEnpassantSquare: true }),
      turn: this.chess.turn() === 'w' ? 'white' : 'black',
      ply: this.movesUci.length,
      movesUci: [...this.movesUci],
      movesSan: this.chess.history(),
      legalMoves: this.legalMoves(),
      gameOver: this.chess.isGameOver(),
      checkmate: this.chess.isCheckmate(),
      draw: this.chess.isDraw(),
      result: this.result(),
    };
  }

  result() {
    if (this.chess.isCheckmate()) {
      return this.chess.turn() === 'w' ? '0-1' : '1-0';
    }
    if (this.chess.isDraw()) return '1/2-1/2';
    return '*';
  }

  pgn() {
    return this.chess.pgn();
  }
}
