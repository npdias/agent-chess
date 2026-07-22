import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentChessGame } from '../src/game.js';

test('exposes canonical initial FEN and legal UCI moves', () => {
  const game = new AgentChessGame();
  const state = game.snapshot();

  assert.equal(state.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(state.turn, 'white');
  assert.equal(state.legalMoves.length, 20);
  assert.ok(state.legalMoves.some((move) => move.uci === 'e2e4' && move.san === 'e4'));
});

test('applies a legal UCI move and records history', () => {
  const game = new AgentChessGame();
  const applied = game.applyMove('e2e4');

  assert.equal(applied.uci, 'e2e4');
  assert.equal(applied.san, 'e4');
  assert.deepEqual(game.snapshot().movesUci, ['e2e4']);
  assert.equal(game.snapshot().turn, 'black');
});

test('rejects illegal UCI moves without changing state', () => {
  const game = new AgentChessGame();
  const before = game.snapshot().fen;

  assert.throws(() => game.applyMove('e2e5'), /ILLEGAL_MOVE/);
  assert.equal(game.snapshot().fen, before);
});

test('exports a valid PGN after moves', () => {
  const game = new AgentChessGame({ white: 'Agent', black: 'Stockfish' });
  game.applyMove('e2e4');
  game.applyMove('e7e5');

  const pgn = game.pgn();
  assert.match(pgn, /\[White "Agent"\]/);
  assert.match(pgn, /\[Black "Stockfish"\]/);
  assert.match(pgn, /1\. e4 e5/);
});
