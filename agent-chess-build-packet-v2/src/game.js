import { Chess } from 'chess.js';

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
