import { randomBytes } from 'node:crypto';
import { parsePublicTrace } from './protocol.js';

const INVITATION_TTL_MS = 180_000;
const MAX_WAIT_MS = 25_000;

function opaqueToken() {
  return randomBytes(24).toString('base64url');
}

function activeTurnFor(binding) {
  const turn = binding.session.activeTurn();
  return turn?.activeColor === binding.color && turn.seatKind === 'agent' ? turn : null;
}

export function createAgentAccessService({
  now = () => Date.now(),
  tokenFactory = opaqueToken,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onTurnDelivered = () => undefined,
} = {}) {
  const invitations = new Map();
  const sessions = new Map();

  function invitationFor(claimToken) {
    const invitation = invitations.get(claimToken);
    if (!invitation || invitation.expiresAt <= now()) throw new Error('INVITATION_EXPIRED');
    return invitation;
  }

  function bindingFor(sessionToken) {
    const binding = sessions.get(sessionToken);
    if (!binding || binding.closed) throw new Error('UNAUTHORIZED');
    return binding;
  }

  function deliveredTurn(binding) {
    const turn = activeTurnFor(binding);
    if (turn) onTurnDelivered({ matchId: binding.session.id, color: binding.color, turn });
    return turn;
  }

  return {
    registerInvitation({ session, color, claimToken: requestedClaimToken, createdAt: requestedCreatedAt } = {}) {
      if (!session || !['white', 'black'].includes(color) || session.seats?.[color]?.kind !== 'agent') {
        throw new Error('INVALID_INVITATION');
      }
      let claimToken = requestedClaimToken ?? opaqueToken();
      if (typeof claimToken !== 'string' || !claimToken) throw new Error('INVALID_INVITATION');
      while (invitations.has(claimToken)) claimToken = opaqueToken();
      const createdAt = requestedCreatedAt ?? now();
      const invitation = { claimToken, session, color, createdAt, expiresAt: createdAt + INVITATION_TTL_MS, claimedAt: null };
      invitations.set(claimToken, invitation);
      return { claimToken, matchId: session.id, color, expiresAt: invitation.expiresAt };
    },

    describeInvitation(claimToken) {
      const invitation = invitationFor(claimToken);
      if (invitation.claimedAt) throw new Error('INVITATION_ALREADY_CLAIMED');
      return { matchId: invitation.session.id, color: invitation.color, expiresAt: invitation.expiresAt };
    },

    claimInvitation(claimToken) {
      const invitation = invitationFor(claimToken);
      if (invitation.claimedAt) throw new Error('INVITATION_ALREADY_CLAIMED');
      let sessionToken = tokenFactory();
      while (sessions.has(sessionToken)) sessionToken = tokenFactory();
      invitation.claimedAt = now();
      const binding = { sessionToken, session: invitation.session, color: invitation.color, claimedAt: invitation.claimedAt, lastAccepted: null, decisions: new Map(), closed: false };
      sessions.set(sessionToken, binding);
      return { sessionToken, matchId: binding.session.id, color: binding.color, claimedAt: binding.claimedAt };
    },

    authenticate(sessionToken) {
      const binding = bindingFor(sessionToken);
      return { matchId: binding.session.id, color: binding.color, claimedAt: binding.claimedAt };
    },

    joinMatch(sessionToken) {
      const binding = bindingFor(sessionToken);
      if (!binding.session.activeTurn() && !binding.session.isTerminal() && binding.session.activeSeat().color === binding.color) {
        binding.session.createTurnPayload();
      }
      return { matchId: binding.session.id, color: binding.color, turn: deliveredTurn(binding), terminal: binding.session.isTerminal() };
    },

    async awaitTurn(sessionToken, { after = null, waitMs = 0 } = {}) {
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) throw new Error('INVALID_WAIT_MS');
      const binding = bindingFor(sessionToken);
      const deadline = now() + waitMs;
      do {
        const turn = activeTurnFor(binding);
        if (turn && turn.turnId !== after) {
          onTurnDelivered({ matchId: binding.session.id, color: binding.color, turn });
          return { turn, timeout: false };
        }
        if (binding.session.isTerminal() || now() >= deadline) return { turn: null, timeout: true };
        await sleep(Math.min(25, deadline - now()));
      } while (true);
    },

    listLegalMoves(sessionToken, { turnId } = {}) {
      const binding = bindingFor(sessionToken);
      if (!activeTurnFor(binding) || activeTurnFor(binding).turnId !== turnId) throw new Error('STALE_TURN');
      return binding.session.listAllMoves({ turnId });
    },

    publishDecision(sessionToken, { turnId, publicTrace, ...trace } = {}) {
      const binding = bindingFor(sessionToken);
      if (!activeTurnFor(binding) || activeTurnFor(binding).turnId !== turnId) throw new Error('STALE_TURN');
      const decision = parsePublicTrace(publicTrace ?? trace);
      binding.decisions.set(turnId, decision);
      return { accepted: true, turnId, publicTrace: decision };
    },

    publishStatus(sessionToken, { turnId, publicTrace, ...trace } = {}) {
      const binding = bindingFor(sessionToken);
      if (!activeTurnFor(binding) || activeTurnFor(binding).turnId !== turnId) throw new Error('STALE_TURN');
      const parsed = parsePublicTrace(publicTrace ?? trace);
      const status = { source: parsed.source, phase: parsed.phase, summary: parsed.summary };
      const entry = binding.session.publishTrace({ turnId, ...status });
      return { accepted: true, turnId, publicTrace: { ...status, candidates: [], selectedMove: null }, activity: entry };
    },

    submitMove(sessionToken, { turnId, moveUci, publicTrace } = {}) {
      const binding = bindingFor(sessionToken);
      const last = binding.lastAccepted;
      if (last?.turnId === turnId) {
        if (last.moveUci === moveUci) return { ...last.result, replayed: true };
        throw new Error('CONFLICTING_REPLAY');
      }
      if (!activeTurnFor(binding) || activeTurnFor(binding).turnId !== turnId) throw new Error('STALE_TURN');
      const applied = binding.session.submitSeatMove({
        color: binding.color, turnId, moveUci, publicTrace: publicTrace ? parsePublicTrace(publicTrace) : binding.decisions.get(turnId),
      });
      const result = { accepted: true, turnId, moveUci: applied.uci, moveSan: applied.san, terminal: binding.session.isTerminal(), replayed: false };
      binding.lastAccepted = { turnId, moveUci, result };
      return result;
    },

    getResult(sessionToken) {
      const binding = bindingFor(sessionToken);
      const snapshot = binding.session.snapshot();
      return {
        status: snapshot.status,
        termination: snapshot.termination,
        result: snapshot.game.result,
        pgn: snapshot.pgn,
        ...(snapshot.status === 'failed' ? { failureCode: snapshot.failureCode } : {}),
      };
    },

    closeSession(sessionToken) {
      const binding = bindingFor(sessionToken);
      binding.closed = true;
      return { closed: true };
    },
  };
}

export { INVITATION_TTL_MS, MAX_WAIT_MS };
