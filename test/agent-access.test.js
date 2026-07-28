import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchSession } from '../src/match.js';
import { createAgentAccessService } from '../src/agent-access.js';

function agentMatch() {
  return new MatchSession({
    mode: 'private_eval', visibility: 'private',
    seats: {
      white: { kind: 'agent', name: 'Agent' },
      black: { kind: 'human', name: 'Human' },
    },
  });
}

test('expires invitations after 180 seconds and allows only one claim', () => {
  let now = 1_000;
  const service = createAgentAccessService({ now: () => now, tokenFactory: () => 'session-token' });
  const match = agentMatch();
  const invitation = service.registerInvitation({ session: match, color: 'white' });
  assert.equal(service.describeInvitation(invitation.claimToken).expiresAt, 181_000);
  const claimed = service.claimInvitation(invitation.claimToken);
  assert.equal(claimed.sessionToken, 'session-token');
  assert.throws(() => service.claimInvitation(invitation.claimToken), /INVITATION_ALREADY_CLAIMED/);
  const expired = service.registerInvitation({ session: match, color: 'white' });
  now = 181_001;
  assert.throws(() => service.claimInvitation(expired.claimToken), /INVITATION_EXPIRED/);
});

test('reuses an expired invitation token after TTL cleanup', () => {
  let now = 1_000;
  const service = createAgentAccessService({ now: () => now });
  const match = agentMatch();
  service.registerInvitation({ session: match, color: 'white', claimToken: 'expired-token' });

  now = 181_001;
  const replacement = service.registerInvitation({ session: match, color: 'white', claimToken: 'expired-token' });

  assert.equal(replacement.claimToken, 'expired-token');
});

test('reuses a claimed invitation token after its replay window', () => {
  let now = 1_000;
  const service = createAgentAccessService({ now: () => now, tokenFactory: () => 'session-token' });
  const match = agentMatch();
  service.registerInvitation({ session: match, color: 'white', claimToken: 'claimed-token' });
  service.claimInvitation('claimed-token');

  now = 181_001;
  const replacement = service.registerInvitation({ session: match, color: 'white', claimToken: 'claimed-token' });

  assert.equal(replacement.claimToken, 'claimed-token');
});

test('deletes a closed session and permits token reuse', () => {
  let tokenReads = 0;
  const service = createAgentAccessService({
    tokenFactory: () => {
      tokenReads += 1;
      return tokenReads < 3 ? 'session-token' : 'fallback-token';
    },
  });
  const match = agentMatch();
  const firstInvitation = service.registerInvitation({ session: match, color: 'white' });
  const first = service.claimInvitation(firstInvitation.claimToken);
  assert.deepEqual(service.closeSession(first.sessionToken), { closed: true });
  assert.throws(() => service.authenticate(first.sessionToken), /UNAUTHORIZED/);

  const secondInvitation = service.registerInvitation({ session: match, color: 'white' });
  const second = service.claimInvitation(secondInvitation.claimToken);

  assert.equal(second.sessionToken, 'session-token');
});

test('derives invitation expiry from one clock read and marks an accepted replay', () => {
  let reads = 0;
  const service = createAgentAccessService({ now: () => 1_000 + reads++, tokenFactory: () => 'token' });
  const match = agentMatch();
  const invitation = service.registerInvitation({ session: match, color: 'white' });
  assert.equal(invitation.expiresAt, 181_000);
  const { sessionToken } = service.claimInvitation(invitation.claimToken);
  const turn = service.joinMatch(sessionToken).turn;
  const first = service.submitMove(sessionToken, { turnId: turn.turnId, moveUci: 'e2e4' });
  assert.equal(first.replayed, false);
  assert.equal(service.submitMove(sessionToken, { turnId: turn.turnId, moveUci: 'e2e4' }).replayed, true);
});

test('keeps claimed session authenticated through terminal read and replays same move only', () => {
  let serial = 0;
  const service = createAgentAccessService({ tokenFactory: () => `token-${++serial}` });
  const match = agentMatch();
  const invitation = service.registerInvitation({ session: match, color: 'white' });
  const { sessionToken } = service.claimInvitation(invitation.claimToken);
  const turn = service.joinMatch(sessionToken).turn;
  assert.equal(service.authenticate(sessionToken).color, 'white');
  const first = service.submitMove(sessionToken, { turnId: turn.turnId, moveUci: 'e2e4' });
  assert.equal(first.accepted, true);
  assert.deepEqual(service.submitMove(sessionToken, { turnId: turn.turnId, moveUci: 'e2e4' }), { ...first, replayed: true });
  assert.throws(() => service.submitMove(sessionToken, { turnId: turn.turnId, moveUci: 'd2d4' }), /CONFLICTING_REPLAY/);
  match.resign('black');
  assert.equal(service.getResult(sessionToken).status, 'completed');
});

test('keeps stable failure code in authenticated terminal result', () => {
  const service = createAgentAccessService({ tokenFactory: () => 'token' });
  const match = agentMatch();
  const invitation = service.registerInvitation({ session: match, color: 'white' });
  const { sessionToken } = service.claimInvitation(invitation.claimToken);
  match.fail('AGENT_FAILURE', 'Decision deadline exceeded');
  assert.equal(service.getResult(sessionToken).failureCode, 'AGENT_FAILURE');
});

test('bounds long-poll requests and returns timeout without exposing a turn', async () => {
  const service = createAgentAccessService({ tokenFactory: () => 'token' });
  const match = agentMatch();
  const invitation = service.registerInvitation({ session: match, color: 'white' });
  const { sessionToken } = service.claimInvitation(invitation.claimToken);
  const turn = service.joinMatch(sessionToken).turn;
  await assert.rejects(service.awaitTurn(sessionToken, { after: turn.turnId, waitMs: 25_001 }), /INVALID_WAIT_MS/);
  assert.deepEqual(await service.awaitTurn(sessionToken, { after: turn.turnId, waitMs: 0 }), { turn: null, timeout: true });
});

test('reports a turn delivery only when a transport receives an active turn', async () => {
  const deliveries = [];
  const service = createAgentAccessService({
    tokenFactory: () => 'token',
    onTurnDelivered: (delivery) => deliveries.push(delivery),
  });
  const match = agentMatch();
  const invitation = service.registerInvitation({ session: match, color: 'white' });
  const { sessionToken } = service.claimInvitation(invitation.claimToken);
  const joined = service.joinMatch(sessionToken);
  assert.deepEqual(deliveries, [{ matchId: match.id, color: 'white', turn: joined.turn }]);
  await service.awaitTurn(sessionToken, { after: joined.turn.turnId, waitMs: 0 });
  assert.equal(deliveries.length, 1);
});
