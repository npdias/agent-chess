import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { MatchSession } from './match.js';
import { StockfishEngine } from './stockfish.js';
import { MESSAGE_TYPES, parseClientMessage } from './protocol.js';

function errorCode(error) {
  const code = String(error.message).split(':')[0];
  return code === 'ILLEGAL_MOVE' ? 'MOVE_NOT_LEGAL' : code;
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
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

function publicSnapshot(record) {
  return {
    ...record.session.snapshot(),
    connected: record.agentSocket?.readyState === WebSocket.OPEN,
    engine: {
      name: 'Stockfish 18 Lite',
      skillLevel: record.skillLevel,
      movetimeMs: record.movetimeMs,
    },
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
} = {}) {
  const matches = new Map();
  const byToken = new Map();
  const agentWss = new WebSocketServer({ noServer: true });
  const eventWss = new WebSocketServer({ noServer: true });
  let httpServer;
  let sharedEnginePromise;

  function getSharedEngine(options) {
    if (!sharedEnginePromise) sharedEnginePromise = stockfishFactory(options);
    return sharedEnginePromise;
  }

  function broadcast(record, message) {
    for (const socket of record.observers) safeSend(socket, message);
  }

  function broadcastState(record) {
    broadcast(record, { type: MESSAGE_TYPES.STATE, match: publicSnapshot(record) });
  }

  async function advance(record) {
    if (record.advancing) return;
    const state = record.session.game.snapshot();
    if (state.gameOver) {
      const ended = {
        type: MESSAGE_TYPES.GAME_END,
        matchId: record.session.id,
        result: state.result,
        pgn: record.session.game.pgn(),
      };
      safeSend(record.agentSocket, ended);
      broadcast(record, ended);
      broadcastState(record);
      return;
    }

    if (record.session.isAgentTurn()) {
      if (record.agentSocket?.readyState === WebSocket.OPEN) {
        safeSend(record.agentSocket, record.session.createTurnPayload());
      }
      broadcastState(record);
      return;
    }

    record.advancing = true;
    try {
      const before = record.session.game.snapshot();
      const moveUci = await record.engine.bestMove(before.fen, {
        movetimeMs: record.movetimeMs,
        skillLevel: record.skillLevel,
      });
      const applied = record.session.submitOpponentMove(moveUci);
      const event = {
        type: MESSAGE_TYPES.OPPONENT_MOVE,
        matchId: record.session.id,
        moveUci: applied.uci,
        moveSan: applied.san,
      };
      safeSend(record.agentSocket, event);
      broadcast(record, event);
      broadcastState(record);
    } catch (error) {
      const event = { type: MESSAGE_TYPES.ERROR, code: 'ENGINE_FAILURE', message: error.message };
      safeSend(record.agentSocket, event);
      broadcast(record, event);
    } finally {
      record.advancing = false;
    }
    await advance(record);
  }

  agentWss.on('connection', (socket, request, record) => {
    if (record.agentSocket?.readyState === WebSocket.OPEN) record.agentSocket.close(4001, 'seat replaced');
    record.agentSocket = socket;
    socket.on('close', () => {
      if (record.agentSocket === socket) record.agentSocket = null;
      broadcastState(record);
    });
    socket.on('message', async (raw) => {
      let message;
      try {
        message = parseClientMessage(raw);
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
          turnId: message?.turnId ?? null,
        });
      }
    });

    setTimeout(() => {
      safeSend(socket, {
        type: MESSAGE_TYPES.MATCH_START,
        matchId: record.session.id,
        steeringMode: record.session.steeringMode,
        agentColor: record.session.agentColor,
      });
      broadcastState(record);
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
      const steeringMode = body.steeringMode ?? 'locked';
      const agentColor = body.agentColor ?? 'white';
      const skillLevel = Math.max(0, Math.min(20, Number(body.skillLevel ?? 5)));
      const movetimeMs = Math.max(25, Math.min(5000, Number(body.movetimeMs ?? 150)));
      const session = new MatchSession({
        steeringMode,
        agentColor,
        agentName: String(body.agentName ?? 'Local Agent').slice(0, 80),
        opponentName: `Stockfish (skill ${skillLevel})`,
      });
      const seatToken = randomBytes(24).toString('base64url');
      const engine = await getSharedEngine({ skillLevel, movetimeMs });
      const record = {
        session,
        seatToken,
        engine,
        skillLevel,
        movetimeMs,
        agentSocket: null,
        observers: new Set(),
        advancing: false,
      };
      matches.set(session.id, record);
      byToken.set(seatToken, record);
      sendJson(response, 201, {
        matchId: session.id,
        seatToken,
        agentWsPath: `/agent?token=${encodeURIComponent(seatToken)}`,
        uiPath: `/?match=${encodeURIComponent(session.id)}`,
      });
      return true;
    }

    const matchRoute = url.pathname.match(/^\/api\/matches\/([^/]+)$/);
    if (request.method === 'GET' && matchRoute) {
      const record = matches.get(decodeURIComponent(matchRoute[1]));
      if (!record) return sendJson(response, 404, { error: 'MATCH_NOT_FOUND' }), true;
      sendJson(response, 200, publicSnapshot(record));
      return true;
    }

    const steeringRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/steering$/);
    if (request.method === 'POST' && steeringRoute) {
      const record = matches.get(decodeURIComponent(steeringRoute[1]));
      if (!record) return sendJson(response, 404, { error: 'MATCH_NOT_FOUND' }), true;
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
          const record = byToken.get(url.searchParams.get('token'));
          if (!record) return socket.destroy();
          agentWss.handleUpgrade(request, socket, head, (ws) => {
            agentWss.emit('connection', ws, request, record);
          });
          return;
        }
        if (url.pathname === '/events') {
          const record = matches.get(url.searchParams.get('matchId'));
          if (!record) return socket.destroy();
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
        record.agentSocket?.close();
        for (const observer of record.observers) observer.close();
        engines.add(record.engine);
      }
      for (const engine of engines) engine.close();
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
