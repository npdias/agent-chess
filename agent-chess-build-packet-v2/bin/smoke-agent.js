#!/usr/bin/env node
import WebSocket from 'ws';
import { cacheProbe, chooseDemoAction, exchangeAgentSession, validateLocalCandidate } from '../src/connector.js';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const server = arg('server', 'http://127.0.0.1:3000');
const maxTurns = Number(arg('turns', '3'));
const created = await fetch(`${server}/api/matches`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    mode: 'exhibition', visibility: 'public', steeringMode: 'locked',
    seats: {
      white: { kind: 'agent', name: 'Smoke Agent' },
      black: { kind: 'engine', name: 'Stockfish' },
    },
    engine: { skillLevel: 0, movetimeMs: 50 },
  }),
}).then(async (response) => {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
});

const wsPath = await exchangeAgentSession(fetch, server, created.capabilities.white);
const ticketUrl = new URL(wsPath, server);
const wsUrl = new URL(server);
wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
wsUrl.pathname = ticketUrl.pathname;
wsUrl.search = ticketUrl.search;

const socket = new WebSocket(wsUrl);
let submitted = 0;
let settled = false;
let verifying = false;
let activeTurn = null;
const timeout = setTimeout(() => finish(new Error('Smoke test timed out')), 30_000);

function finish(error) {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  socket.close();
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

socket.on('error', finish);
socket.on('message', async (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === 'turn.start') {
    if (submitted >= maxTurns) return;
    activeTurn = { ...message, probeResults: {} };
    socket.send(JSON.stringify({ type: 'trace.publish', turnId: activeTurn.turnId, phase: 'evaluate', summary: 'Smoke agent evaluating.' }));
    const action = chooseDemoAction(activeTurn);
    socket.send(JSON.stringify({ type: 'moves.list', turnId: activeTurn.turnId, square: action.probeSquare }));
    return;
  }
  if (message.type === 'moves.list.result' && activeTurn?.turnId === message.turnId) {
    activeTurn = cacheProbe(activeTurn, message);
    const action = chooseDemoAction(activeTurn);
    const candidate = validateLocalCandidate(activeTurn, action.moveUci);
    socket.send(JSON.stringify({ type: 'trace.publish', turnId: activeTurn.turnId, phase: 'choose', summary: `Smoke agent selecting ${candidate.moveUci}.` }));
    socket.send(JSON.stringify({
      type: 'move.submit', turnId: activeTurn.turnId, moveUci: candidate.moveUci,
      publicTrace: { ...candidate.trace, selectedMove: candidate.moveUci },
    }));
    submitted += 1;
    return;
  }
  if (message.type === 'move.accepted' && submitted >= maxTurns && !verifying) {
    verifying = true;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const match = await fetch(`${server}/api/matches/${created.matchId}`).then((response) => response.json());
    if (match.game.movesUci.length < maxTurns * 2 - 1) {
      finish(new Error(`Expected at least ${maxTurns * 2 - 1} plies; received ${match.game.movesUci.length}`));
      return;
    }
    console.log(JSON.stringify({
      ok: true,
      matchId: created.matchId,
      plies: match.game.movesUci.length,
      fen: match.game.fen,
      ui: `${server}/?match=${created.matchId}`,
    }, null, 2));
    finish();
  }
  if (message.type === 'move.rejected' || message.type === 'error') {
    finish(new Error(JSON.stringify(message)));
  }
});
