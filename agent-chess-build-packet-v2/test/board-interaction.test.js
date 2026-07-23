import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHumanMove,
  canHumanMove,
  legalMovesFrom,
  selectHumanSquare,
  capabilityStorageEntries,
  deriveExhibitionSummary,
  materialSummary,
  replayPlyForMove,
  controllerColor,
  consumeSuppressedClick,
  displayedSeats,
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

test('requires active match for human input', () => {
  const match = initialHumanMatch('white');
  match.status = 'waiting';

  assert.equal(canHumanMove(match, 'white'), false);
});

test('requires human ownership for human input', () => {
  const match = initialHumanMatch('white');
  match.seats.white.kind = 'agent';

  assert.equal(canHumanMove(match, 'white'), false);
});

test('requires authenticated human turn for human input', () => {
  const match = initialHumanMatch('white');
  match.game.turn = 'black';

  assert.equal(canHumanMove(match, 'white'), false);
});

test('blocks human input after terminal game', () => {
  const match = initialHumanMatch('white');
  match.game.gameOver = true;

  assert.equal(canHumanMove(match, 'white'), false);
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

test('keeps valid selection when input is neither selected source nor legal origin', () => {
  const match = initialHumanMatch('white');
  const selected = selectHumanSquare({ selected: null }, 'e2', match, 'white');

  assert.deepEqual(selectHumanSquare(selected, 'd8', match, 'white'), selected);
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

test('stores returned color-keyed capabilities without assigning human or agent labels', () => {
  assert.deepEqual(capabilityStorageEntries('match-1', { white: 'human-cap', black: 'agent-cap' }), [
    ['match-1:capability:white', 'human-cap'], ['match-1:capability:black', 'agent-cap'],
  ]);
});

test('derives generic controller and terminal review state from seats and lifecycle', () => {
  const match = { status: 'aborted', termination: 'aborted', seats: { white: { kind: 'human', name: 'N' }, black: { kind: 'engine', name: 'Computer' } }, game: { turn: 'black', result: '*', gameOver: false, movesSan: [] } };
  assert.deepEqual(deriveExhibitionSummary(match), { status: 'Match aborted', resultLabel: 'No result', termination: 'Aborted', moveCount: 0, review: true, activeName: 'Computer' });
});

test('derives captured piece names and side-relative material difference', () => {
  const initial = '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1';
  const current = '4k3/pp1ppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1';
  assert.deepEqual(materialSummary(initial, current, 'white'), { captured: ['black pawn'], difference: 1 });
});

test('maps each SAN replay button to its exact ply', () => {
  assert.equal(replayPlyForMove(0, 'white'), 1);
  assert.equal(replayPlyForMove(0, 'black'), 2);
  assert.equal(replayPlyForMove(2, 'white'), 5);
  assert.equal(replayPlyForMove(2, 'black'), 6);
});

test('finds owned human or agent controller only from a private capability', () => {
  assert.equal(controllerColor('m', { white: { kind: 'human' } }, () => null), null);
  assert.equal(controllerColor('m', { white: { kind: 'human' } }, () => 'private'), 'white');
  assert.equal(controllerColor('m', { black: { kind: 'agent' } }, () => 'private'), 'black');
});

test('counts promotion material from current totals', () => {
  const initial = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  const promoted = 'Q3k3/8/8/8/8/8/8/4K3 b - - 0 1';
  assert.equal(materialSummary(initial, promoted, 'white').difference, 9);
});

test('suppresses follow-up click after drag submission', () => {
  assert.deepEqual(consumeSuppressedClick(true), { handle: false, suppressed: false });
  assert.deepEqual(consumeSuppressedClick(false), { handle: true, suppressed: false });
});

test('marks resigned, aborted, and failed lifecycle states terminal without chess game-over', () => {
  for (const [status, termination] of [['completed', 'resignation'], ['aborted', 'aborted'], ['failed', 'failure']]) {
    assert.equal(deriveExhibitionSummary({ status, termination, seats: {}, game: { gameOver: false, movesSan: [] } }).review, true);
  }
});

test('does not report promoted pawn as captured', () => {
  const initial = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  const promoted = 'Q3k3/8/8/8/8/8/8/4K3 b - - 0 1';
  assert.deepEqual(materialSummary(initial, promoted, 'white').captured, []);
});

test('maps top and bottom seats from board orientation with generic kinds', () => {
  const humanEngine = { white: { kind: 'engine', name: 'Computer' }, black: { kind: 'human', name: 'Human' } };
  assert.deepEqual(displayedSeats(humanEngine, false), {
    top: { color: 'black', kind: 'human', kindLabel: 'Human', name: 'Human' },
    bottom: { color: 'white', kind: 'engine', kindLabel: 'Engine', name: 'Computer' },
  });
  assert.deepEqual(displayedSeats(humanEngine, true), {
    top: { color: 'white', kind: 'engine', kindLabel: 'Engine', name: 'Computer' },
    bottom: { color: 'black', kind: 'human', kindLabel: 'Human', name: 'Human' },
  });
  assert.equal(displayedSeats({ white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'My agent' } }, false).top.kindLabel, 'Agent');
});
