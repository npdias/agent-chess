import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { StockfishEngine } from '../src/stockfish.js';

test('returns a legal best move for a FEN position', { timeout: 20_000 }, async () => {
  const chess = new Chess();
  const legal = new Set(chess.moves({ verbose: true }).map((move) => move.lan));
  const engine = await StockfishEngine.start({ movetimeMs: 50, skillLevel: 2 });

  try {
    const move = await engine.bestMove(chess.fen());
    assert.ok(legal.has(move), `${move} should be legal`);
  } finally {
    engine.close();
  }
});
