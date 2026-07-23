import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import packageJson from '../package.json' with { type: 'json' };
import { WebSocketServer, WebSocket } from 'ws';
import { MatchSession } from './match.js';
import { StockfishEngine } from './stockfish.js';
import { createAgentAccessService } from './agent-access.js';
import { AGENT_REST_ACTIONS, MESSAGE_TYPES, parseClientMessage } from './protocol.js';

function errorCode(error) {
  const code = String(error.message).split(':')[0];
  return code === 'ILLEGAL_MOVE' ? 'MOVE_NOT_LEGAL' : code;
}

function rejectedTurnId(raw) {
  try {
    const message = JSON.parse(raw.toString());
    if (![
      MESSAGE_TYPES.MOVES_LIST,
      MESSAGE_TYPES.MOVES_LIST_ALL,
      MESSAGE_TYPES.HISTORY_LIST,
      MESSAGE_TYPES.MOVE_VALIDATE,
      MESSAGE_TYPES.MOVE_SUBMIT,
      MESSAGE_TYPES.TRACE_PUBLISH,
    ].includes(message?.type)) return null;
    return typeof message.turnId === 'string' && message.turnId.trim() ? message.turnId.trim() : null;
  } catch {
    return null;
  }
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function safeSend(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export function normalizeTurnPaceMs(session, requestedMs) {
  if (session?.mode !== 'exhibition' || session?.visibility !== 'public') return 0;
  if (!Number.isInteger(requestedMs) || requestedMs < 0) return 0;
  return Math.min(requestedMs, 5_000);
}

function publicSnapshot(record) {
  const turn = record.session.activeTurn();
  return {
    ...record.session.snapshot(),
    activeTurn: turn && {
      protocolVersion: turn.protocolVersion,
      gameId: turn.gameId,
      turnId: turn.turnId,
      fen: turn.fen,
      ply: turn.ply,
      positionStatus: turn.positionStatus,
      deadline: turn.deadline,
      deadlineMs: turn.deadlineMs,
      activeColor: turn.activeColor,
      seatKind: turn.seatKind,
      mode: turn.mode,
    },
    connected: [...record.agentSockets.values()].some((socket) => socket?.readyState === WebSocket.OPEN),
    ...(record.evaluation ? { evaluation: record.evaluation } : {}),
    ...(record.hasEngine ? { engine: {
      name: 'Stockfish 18 Lite',
      package: `stockfish@${packageJson.dependencies.stockfish}`,
      profileId: `stockfish-skill-${record.skillLevel}-movetime-${record.movetimeMs}`,
      skillLevel: record.skillLevel,
      movetimeMs: record.movetimeMs,
      hostBuild: process.env.AGENT_CHESS_BUILD_ID ?? `${packageJson.name}@${packageJson.version}`,
    } } : {}),
  };
}

function contentType(path) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
  })[extname(path)] ?? 'application/octet-stream';
}

export function createAgentChessServer({
  stockfishFactory = (options) => StockfishEngine.start(options),
  publicDir = PUBLIC_DIR,
  ticketNow = () => Date.now(),
  waitForTurnTransition = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const matches = new Map();
  const seatByToken = new Map();
  const seatByTicket = new Map();
  const agentAccess = createAgentAccessService({ now: ticketNow });
  const terminalDelivered = new WeakSet();
  const agentWss = new WebSocketServer({ noServer: true });
  const eventWss = new WebSocketServer({ noServer: true });
  let httpServer;
  function removeExpiredTickets() {
    for (const [ticket, binding] of seatByTicket) {
      if (binding.expiresAt <= ticketNow()) seatByTicket.delete(ticket);
    }
  }

  function invitationContract(request, binding, ticket) {
    const protocol = request.socket.encrypted ? 'wss:' : 'ws:';
    const host = request.headers.host ?? 'localhost';
    return {
      service: { name: 'Agent Chess', version: packageJson.version },
      protocolVersion: '2.0',
      match: { id: binding.matchId, mode: binding.record.session.mode, visibility: binding.record.session.visibility },
      seat: { color: binding.color, kind: binding.kind, name: binding.record.session.seats[binding.color].name },
      security: {
        secretHandling: 'This URL is secret, expires, and remains single-use for connection. Keep credentials, prompts, private memory, local files, and raw reasoning local.',
        expiresAt: new Date(binding.expiresAt).toISOString(),
      },
      connection: {
        wsUrl: `${protocol}//${host}/agent?ticket=${encodeURIComponent(ticket)}`,
        rest: { claimUrl: `${request.socket.encrypted ? 'https:' : 'http:'}//${host}/api/agent/claim?ticket=${encodeURIComponent(ticket)}`, actions: AGENT_REST_ACTIONS },
        mcp: { url: `${request.socket.encrypted ? 'https:' : 'http:'}//${host}/mcp/agent?ticket=${encodeURIComponent(ticket)}` },
        websocket: { url: `${protocol}//${host}/agent?ticket=${encodeURIComponent(ticket)}` },
      },
      instructions: {
        actionOrder: [
          'Open WebSocket.', 'Wait for match.start and turn.start.', 'Optionally request probes.',
          'Publish only sanitized status.', 'Submit legal UCI plus bounded publicTrace.', 'Handle accepted, rejected, and end.',
        ],
      },
      messageFlow: {
        receive: ['match.start', 'turn.start', 'move.accepted', 'move.rejected', 'game.end'],
        send: ['moves.list', 'moves.list_all', 'history.list', 'move.validate', 'trace.publish', 'move.submit'],
      },
      publicTrace: {
        requiredForPublicExhibition: binding.record.session.mode === 'exhibition' && binding.record.session.visibility === 'public',
        limit: 'Submit concise structured status only; never raw reasoning.',
        phases: ['observe', 'probe', 'evaluate', 'choose', 'submit'],
        statusExample: {
          type: 'trace.publish', turnId: '<turnId>', source: 'agent_reported',
          phase: 'probe', summary: 'Comparing forcing moves and king safety.',
        },
        decisionExample: {
          type: 'move.submit', turnId: '<turnId>', moveUci: 'g1f3',
          publicTrace: {
            source: 'agent_reported', phase: 'choose', summary: 'Develops while protecting the king.',
            candidates: [{ uci: 'g1f3', note: 'Development and king safety.' }], selectedMove: 'g1f3',
          },
        },
      },
    };
  }
  function bearer(request) {
    const value = request.headers.authorization;
    return typeof value === 'string' && /^Bearer .+$/i.test(value) ? value.slice(7) : null;
  }

  function seatForToken(request, record, kind = null) {
    const seat = seatByToken.get(bearer(request));
    return seat?.record === record && (!kind || seat.kind === kind) ? seat : null;
  }

  function restSession(request) {
    const token = bearer(request);
    if (!token) throw new Error('UNAUTHORIZED');
    return { token, ...agentAccess.authenticate(token) };
  }

  function agentConnection(request, invitation) {
    const protocol = request.socket.encrypted ? 'https:' : 'http:';
    const wsProtocol = request.socket.encrypted ? 'wss:' : 'ws:';
    const host = request.headers.host ?? 'localhost';
    const ticket = encodeURIComponent(invitation.claimToken);
    return {
      ticket: invitation.claimToken,
      expiresAt: new Date(invitation.expiresAt).toISOString(),
      connection: {
        rest: { claimUrl: `${protocol}//${host}/api/agent/claim?ticket=${ticket}`, actions: AGENT_REST_ACTIONS },
        mcp: { url: `${protocol}//${host}/mcp/agent?ticket=${ticket}` },
        websocket: { url: `${wsProtocol}//${host}/agent?ticket=${ticket}` },
      },
      schemas: { decision: { turnId: 'string', source: 'string', phase: 'string', summary: 'string', selectedMove: 'uci' }, move: { turnId: 'string', moveUci: 'uci' } },
      actionOrder: ['Claim invitation.', 'Read match or await turn.', 'List legal moves.', 'Publish sanitized decision.', 'Submit move.', 'Read result.'],
      retry: { sameMove: 'idempotent', conflictingMove: 'CONFLICTING_REPLAY', staleTurn: 'STALE_TURN' },
    };
  }

  function closeEngine(record) {
    if (!record.engine || record.engineClosed) return;
    record.engineClosed = true;
    record.engine.close();
  }

  function clearDecisionDeadline(record) {
    if (record.decisionTimer) clearTimeout(record.decisionTimer);
    record.decisionTimer = null;
  }

  function terminalMessage(record) {
    const snapshot = record.session.snapshot();
    const ended = {
      type: MESSAGE_TYPES.GAME_END,
      matchId: record.session.id,
      result: snapshot.game.result,
      pgn: record.session.game.pgn(),
      status: snapshot.status,
      termination: snapshot.termination,
      ...(snapshot.status === 'failed' ? { failureCode: snapshot.failureCode } : {}),
    };
    return ended;
  }

  function sendTerminal(socket, ended) {
    if (terminalDelivered.has(socket)) return;
    terminalDelivered.add(socket);
    safeSend(socket, ended);
  }

  function emitTerminal(record, socket = null) {
    const ended = terminalMessage(record);
    if (socket) sendTerminal(socket, ended);
    if (record.terminalEmitted) return;
    record.terminalEmitted = true;
    clearDecisionDeadline(record);
    record.deadlineTurnId = null;
    for (const socket of record.agentSockets.values()) sendTerminal(socket, ended);
    broadcast(record, ended);
    broadcastState(record);
    closeEngine(record);
  }

  function armDecisionDeadline(record, turn) {
    if (!record.decisionDeadlineMs) return;
    if (record.deadlineTurnId === turn.turnId) return;
    clearDecisionDeadline(record);
    const expiresAt = Date.now() + record.decisionDeadlineMs;
    record.deadlineTurnId = turn.turnId;
    turn.deadline = new Date(expiresAt).toISOString();
    turn.deadlineMs = record.decisionDeadlineMs;
    record.decisionTimer = setTimeout(() => {
      if (record.session.activeTurn()?.turnId !== turn.turnId || record.session.isTerminal()) return;
      record.session.fail('AGENT_FAILURE', 'Decision deadline exceeded');
      signalFailure(record, 'AGENT_FAILURE', 'Agent decision deadline exceeded');
      emitTerminal(record);
    }, record.decisionDeadlineMs);
  }

  function broadcast(record, message) {
    for (const socket of record.observers) safeSend(socket, message);
  }

  function broadcastState(record) {
    broadcast(record, { type: MESSAGE_TYPES.STATE, match: publicSnapshot(record) });
  }

  async function pauseTurnTransition(record) {
    if (record.turnPaceMs > 0) await waitForTurnTransition(record.turnPaceMs);
  }

  function signalFailure(record, code, message) {
    const event = { type: MESSAGE_TYPES.ERROR, code, message, recoverable: false };
    for (const socket of record.agentSockets.values()) safeSend(socket, event);
    broadcast(record, event);
  }

  async function refreshEvaluation(record) {
    if (!record.engine?.evaluate || record.session.isTerminal()) return;
    const fen = record.session.game.snapshot().fen;
    if (record.evaluationFen === fen) return;
    if (record.evaluationPromise) {
      await record.evaluationPromise;
      if (record.evaluationFen === fen) return;
    }
    const request = record.engine.evaluate(fen, { movetimeMs: Math.max(50, Math.min(100, record.movetimeMs)) })
      .then((evaluation) => {
        if (record.session.game.snapshot().fen !== fen) return;
        record.evaluation = evaluation;
        record.evaluationFen = fen;
      })
      .catch(() => undefined)
      .finally(() => {
        if (record.evaluationPromise === request) record.evaluationPromise = null;
      });
    record.evaluationPromise = request;
    await request;
  }

  async function advance(record) {
    if (record.advancing || record.engineFailed) return;
    if (record.session.isTerminal()) return emitTerminal(record);
    const state = record.session.game.snapshot();
    if (state.gameOver) {
      return emitTerminal(record);
    }
    await refreshEvaluation(record);
    const seat = record.session.activeSeat();
    if (seat.kind === 'human') {
      record.session.createTurnPayload();
      broadcastState(record);
      return;
    }
    if (seat.kind === 'agent') {
      const turn = record.session.createTurnPayload();
      armDecisionDeadline(record, turn);
      safeSend(record.agentSockets.get(seat.color), turn);
      broadcastState(record);
      return;
    }

    record.advancing = true;
    let turn;
    try {
      turn = record.session.createTurnPayload();
      const moveUci = await record.engine.bestMove(turn.fen, record.engineConfig);
      if (record.session.isTerminal() || record.session.activeTurn()?.turnId !== turn.turnId) return;
      const applied = record.session.submitSeatMove({ color: seat.color, turnId: turn.turnId, moveUci });
      const event = {
        type: MESSAGE_TYPES.OPPONENT_MOVE,
        matchId: record.session.id,
        moveUci: applied.uci,
        moveSan: applied.san,
      };
      for (const socket of record.agentSockets.values()) safeSend(socket, event);
      broadcast(record, event);
      broadcastState(record);
    } catch (error) {
      if (record.session.isTerminal() || record.session.activeTurn()?.turnId !== turn?.turnId) return;
      record.engineFailed = true;
      record.session.recordSystemError('Engine unavailable', 'ENGINE_FAILURE');
      record.session.fail('ENGINE_FAILURE');
      signalFailure(record, 'ENGINE_FAILURE', 'Engine unavailable');
      emitTerminal(record);
      broadcastState(record);
    } finally {
      record.advancing = false;
    }
    if (!record.engineFailed) {
      await pauseTurnTransition(record);
      await advance(record);
    }
  }

  agentWss.on('connection', (socket, request, binding) => {
    const { record, color } = binding;
    const oldSocket = record.agentSockets.get(color);
    if (oldSocket?.readyState === WebSocket.OPEN) oldSocket.close(4001, 'seat replaced');
    record.agentSockets.set(color, socket);
    socket.on('close', () => {
      if (record.agentSockets.get(color) === socket) record.agentSockets.delete(color);
      broadcastState(record);
    });
    socket.on('message', async (raw) => {
      let message;
      try {
        message = parseClientMessage(raw);
        const active = record.session.activeSeat();
        if (active.kind !== 'agent' || active.color !== color) throw new Error('SEAT_NOT_ACTIVE');
        if (record.session.mode === 'private_eval' && message.type === MESSAGE_TYPES.TRACE_PUBLISH) {
          throw new Error('TRACE_NOT_ALLOWED');
        }
        if (record.session.mode === 'private_eval' && message.type === MESSAGE_TYPES.MOVE_SUBMIT) {
          delete message.publicTrace;
        }
        switch (message.type) {
          case MESSAGE_TYPES.MOVES_LIST: {
            const result = record.session.listMovesForPiece(message);
            safeSend(socket, {
              type: MESSAGE_TYPES.MOVES_LIST_RESULT,
              ...result,
              piece: record.session.game.getMovablePieces().find((piece) => piece.square === message.square)?.piece,
            });
            broadcastState(record);
            return;
          }
          case MESSAGE_TYPES.MOVES_LIST_ALL: {
            const result = record.session.listAllMoves(message);
            safeSend(socket, { type: MESSAGE_TYPES.MOVES_LIST_ALL_RESULT, ...result });
            broadcastState(record);
            return;
          }
          case MESSAGE_TYPES.HISTORY_LIST: {
            const result = record.session.listHistory(message);
            safeSend(socket, {
              type: MESSAGE_TYPES.HISTORY_LIST_RESULT,
              ...result,
              hasMore: result.moves.length > 0 && result.moves[0].ply > 1,
            });
            broadcastState(record);
            return;
          }
          case MESSAGE_TYPES.MOVE_VALIDATE: {
            const result = record.session.validateCandidate(message);
            safeSend(socket, { type: MESSAGE_TYPES.MOVE_VALIDATE_RESULT, turnId: message.turnId, ...result });
            broadcastState(record);
            return;
          }
          case MESSAGE_TYPES.TRACE_PUBLISH: {
            const entry = record.session.publishTrace(message);
            broadcast(record, { type: MESSAGE_TYPES.TRACE_PUBLISH, entry });
            broadcastState(record);
            return;
          }
          case MESSAGE_TYPES.MOVE_SUBMIT: {
            const applied = record.session.submitAgentMove(message);
            clearDecisionDeadline(record);
            record.deadlineTurnId = null;
            const accepted = {
              type: MESSAGE_TYPES.MOVE_ACCEPTED,
              matchId: record.session.id,
              turnId: message.turnId,
              moveUci: applied.uci,
              moveSan: applied.san,
            };
            safeSend(socket, accepted);
            broadcast(record, accepted);
            broadcastState(record);
            await pauseTurnTransition(record);
            await advance(record);
            return;
          }
          default:
            throw new Error('UNSUPPORTED_MESSAGE');
        }
      } catch (error) {
        safeSend(socket, {
          type: MESSAGE_TYPES.MOVE_REJECTED,
          code: errorCode(error),
          message: error.message,
          turnId: message?.turnId ?? rejectedTurnId(raw),
        });
      }
    });

    setTimeout(() => {
      safeSend(socket, {
        type: MESSAGE_TYPES.MATCH_START,
        matchId: record.session.id,
        steeringMode: record.session.steeringMode,
        agentColor: color,
      });
      broadcastState(record);
      if (record.session.isTerminal()) return emitTerminal(record, socket);
      advance(record).catch(() => undefined);
    }, 0);
  });

  eventWss.on('connection', (socket, request, record) => {
    record.observers.add(socket);
    socket.on('close', () => record.observers.delete(socket));
    safeSend(socket, { type: MESSAGE_TYPES.STATE, match: publicSnapshot(record) });
  });

  async function handleApi(request, response, url) {
    if (request.method === 'POST' && url.pathname === '/api/matches') {
      const body = await readJson(request);
      const session = new MatchSession({
        ...body,
      });
      const legacy = Boolean(session.compatibility);
      const engineConfig = {
        movetimeMs: session.engine.movetimeMs,
        skillLevel: session.engine.skillLevel,
      };
      const hasEngine = Object.values(session.seats).some((seat) => seat.kind === 'engine');
      let engine = null;
      if (hasEngine) {
        try {
          engine = await stockfishFactory(engineConfig);
        } catch {
          sendJson(response, 503, { error: 'ENGINE_UNAVAILABLE', message: 'Engine unavailable' });
          return true;
        }
      }
      const record = {
        session,
        engine,
        hasEngine,
        engineConfig,
        skillLevel: engineConfig.skillLevel,
        movetimeMs: engineConfig.movetimeMs,
        legacy,
        agentSockets: new Map(),
        observers: new Set(),
        advancing: false,
        engineFailed: false,
        engineClosed: false,
        terminalEmitted: false,
        decisionDeadlineMs: Number.isInteger(body.decisionDeadlineMs) && body.decisionDeadlineMs > 0
          ? Math.min(body.decisionDeadlineMs, 300_000) : null,
        decisionTimer: null,
        deadlineTurnId: null,
        turnPaceMs: normalizeTurnPaceMs(session, body.turnPaceMs),
        evaluation: null,
        evaluationFen: null,
        evaluationPromise: null,
      };
      matches.set(session.id, record);
      const capabilities = {};
      for (const [color, seat] of Object.entries(session.seats)) {
        if (!['human', 'agent'].includes(seat.kind)) continue;
        const capability = randomBytes(24).toString('base64url');
        seatByToken.set(capability, { record, color, kind: seat.kind });
        capabilities[color] = capability;
      }
      const created = {
        matchId: session.id,
        capabilities,
        uiPath: `/?match=${encodeURIComponent(session.id)}`,
      };
      if (legacy) {
        const agentColor = Object.entries(session.seats).find(([, seat]) => seat.kind === 'agent')?.[0];
        const seatToken = capabilities[agentColor];
        created.seatToken = seatToken;
        created.agentWsPath = `/agent?token=${encodeURIComponent(seatToken)}`;
      }
      sendJson(response, 201, created);
      advance(record).catch(() => undefined);
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/agent-sessions') {
      removeExpiredTickets();
      const binding = seatByToken.get(bearer(request));
      if (!binding || binding.kind !== 'agent') return sendJson(response, 401, { error: 'UNAUTHORIZED' }), true;
      const ticket = randomBytes(24).toString('base64url');
      const expiresAt = new Date(ticketNow() + 180_000);
      seatByTicket.set(ticket, { ...binding, matchId: binding.record.session.id, expiresAt: expiresAt.getTime() });
      agentAccess.registerInvitation({ session: binding.record.session, color: binding.color, claimToken: ticket });
      sendJson(response, 201, {
        ticket,
        wsPath: `/agent?ticket=${encodeURIComponent(ticket)}`,
        joinPath: `/agent/join?ticket=${encodeURIComponent(ticket)}`,
        expiresAt: expiresAt.toISOString(),
      });
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/agent-connections') {
      const binding = seatByToken.get(bearer(request));
      if (!binding || binding.kind !== 'agent') return sendJson(response, 401, { error: 'UNAUTHORIZED' }), true;
      const invitation = agentAccess.registerInvitation({ session: binding.record.session, color: binding.color });
      seatByTicket.set(invitation.claimToken, { ...binding, matchId: binding.record.session.id, expiresAt: invitation.expiresAt });
      sendJson(response, 201, agentConnection(request, invitation), { 'cache-control': 'no-store' });
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/agent/claim') {
      try {
        const claimed = agentAccess.claimInvitation(url.searchParams.get('ticket'));
        seatByTicket.delete(url.searchParams.get('ticket'));
        sendJson(response, 201, claimed, { 'cache-control': 'no-store' });
      } catch (error) {
        sendJson(response, error.message === 'INVITATION_EXPIRED' ? 410 : 409, { error: error.message });
      }
      return true;
    }

    if (url.pathname === '/api/agent/match' && request.method === 'GET') {
      try {
        sendJson(response, 200, agentAccess.joinMatch(restSession(request).token));
      } catch (error) { sendJson(response, 401, { error: error.message }); }
      return true;
    }

    if (url.pathname === '/api/agent/turn' && request.method === 'GET') {
      try {
        const waitMs = url.searchParams.get('waitMs') === null ? 0 : Number(url.searchParams.get('waitMs'));
        sendJson(response, 200, await agentAccess.awaitTurn(restSession(request).token, { after: url.searchParams.get('after'), waitMs }));
      } catch (error) { sendJson(response, error.message === 'UNAUTHORIZED' ? 401 : 400, { error: error.message }); }
      return true;
    }

    if (url.pathname === '/api/agent/legal-moves' && request.method === 'GET') {
      try {
        sendJson(response, 200, agentAccess.listLegalMoves(restSession(request).token, { turnId: url.searchParams.get('turnId') }));
      } catch (error) { sendJson(response, error.message === 'UNAUTHORIZED' ? 401 : error.message === 'STALE_TURN' ? 409 : 400, { error: error.message }); }
      return true;
    }

    if ((url.pathname === '/api/agent/decision' || url.pathname === '/api/agent/move') && request.method === 'POST') {
      try {
        const access = restSession(request);
        const body = await readJson(request);
        if (url.pathname === '/api/agent/decision') {
          sendJson(response, 202, agentAccess.publishDecision(access.token, body));
        } else {
          const result = agentAccess.submitMove(access.token, body);
          const record = matches.get(access.matchId);
          clearDecisionDeadline(record);
          record.deadlineTurnId = null;
          broadcastState(record);
          sendJson(response, 202, result);
          await pauseTurnTransition(record);
          await advance(record);
        }
      } catch (error) {
        const code = errorCode(error);
        sendJson(response, code === 'UNAUTHORIZED' ? 401 : ['STALE_TURN', 'CONFLICTING_REPLAY', 'SEAT_NOT_ACTIVE'].includes(code) ? 409 : 400, { accepted: false, error: code });
      }
      return true;
    }

    if (url.pathname === '/api/agent/result' && request.method === 'GET') {
      try { sendJson(response, 200, agentAccess.getResult(restSession(request).token)); }
      catch (error) { sendJson(response, 401, { error: error.message }); }
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/agent/join') {
      removeExpiredTickets();
      const ticket = url.searchParams.get('ticket');
      const binding = ticket && seatByTicket.get(ticket);
      if (!binding) return sendJson(response, 410, { error: 'INVITATION_EXPIRED' }, { 'cache-control': 'no-store' }), true;
      sendJson(response, 200, invitationContract(request, binding, ticket), { 'cache-control': 'no-store' });
      return true;
    }

    const matchRoute = url.pathname.match(/^\/api\/matches\/([^/]+)$/);
    if (request.method === 'GET' && matchRoute) {
      const record = matches.get(decodeURIComponent(matchRoute[1]));
      if (!record) return sendJson(response, 404, { error: 'MATCH_NOT_FOUND' }), true;
      if (record.session.visibility === 'private' && !seatForToken(request, record)) {
        return sendJson(response, 401, { error: 'UNAUTHORIZED' }), true;
      }
      sendJson(response, 200, publicSnapshot(record));
      return true;
    }

    const exportRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/export$/);
    if (request.method === 'GET' && exportRoute) {
      const record = matches.get(decodeURIComponent(exportRoute[1]));
      if (!record) return sendJson(response, 404, { error: 'MATCH_NOT_FOUND' }), true;
      if (record.session.visibility === 'private' && !seatForToken(request, record, 'human') && !seatForToken(request, record, 'agent')) {
        return sendJson(response, 401, { error: 'UNAUTHORIZED' }), true;
      }
      sendJson(response, 200, {
        ...record.session.exportRecord(),
        ...(record.hasEngine ? { engine: publicSnapshot(record).engine } : {}),
        ...(record.evaluation ? { evaluation: record.evaluation } : {}),
        protocolVersion: '2.0',
      });
      return true;
    }

    const humanRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/human-moves$/);
    const matchActionRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/(resign|abort)$/);
    if ((request.method === 'POST' && humanRoute) || (request.method === 'POST' && matchActionRoute)) {
      const matchId = decodeURIComponent((humanRoute ?? matchActionRoute)[1]);
      const record = matches.get(matchId);
      if (!record) return sendJson(response, 404, { error: 'MATCH_NOT_FOUND' }), true;
      const seat = seatForToken(request, record, 'human');
      if (!seat) return sendJson(response, 401, { error: 'UNAUTHORIZED' }), true;
      try {
        if (humanRoute) {
          const body = await readJson(request);
          const applied = record.session.submitSeatMove({ color: seat.color, turnId: body.turnId, moveUci: body.moveUci });
          clearDecisionDeadline(record);
          record.deadlineTurnId = null;
          broadcastState(record);
          sendJson(response, 202, { accepted: true, moveUci: applied.uci, moveSan: applied.san });
          await pauseTurnTransition(record);
          await advance(record);
        } else {
          const action = matchActionRoute[2];
          const result = action === 'resign' ? record.session.resign(seat.color) : record.session.abort(seat.color);
          clearDecisionDeadline(record);
          record.deadlineTurnId = null;
          emitTerminal(record);
          sendJson(response, 202, { accepted: true, ...result });
        }
      } catch (error) {
        const code = errorCode(error);
        sendJson(response, code === 'STALE_TURN' || code === 'SEAT_NOT_ACTIVE' || code === 'ABORT_NOT_ALLOWED' ? 409 : 400, { accepted: false, error: code });
      }
      return true;
    }

    const steeringRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/steering$/);
    if (request.method === 'POST' && steeringRoute) {
      const record = matches.get(decodeURIComponent(steeringRoute[1]));
      if (!record) return sendJson(response, 404, { error: 'MATCH_NOT_FOUND' }), true;
      if (!seatForToken(request, record)) return sendJson(response, 401, { error: 'UNAUTHORIZED' }), true;
      const body = await readJson(request);
      try {
        record.session.queueSteering(body.guidance);
        broadcastState(record);
        sendJson(response, 202, { accepted: true });
      } catch (error) {
        sendJson(response, 409, { accepted: false, error: error.message });
      }
      return true;
    }

    return false;
  }

  async function serveStatic(response, pathname) {
    const requested = pathname === '/' ? '/index.html' : pathname;
    const relative = normalize(requested).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]/, '');
    const path = join(publicDir, relative);
    if (!path.startsWith(publicDir)) return false;
    try {
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': contentType(path), 'content-length': body.length });
      response.end(body);
      return true;
    } catch {
      return false;
    }
  }

  return {
    matches,
    async start(port = Number(process.env.PORT ?? 3000), host = '127.0.0.1') {
      if (httpServer) throw new Error('SERVER_ALREADY_STARTED');
      httpServer = http.createServer(async (request, response) => {
        const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
        try {
          if (await handleApi(request, response, url)) return;
          if (request.method === 'GET' && await serveStatic(response, url.pathname)) return;
          sendJson(response, 404, { error: 'NOT_FOUND' });
        } catch (error) {
          sendJson(response, error.message === 'INVALID_JSON' ? 400 : 500, { error: error.message });
        }
      });

      httpServer.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
        if (url.pathname === '/agent') {
          removeExpiredTickets();
          let binding;
          const ticket = url.searchParams.get('ticket');
          if (ticket) {
            binding = seatByTicket.get(ticket);
            seatByTicket.delete(ticket);
            if (!binding || binding.expiresAt <= ticketNow()) return socket.destroy();
            try {
              agentAccess.claimInvitation(ticket);
            } catch {
              return socket.destroy();
            }
          } else {
            const legacyToken = url.searchParams.get('token');
            binding = seatByToken.get(legacyToken);
            if (!binding || !binding.record.legacy || binding.kind !== 'agent') return socket.destroy();
          }
          agentWss.handleUpgrade(request, socket, head, (ws) => {
            agentWss.emit('connection', ws, request, binding);
          });
          return;
        }
        if (url.pathname === '/events') {
          const record = matches.get(url.searchParams.get('matchId'));
          if (!record || record.session.visibility === 'private') return socket.destroy();
          eventWss.handleUpgrade(request, socket, head, (ws) => {
            eventWss.emit('connection', ws, request, record);
          });
          return;
        }
        socket.destroy();
      });

      await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, resolve);
      });
      const address = httpServer.address();
      const hostname = address.address === '::' ? '127.0.0.1' : address.address;
      return {
        port: address.port,
        httpUrl: `http://${hostname}:${address.port}`,
        wsUrl: `ws://${hostname}:${address.port}`,
      };
    },

    async stop() {
      const engines = new Set();
      for (const record of matches.values()) {
        clearDecisionDeadline(record);
        record.deadlineTurnId = null;
        for (const socket of record.agentSockets.values()) socket.close();
        for (const observer of record.observers) observer.close();
        if (record.engine) engines.add(record);
      }
      for (const record of engines) closeEngine(record);
      agentWss.close();
      eventWss.close();
      if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
        httpServer = null;
      }
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createAgentChessServer();
  const address = await server.start(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1');
  const displayHost = process.env.HOST === '0.0.0.0' ? 'localhost' : new URL(address.httpUrl).hostname;
  console.log(`Agent Chess running at http://${displayHost}:${address.port}`);
}
