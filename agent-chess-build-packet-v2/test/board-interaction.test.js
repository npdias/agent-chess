import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHumanMove,
  canHumanMove,
  legalMovesFrom,
  selectHumanSquare,
} from '../public/board-interaction.js';

function initialHumanMatch(color) {
  return {
    status: 'active',
    seats: {
      white: { kind: color === 'white' ? 'human' : 'engine' },
      black: { kind: color === 'black' ? 'human' : 'engine' },
    },
    game: {
      turn: 'white',
      ply: 0,
      fen: 'initial',
      gameOver: false,
      legalMoves: [
        { uci: 'e2e3', from: 'e2', to: 'e3', promotion: null },
        { uci: 'e2e4', from: 'e2', to: 'e4', promotion: null },
        { uci: 'g1f3', from: 'g1', to: 'f3', promotion: null },
      ],
    },
  };
}

function promotionState() {
  return {
    selected: 'e7',
    legalTargets: ['e8'],
    legalMoves: [
      { uci: 'e7e8q', from: 'e7', to: 'e8', promotion: 'q' },
      { uci: 'e7e8r', from: 'e7', to: 'e8', promotion: 'r' },
    ],
  };
}

test('selects owned source and builds legal UCI destination', () => {
  const match = initialHumanMatch('white');
  const selected = selectHumanSquare({ selected: null }, 'e2', match, 'white');

  assert.deepEqual(selected.legalTargets, ['e3', 'e4']);
  assert.deepEqual(buildHumanMove(selected, 'e4'), { moveUci: 'e2e4', promotionRequired: false });
});

test('lists unique legal destinations from authoritative public moves', () => {
  const match = initialHumanMatch('white');
  match.game.legalMoves.push({ uci: 'e2e4q', from: 'e2', to: 'e4', promotion: 'q' });

  assert.deepEqual(legalMovesFrom(match, 'e2'), ['e3', 'e4']);
  assert.deepEqual(legalMovesFrom(match, 'a1'), []);
});

test('blocks selection outside authenticated human turn', () => {
  assert.equal(canHumanMove({ status: 'active', game: { turn: 'black' } }, 'white'), false);
});

test('blocks input when authenticated color does not own a human seat', () => {
  const match = initialHumanMatch('white');
  match.seats.white.kind = 'agent';

  assert.equal(canHumanMove(match, 'white'), false);
  assert.deepEqual(selectHumanSquare({ selected: null }, 'e2', match, 'white'), {
    selected: null,
    legalTargets: [],
    legalMoves: [],
    focusedSquare: 'e2',
    positionKey: 'initial',
  });
});

test('switches owned source, cancels current source, and keeps keyboard focus immutable', () => {
  const match = initialHumanMatch('white');
  const state = { selected: 'e2', legalTargets: ['e3', 'e4'], legalMoves: match.game.legalMoves.slice(0, 2), focusedSquare: 'e2' };
  const switched = selectHumanSquare(state, 'g1', match, 'white');

  assert.deepEqual(switched, {
    selected: 'g1',
    legalTargets: ['f3'],
    legalMoves: [match.game.legalMoves[2]],
    focusedSquare: 'g1',
    positionKey: 'initial',
  });
  assert.deepEqual(selectHumanSquare(switched, 'g1', match, 'white'), {
    selected: null,
    legalTargets: [],
    legalMoves: [],
    focusedSquare: 'g1',
    positionKey: 'initial',
  });
  assert.equal(state.selected, 'e2');
  assert.equal(match.game.legalMoves.length, 3);
});

test('resets stale selection when match turn changes', () => {
  const match = initialHumanMatch('white');
  const selected = selectHumanSquare({ selected: null }, 'e2', match, 'white');
  const newerMatch = structuredClone(match);
  newerMatch.game.turn = 'black';
  newerMatch.game.ply = 1;
  newerMatch.game.fen = 'after-e2e4';

  assert.deepEqual(selectHumanSquare(selected, 'e2', newerMatch, 'white'), {
    selected: null,
    legalTargets: [],
    legalMoves: [],
    focusedSquare: 'e2',
    positionKey: 'after-e2e4',
  });
});

test('requires promotion choice when legal moves contain promotion suffixes', () => {
  const result = buildHumanMove(promotionState(), 'e8');

  assert.deepEqual(result, { moveUci: null, promotionRequired: true, promotionOptions: ['q', 'r'] });
  assert.deepEqual(buildHumanMove(promotionState(), 'e8', 'r'), { moveUci: 'e7e8r', promotionRequired: false });
});

test('rejects destination absent from selected authoritative move set', () => {
  assert.equal(buildHumanMove(promotionState(), 'd8'), null);
});
