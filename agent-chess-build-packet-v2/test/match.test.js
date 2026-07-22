import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchSession } from '../src/match.js';

test('locked matches reject steering', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  assert.throws(() => match.queueSteering('Play aggressively'), /STEERING_LOCKED/);
});

test('trainer guidance appears on the next agent turn and is consumed once', () => {
  const match = new MatchSession({ steeringMode: 'trainer', agentColor: 'white' });
  match.queueSteering('Control the center');

  const turn = match.createTurnPayload();
  assert.equal(turn.steering.mode, 'trainer');
  assert.equal(turn.steering.guidance, 'Control the center');
  assert.equal(match.createTurnPayload().steering.guidance, null);
});

test('rejects a move submitted for a stale turn', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const turn = match.createTurnPayload();
  match.submitAgentMove({ turnId: turn.turnId, moveUci: 'e2e4' });

  assert.throws(
    () => match.submitAgentMove({ turnId: turn.turnId, moveUci: 'd2d4' }),
    /STALE_TURN/
  );
});

test('produces a fresh agent turn after the opponent moves', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const first = match.createTurnPayload();
  match.submitAgentMove({ turnId: first.turnId, moveUci: 'e2e4' });
  match.submitOpponentMove('e7e5');

  const second = match.createTurnPayload();
  assert.notEqual(second.turnId, first.turnId);
  assert.deepEqual(second.recentMoves, [
    { ply: 1, color: 'white', uci: 'e2e4', san: 'e4' },
    { ply: 2, color: 'black', uci: 'e7e5', san: 'e5' },
  ]);
  assert.equal(second.agentColor, 'white');
});

test('stores only explicit structured trace summaries', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const turn = match.createTurnPayload();
  const entry = match.publishTrace({
    turnId: turn.turnId,
    phase: 'planning',
    summary: 'Develop the kingside knight.',
  });

  assert.equal(entry.type, 'agent.trace');
  assert.equal(entry.phase, 'planning');
  assert.equal(match.snapshot().trace.at(-1).summary, 'Develop the kingside knight.');
});

test('rejects trace publication without an active turn before storing activity', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  match.createTurnPayload();
  const before = match.snapshot().activity;

  assert.throws(() => match.publishTrace({ summary: 'Choose e4.' }), /STALE_TURN/);
  assert.deepEqual(match.snapshot().activity, before);
});

test('rejects trace publication for a closed turn before storing activity', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const turn = match.createTurnPayload();
  match.submitAgentMove({ turnId: turn.turnId, moveUci: 'e2e4' });
  const before = match.snapshot().activity;

  assert.throws(
    () => match.publishTrace({ turnId: turn.turnId, summary: 'Choose e4.' }),
    /STALE_TURN/
  );
  assert.deepEqual(match.snapshot().activity, before);
});

test('creates a compact protocol 2.0 turn payload', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });

  const turn = match.createTurnPayload();

  assert.equal(turn.protocolVersion, '2.0');
  assert.equal(turn.agentColor, 'white');
  assert.equal(turn.sideToMove, 'white');
  assert.equal(turn.deadline, null);
  assert.equal('legalMoves' in turn, false);
  assert.equal('movesUci' in turn, false);
  assert.deepEqual(turn.positionStatus.movablePieces.map((piece) => piece.square), [
    'a2', 'b1', 'b2', 'c2', 'd2', 'e2', 'f2', 'g1', 'g2', 'h2',
  ]);
});

test('lists only requested movable piece moves for active turn', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const turn = match.createTurnPayload();

  const result = match.listMovesForPiece({ turnId: turn.turnId, square: 'e2' });

  assert.equal(result.turnId, turn.turnId);
  assert.equal(result.square, 'e2');
  assert.deepEqual(result.moves.map((move) => move.uci).sort(), ['e2e3', 'e2e4']);
});

test('rejects a piece probe for a non-movable square', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const turn = match.createTurnPayload();

  assert.throws(
    () => match.listMovesForPiece({ turnId: turn.turnId, square: 'a1' }),
    /PIECE_NOT_MOVABLE/
  );
});

test('validates candidates without mutating active game state', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const turn = match.createTurnPayload();

  assert.equal(match.validateCandidate({ turnId: turn.turnId, moveUci: 'e2e4' }).legal, true);
  assert.deepEqual(match.validateCandidate({ turnId: turn.turnId, moveUci: 'e2e5' }), {
    moveUci: 'e2e5', legal: false, san: null, reason: 'MOVE_NOT_LEGAL',
  });
  assert.equal(match.game.snapshot().ply, 0);
  assert.equal(match.currentTurnId, turn.turnId);
});

test('returns complete legal list only when explicitly requested', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const turn = match.createTurnPayload();

  const result = match.listAllMoves({ turnId: turn.turnId });

  assert.equal(result.turnId, turn.turnId);
  assert.equal(result.moves.length, 20);
  assert.ok(result.moves.some((move) => move.uci === 'e2e4'));
});

test('returns read-only history pages before supplied ply cursor', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const first = match.createTurnPayload();
  match.submitAgentMove({ turnId: first.turnId, moveUci: 'e2e4' });
  match.submitOpponentMove('e7e5');
  const second = match.createTurnPayload();
  match.submitAgentMove({ turnId: second.turnId, moveUci: 'g1f3' });
  match.submitOpponentMove('b8c6');
  const third = match.createTurnPayload();

  const page = match.listHistory({ turnId: third.turnId, beforePly: 5, limit: 2 });

  assert.deepEqual(page.moves, [
    { ply: 3, color: 'white', uci: 'g1f3', san: 'Nf3' },
    { ply: 4, color: 'black', uci: 'b8c6', san: 'Nc6' },
  ]);
  assert.equal(match.game.snapshot().ply, 4);
});

test('rejects probes made after their turn accepts a move', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const turn = match.createTurnPayload();
  match.submitAgentMove({ turnId: turn.turnId, moveUci: 'e2e4' });

  assert.throws(() => match.listAllMoves({ turnId: turn.turnId }), /STALE_TURN/);
  assert.throws(() => match.validateCandidate({ turnId: turn.turnId, moveUci: 'd2d4' }), /STALE_TURN/);
});

test('sanitizes optional decision trace without fabricating agent activity', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const turn = match.createTurnPayload();

  assert.equal(match.snapshot().activity.some((entry) => entry.source === 'agent'), false);
  const entry = match.publishTrace({
    turnId: turn.turnId,
    phase: 'evaluate',
    summary: 'x'.repeat(501),
    candidates: [
      { uci: 'e2e4', note: 'a'.repeat(161) },
      { uci: 'd2d4', note: 'Second candidate' },
      { uci: 'g1f3', note: 'Third candidate' },
      { uci: 'b1c3', note: 'Excluded candidate' },
    ],
    selectedMove: 'e2e4',
  });

  assert.equal(entry.source, 'agent');
  assert.equal(entry.summary.length, 500);
  assert.equal(entry.candidates.length, 3);
  assert.equal(entry.candidates[0].note.length, 160);
  assert.equal(entry.selectedMove, 'e2e4');
  assert.deepEqual(match.snapshot().activity.at(-1), entry);
});

test('preserves decision trace kind and rejects malformed trace moves before mutation', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const turn = match.createTurnPayload();
  const before = match.snapshot().activity;

  assert.throws(
    () => match.publishTrace({
      turnId: turn.turnId,
      summary: 'Invalid trace.',
      candidates: [{ uci: 'e2e9', note: 'Malformed.' }],
    }),
    /INVALID_MOVE_FORMAT/
  );
  assert.deepEqual(match.snapshot().activity, before);

  const entry = match.publishTrace({
    turnId: turn.turnId,
    kind: 'decision',
    summary: 'Choose e4.',
    selectedMove: 'e2e4',
  });
  assert.equal(entry.kind, 'decision');
  assert.equal(match.snapshot().activity.at(-1).kind, 'decision');
});
