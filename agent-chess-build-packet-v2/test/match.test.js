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
  assert.deepEqual(second.movesUci, ['e2e4', 'e7e5']);
  assert.equal(second.color, 'white');
});

test('stores only explicit structured trace summaries', () => {
  const match = new MatchSession({ steeringMode: 'locked', agentColor: 'white' });
  const entry = match.publishTrace({ phase: 'planning', summary: 'Develop the kingside knight.' });

  assert.equal(entry.type, 'agent.trace');
  assert.equal(entry.phase, 'planning');
  assert.equal(match.snapshot().trace.at(-1).summary, 'Develop the kingside knight.');
});
