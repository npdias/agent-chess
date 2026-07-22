import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentChessGame } from '../src/game.js';
import { MatchSession } from '../src/match.js';

const publicHumanEngineConfig = {
  mode: 'exhibition', visibility: 'public', clock: { kind: 'none' },
  seats: {
    white: { kind: 'human', name: 'Human' },
    black: { kind: 'engine', name: 'Engine' },
  },
};

function publicAgentMatch() {
  return new MatchSession({
    mode: 'exhibition', visibility: 'public', clock: { kind: 'none' },
    seats: {
      white: { kind: 'agent', name: 'Public Agent', traceRequirement: 'structured_required' },
      black: { kind: 'engine', name: 'Engine' },
    },
  });
}

test('creates active turn for human seat and rejects wrong color', () => {
  const match = new MatchSession(publicHumanEngineConfig);
  const turn = match.createTurnPayload();

  assert.equal(turn.activeColor, 'white');
  assert.equal(turn.seatKind, 'human');
  assert.throws(
    () => match.submitSeatMove({ color: 'black', turnId: turn.turnId, moveUci: 'e2e4' }),
    /SEAT_NOT_ACTIVE/
  );
});

test('alternates human and agent seats through one authoritative path', () => {
  const match = new MatchSession({
    mode: 'exhibition', visibility: 'public', clock: { kind: 'none' },
    seats: {
      white: { kind: 'human', name: 'Human' },
      black: { kind: 'agent', name: 'Agent', traceRequirement: 'structured_required' },
    },
  });

  const white = match.createTurnPayload();
  match.submitSeatMove({ color: 'white', turnId: white.turnId, moveUci: 'e2e4' });
  const black = match.createTurnPayload();

  assert.equal(black.activeColor, 'black');
  assert.equal(black.seatKind, 'agent');
});

test('public agent move requires legal matching decision trace', () => {
  const match = publicAgentMatch();
  const turn = match.createTurnPayload();

  assert.throws(
    () => match.submitSeatMove({ color: 'white', turnId: turn.turnId, moveUci: 'e2e4' }),
    /TRACE_REQUIRED/
  );
  assert.throws(
    () => match.submitSeatMove({
      color: 'white', turnId: turn.turnId, moveUci: 'e2e4',
      publicTrace: { summary: 'Choose e4.', candidates: [{ uci: 'e2e5' }], selectedMove: 'e2e4' },
    }),
    /TRACE_CANDIDATE_NOT_LEGAL/
  );
  assert.throws(
    () => match.submitSeatMove({
      color: 'white', turnId: turn.turnId, moveUci: 'e2e4',
      publicTrace: { summary: 'Choose e4.', candidates: [{ uci: 'e2e4' }] },
    }),
    /TRACE_SELECTED_MOVE_MISMATCH/
  );
  assert.throws(
    () => match.submitSeatMove({
      color: 'white', turnId: turn.turnId, moveUci: 'e2e4',
      publicTrace: { summary: 'Choose e4.', candidates: [{ uci: 'e2e4' }], selectedMove: 'd2d4' },
    }),
    /TRACE_SELECTED_MOVE_MISMATCH/
  );
});

test('does not commit a decision trace when submitted move is illegal', () => {
  const match = publicAgentMatch();
  const turn = match.createTurnPayload();
  const before = match.snapshot();

  assert.throws(
    () => match.submitSeatMove({
      color: 'white', turnId: turn.turnId, moveUci: 'e2e5',
      publicTrace: { summary: 'Choose e5.', candidates: [{ uci: 'e2e4' }], selectedMove: 'e2e5' },
    }),
    /ILLEGAL_MOVE/
  );

  const after = match.snapshot();
  assert.equal(after.game.ply, before.game.ply);
  assert.equal(match.activeTurn().turnId, turn.turnId);
  assert.equal(after.activity.filter((entry) => entry.type === 'agent.decision').length, 0);
});

test('commits submitted public trace as one agent decision activity', () => {
  const match = publicAgentMatch();
  const turn = match.createTurnPayload();

  match.submitAgentMove({
    turnId: turn.turnId, moveUci: 'e2e4',
    publicTrace: {
      source: 'agent_reported', phase: 'choose', summary: 'Claim center.',
      candidates: [{ uci: 'e2e4', note: 'Opens lines.' }], selectedMove: 'e2e4',
    },
  });

  const decisions = match.snapshot().activity.filter((entry) => entry.type === 'agent.decision');
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].selectedMove, 'e2e4');
  assert.deepEqual(decisions[0].candidates, [{ uci: 'e2e4', note: 'Opens lines.' }]);
  assert.equal(match.snapshot().activity.some((entry) => entry.type === 'agent.trace'), false);
});

test('rejects stale generic turns after a seat move', () => {
  const match = new MatchSession(publicHumanEngineConfig);
  const turn = match.createTurnPayload();
  match.submitSeatMove({ color: 'white', turnId: turn.turnId, moveUci: 'e2e4' });

  assert.throws(
    () => match.submitSeatMove({ color: 'white', turnId: turn.turnId, moveUci: 'd2d4' }),
    /STALE_TURN/
  );
});

test('resignation completes a match once and is idempotent', () => {
  const match = new MatchSession(publicHumanEngineConfig);
  match.createTurnPayload();

  const first = match.resign('white');
  const second = match.resign('white');

  assert.equal(first.result, '0-1');
  assert.deepEqual(second, first);
  assert.equal(match.snapshot().status, 'completed');
  assert.equal(match.snapshot().termination, 'resignation');
  assert.equal(match.isTerminal(), true);
});

test('aborts only before first move', () => {
  const match = new MatchSession(publicHumanEngineConfig);
  assert.equal(match.abort('white').status, 'aborted');

  const started = new MatchSession(publicHumanEngineConfig);
  const turn = started.createTurnPayload();
  started.submitSeatMove({ color: 'white', turnId: turn.turnId, moveUci: 'e2e4' });
  assert.throws(() => started.abort('black'), /ABORT_NOT_ALLOWED/);
});

test('checkmate move completes lifecycle and later controls retain completion', () => {
  const match = new MatchSession(publicHumanEngineConfig);
  for (const [color, moveUci] of [
    ['white', 'f2f3'], ['black', 'e7e5'], ['white', 'g2g4'], ['black', 'd8h4'],
  ]) {
    const turn = match.createTurnPayload();
    match.submitSeatMove({ color, turnId: turn.turnId, moveUci });
  }

  assert.deepEqual(match.snapshot().game.result, '0-1');
  assert.equal(match.snapshot().status, 'completed');
  assert.equal(match.snapshot().termination, 'checkmate');
  assert.equal(match.activeTurn(), null);
  assert.deepEqual(match.abort('white'), {
    status: 'completed', termination: 'checkmate', result: '0-1',
  });
  assert.equal(match.snapshot().status, 'completed');
});

test('draw move completes lifecycle', () => {
  const match = new MatchSession(publicHumanEngineConfig);
  match.game = new AgentChessGame({ fen: '4k3/8/8/8/8/8/3n4/2B1K3 w - - 0 1' });

  const turn = match.createTurnPayload();
  match.submitSeatMove({ color: 'white', turnId: turn.turnId, moveUci: 'c1d2' });

  assert.equal(match.snapshot().game.result, '1/2-1/2');
  assert.equal(match.snapshot().status, 'completed');
  assert.equal(match.snapshot().termination, 'draw');
  assert.equal(match.activeTurn(), null);
});

test('failure activity exposes fixed summary and validated code without caller message', () => {
  const match = new MatchSession(publicHumanEngineConfig);
  const secret = 'sk-live-secret private prompt /Users/nicholasdias/private-reasoning';

  match.fail('ENGINE_FAILURE', secret);

  const snapshot = match.snapshot();
  const record = match.exportRecord();
  assert.deepEqual(snapshot.activity.at(-1), {
    type: 'match.fail', source: 'system', kind: null, phase: 'failed',
    at: snapshot.activity.at(-1).at, turnId: null, summary: 'Match failed',
    candidates: [], selectedMove: null, code: 'ENGINE_FAILURE',
  });
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.equal(JSON.stringify(record).includes(secret), false);
});

test('public snapshot exposes generic seats without controller state', () => {
  const match = new MatchSession(publicHumanEngineConfig);
  const snapshot = match.snapshot();

  assert.deepEqual(snapshot.seats, publicHumanEngineConfig.seats);
  assert.equal(snapshot.mode, 'exhibition');
  assert.equal(snapshot.visibility, 'public');
  assert.equal('agentColor' in snapshot, false);
  assert.equal('currentTurnId' in snapshot, false);
});

test('exports config, PGN, and activity without internal controller fields', () => {
  const match = new MatchSession(publicHumanEngineConfig);
  const turn = match.createTurnPayload();
  match.submitSeatMove({ color: 'white', turnId: turn.turnId, moveUci: 'e2e4' });

  const record = match.exportRecord();

  assert.deepEqual(record.config.seats, publicHumanEngineConfig.seats);
  assert.match(record.pgn, /\[White "Human"\]/);
  assert.ok(record.activity.some((entry) => entry.type === 'move.submit'));
  assert.equal('currentTurnId' in record, false);
  assert.equal('currentTurnPayload' in record, false);
});

test('locked matches reject steering', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  assert.throws(() => match.queueSteering('Play aggressively'), /STEERING_LOCKED/);
});

test('trainer guidance appears on the next agent turn and remains stable during replay', () => {
  const match = new MatchSession({ steeringMode: 'trainer', agentColor: 'white' });
  match.queueSteering('Control the center');

  const turn = match.createTurnPayload();
  assert.equal(turn.steering.mode, 'trainer');
  assert.equal(turn.steering.guidance, 'Control the center');
  assert.equal(match.createTurnPayload().steering.guidance, 'Control the center');
});

test('replays an active turn unchanged and reserves newly queued guidance for its successor', () => {
  const match = new MatchSession({ steeringMode: 'trainer', agentColor: 'white' });
  match.queueSteering('Control the center');
  const first = match.createTurnPayload();
  match.queueSteering('Avoid exchanges');

  assert.deepEqual(match.createTurnPayload(), first);
  match.submitAgentMove({ turnId: first.turnId, moveUci: 'e2e4' });
  match.submitOpponentMove('e7e5');
  assert.equal(match.createTurnPayload().steering.guidance, 'Avoid exchanges');
});

test('records turn start activity once when recreating an active turn payload', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });

  const first = match.createTurnPayload();
  const repeated = match.createTurnPayload();

  assert.equal(repeated.turnId, first.turnId);
  assert.equal(match.snapshot().activity.filter((entry) => entry.type === 'turn.start' && entry.turnId === first.turnId).length, 1);
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
    kind: 'decision',
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

test('returns an empty history page when limit is zero', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const first = match.createTurnPayload();
  match.submitAgentMove({ turnId: first.turnId, moveUci: 'e2e4' });
  match.submitOpponentMove('e7e5');
  const second = match.createTurnPayload();
  assert.deepEqual(match.listHistory({ turnId: second.turnId, limit: 0 }).moves, []);
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
    kind: 'decision',
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
