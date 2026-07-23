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
  assert.deepEqual(service.submitMove(sessionToken, { turnId: turn.turnId, moveUci: 'e2e4' }), first);
  assert.throws(() => service.submitMove(sessionToken, { turnId: turn.turnId, moveUci: 'd2d4' }), /CONFLICTING_REPLAY/);
  match.resign('black');
  assert.equal(service.getResult(sessionToken).status, 'completed');
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
