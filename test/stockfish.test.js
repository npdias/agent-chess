import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  selectPracticeMove,
  StockfishEngine,
  strengthProfileForTarget,
} from '../src/stockfish.js';
import * as stockfishModule from '../src/stockfish.js';

const parseUciScore = stockfishModule.parseUciScore ?? (() => null);

test('normalizes UCI score to White perspective', () => {
  assert.deepEqual(parseUciScore('info depth 10 score cp 84 nodes 100', '8/8/8/8/8/8/8/8 w - - 0 1'), {
    type: 'cp', value: 84, perspective: 'white',
  });
  assert.deepEqual(parseUciScore('info depth 12 score cp 84 nodes 200', '8/8/8/8/8/8/8/8 b - - 0 1'), {
    type: 'cp', value: -84, perspective: 'white',
  });
  assert.deepEqual(parseUciScore('info depth 14 score mate -3 nodes 300', '8/8/8/8/8/8/8/8 b - - 0 1'), {
    type: 'mate', value: 3, perspective: 'white',
  });
  assert.equal(parseUciScore('bestmove e2e4', '8/8/8/8/8/8/8/8 w - - 0 1'), null);
});

test('uses a true beginner selector below Stockfish UCI Elo floor', () => {
  assert.deepEqual(strengthProfileForTarget(250), {
    mode: 'practice',
    targetElo: 250,
  });
  assert.deepEqual(strengthProfileForTarget(1500), {
    mode: 'uci-elo',
    targetElo: 1500,
    uciElo: 1500,
  });
  assert.deepEqual(strengthProfileForTarget('unlimited'), {
    mode: 'unlimited',
    targetElo: null,
  });
});

test('250 practice bot can choose across every legal move', () => {
  const chess = new Chess();
  const legal = chess.moves({ verbose: true }).map((move) => move.lan);
  assert.equal(selectPracticeMove(chess.fen(), 250, () => 0.999), legal.at(-1));
});

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

test('returns a bounded position evaluation', { timeout: 20_000 }, async () => {
  const chess = new Chess();
  const engine = await StockfishEngine.start({ movetimeMs: 50, skillLevel: 20 });
  try {
    const evaluation = await engine.evaluate(chess.fen(), { movetimeMs: 50 });
    assert.ok(['cp', 'mate'].includes(evaluation.type));
    assert.equal(evaluation.perspective, 'white');
    assert.equal(Number.isInteger(evaluation.value), true);
  } finally {
    engine.close();
  }
});

test('starts a fresh engine after a prior match closes', { timeout: 20_000 }, async () => {
  const chess = new Chess();
  const legal = new Set(chess.moves({ verbose: true }).map((move) => move.lan));

  for (let index = 0; index < 2; index += 1) {
    const engine = await StockfishEngine.start({ movetimeMs: 50, skillLevel: 2 });
    try {
      assert.ok(legal.has(await engine.bestMove(chess.fen())));
    } finally {
      engine.close();
    }
  }
});
