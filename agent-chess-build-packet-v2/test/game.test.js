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

test('records copied FEN history and check state for replay', () => {
  const game = new AgentChessGame();
  const initial = game.snapshot();
  game.applyMove('e2e4');
  const afterMove = game.snapshot();

  assert.deepEqual(initial.positions, [initial.fen]);
  assert.deepEqual(afterMove.positions, [initial.fen, afterMove.fen]);
  afterMove.positions.push('mutated');
  assert.equal(game.snapshot().positions.includes('mutated'), false);
  assert.equal(afterMove.inCheck, false);
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

test('groups starting moves into ten movable origins', () => {
  const game = new AgentChessGame();

  assert.deepEqual(game.getMovablePieces().map((piece) => piece.square), [
    'a2', 'b1', 'b2', 'c2', 'd2', 'e2', 'f2', 'g1', 'g2', 'h2',
  ]);
});

test('builds compact turn without full legal list', () => {
  const game = new AgentChessGame();
  const turn = game.buildTurnSnapshot({
    gameId: 'g',
    turnId: 't',
    agentColor: 'white',
    steering: { mode: 'locked', guidance: null },
    deadline: null,
  });

  assert.deepEqual(Object.keys(turn).sort(), [
    'agentColor', 'balanceForAgent', 'deadline', 'fen', 'gameId', 'material', 'ply', 'positionStatus',
    'protocolVersion', 'recentMoves', 'sideToMove', 'steering', 'turnId', 'type', 'variant',
  ]);
  assert.equal(turn.type, 'turn.start');
  assert.equal(turn.protocolVersion, '2.0');
  assert.equal(turn.gameId, 'g');
  assert.equal(turn.turnId, 't');
  assert.equal(turn.variant, 'standard');
  assert.equal(turn.agentColor, 'white');
  assert.equal(turn.sideToMove, 'white');
  assert.equal(turn.fen.split(' ').length, 6);
  assert.equal(turn.ply, 0);
  assert.deepEqual(turn.recentMoves, []);
  assert.deepEqual(turn.steering, { mode: 'locked', guidance: null });
  assert.equal(turn.deadline, null);
  assert.deepEqual(turn.material, {
    white: { pawns: 8, knights: 2, bishops: 2, rooks: 2, queens: 1, points: 39 },
    black: { pawns: 8, knights: 2, bishops: 2, rooks: 2, queens: 1, points: 39 },
    balanceWhite: 0,
    capturedByWhite: { pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0 },
    capturedByBlack: { pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0 },
  });
  assert.equal(turn.balanceForAgent, 0);
  assert.equal('legalMoves' in turn, false);
  assert.equal('movesUci' in turn, false);
  assert.equal(turn.positionStatus.inCheck, false);
  assert.deepEqual(turn.positionStatus.movablePieces[0], { square: 'a2', piece: 'pawn' });
  assert.deepEqual(Object.keys(turn.positionStatus.movablePieces[0]), ['square', 'piece']);
});

test('reports authoritative material inventory and capture counts', () => {
  const game = new AgentChessGame();
  for (const move of ['e2e4', 'd7d5', 'e4d5']) game.applyMove(move);

  assert.deepEqual(game.snapshot().material, {
    white: { pawns: 8, knights: 2, bishops: 2, rooks: 2, queens: 1, points: 39 },
    black: { pawns: 7, knights: 2, bishops: 2, rooks: 2, queens: 1, points: 38 },
    balanceWhite: 1,
    capturedByWhite: { pawns: 1, knights: 0, bishops: 0, rooks: 0, queens: 0 },
    capturedByBlack: { pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0 },
  });

  const turn = game.buildTurnSnapshot({
    gameId: 'g', turnId: 't', agentColor: 'black',
    steering: { mode: 'locked', guidance: null }, deadline: null,
  });
  assert.equal(turn.balanceForAgent, -1);
  assert.equal('balanceForAgent' in game.snapshot().material, false);
});

test('material handles custom FEN, promotion, and en passant', () => {
  const promoted = new AgentChessGame({ fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1' });
  promoted.applyMove('a7a8q');
  assert.deepEqual(promoted.snapshot().material.white, {
    pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 1, points: 9,
  });

  const enPassant = new AgentChessGame({ fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1' });
  enPassant.applyMove('e5d6');
  assert.deepEqual(enPassant.snapshot().material, {
    white: { pawns: 1, knights: 0, bishops: 0, rooks: 0, queens: 0, points: 1 },
    black: { pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0, points: 0 },
    balanceWhite: 1,
    capturedByWhite: { pawns: 1, knights: 0, bishops: 0, rooks: 0, queens: 0 },
    capturedByBlack: { pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0 },
  });
});

test('rejects a turn snapshot for a non-moving agent color', () => {
  const game = new AgentChessGame();

  assert.throws(() => game.buildTurnSnapshot({
    gameId: 'g',
    turnId: 't',
    agentColor: 'black',
    steering: { mode: 'locked', guidance: null },
    deadline: null,
  }), /NOT_AGENT_TURN/);
});

test('piece probe returns only e2 moves', () => {
  const game = new AgentChessGame();

  assert.deepEqual(game.getMovesForSquare('e2').map((move) => move.uci).sort(), ['e2e3', 'e2e4']);
});

test('returns configured trailing history window', () => {
  const game = new AgentChessGame();
  for (const move of ['e2e4', 'e7e5', 'g1f3', 'b8c6']) game.applyMove(move);

  assert.deepEqual(game.getRecentMoves(2), [
    { ply: 3, color: 'white', uci: 'g1f3', san: 'Nf3' },
    { ply: 4, color: 'black', uci: 'b8c6', san: 'Nc6' },
  ]);
});

test('rejects negative history limits', () => {
  const game = new AgentChessGame();

  assert.throws(() => game.getRecentMoves(-1), /INVALID_HISTORY_LIMIT/);
});

test('rejects non-integer history limits', () => {
  const game = new AgentChessGame();

  assert.throws(() => game.getRecentMoves(1.5), /INVALID_HISTORY_LIMIT/);
});

test('returns no history for a zero-ply window', () => {
  const game = new AgentChessGame();
  game.applyMove('e2e4');

  assert.deepEqual(game.getRecentMoves(0), []);
});

test('reports check status from authoritative legal position', () => {
  const game = new AgentChessGame({ fen: '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1' });
  const turn = game.buildTurnSnapshot({
    gameId: 'g',
    turnId: 't',
    agentColor: 'white',
    steering: { mode: 'locked', guidance: null },
    deadline: null,
  });

  assert.equal(turn.positionStatus.inCheck, true);
  assert.deepEqual(turn.positionStatus.movablePieces.map((piece) => piece.square), ['e1']);
});

test('validates candidates without changing game state', () => {
  const game = new AgentChessGame();
  const before = game.snapshot().fen;

  assert.deepEqual(game.validateCandidate('e2e4'), {
    moveUci: 'e2e4', legal: true, san: 'e4', reason: null,
  });
  assert.deepEqual(game.validateCandidate('e2e5'), {
    moveUci: 'e2e5', legal: false, san: null, reason: 'MOVE_NOT_LEGAL',
  });
  assert.equal(game.snapshot().fen, before);
});
