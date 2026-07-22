#!/usr/bin/env node
import WebSocket from 'ws';
import { cacheAllMoves, cacheProbe, chooseDemoAction, createAgentRequest, runCommandAction, validateLocalCandidate } from '../src/connector.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'demo') {
      args.demo = true;
    } else {
      args[key] = argv[++i];
    }
  }
  return args;
}

function toWsUrl(server, seat) {
  const url = new URL(server);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/agent';
  url.search = new URLSearchParams({ token: seat }).toString();
  return url.toString();
}

const args = parseArgs(process.argv.slice(2));
if (!args.server || !args.seat || (!args.command && !args.demo)) {
  console.error('Usage: agent-chess-connect --server http://host:3000 --seat TOKEN (--command "./agent" | --demo)');
  process.exit(2);
}

const socket = new WebSocket(toWsUrl(args.server, args.seat));
let busy = false;
let activeTurn = null;
let commandRounds = 0;

function publish(turnId, phase, summary) {
  socket.send(JSON.stringify({ type: 'trace.publish', turnId, phase, summary }));
}

async function advanceAgent() {
  if (!activeTurn || busy) return;
  if (commandRounds >= 4) throw new Error('AGENT_COMMAND_ROUND_LIMIT');
  busy = true;
  try {
    publish(activeTurn.turnId, 'evaluate', 'Evaluating local agent action.');
    const action = args.command
      ? await runCommandAction(args.command, activeTurn)
      : chooseDemoAction(activeTurn);
    commandRounds += 1;
    if (action.trace) publish(activeTurn.turnId, action.trace.phase, action.trace.summary);
    if (action.probeSquare) {
      if (activeTurn.probeResults?.[action.probeSquare]) throw new Error('REPEATED_PROBE');
      socket.send(JSON.stringify(createAgentRequest(activeTurn, action)));
      return;
    }
    if (action.requestAllMoves) {
      if (activeTurn.allMoves) throw new Error('REPEATED_FULL_MOVE_LIST');
      socket.send(JSON.stringify(createAgentRequest(activeTurn, action)));
      return;
    }
    const candidate = validateLocalCandidate(activeTurn, action.moveUci);
    publish(activeTurn.turnId, 'choose', `Submitting ${candidate.moveUci}.`);
    socket.send(JSON.stringify(createAgentRequest(activeTurn, candidate)));
  } finally {
    busy = false;
  }
}

socket.on('open', () => console.log('Connected to agent seat.'));
socket.on('error', (error) => {
  console.error(`Connection failed: ${error.message}`);
  process.exitCode = 1;
});
socket.on('close', (code, reason) => {
  console.log(`Seat closed (${code}${reason.length ? `: ${reason}` : ''}).`);
});

socket.on('message', async (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === 'match.start') {
    console.log(`Match ${message.matchId} started. Agent plays ${message.agentColor}. Steering: ${message.steeringMode}.`);
    return;
  }
  if (message.type === 'opponent.move') {
    console.log(`Stockfish: ${message.moveSan} (${message.moveUci})`);
    return;
  }
  if (message.type === 'move.accepted') {
    console.log(`Accepted: ${message.moveSan} (${message.moveUci})`);
    return;
  }
  if (message.type === 'move.rejected') {
    console.error(`Move rejected: ${message.message}`);
    busy = false;
    return;
  }
  if (message.type === 'moves.list.result' && activeTurn?.turnId === message.turnId) {
    activeTurn = cacheProbe(activeTurn, message);
    advanceAgent().catch((error) => console.error(`Agent failed: ${error.message}`));
    return;
  }
  if (message.type === 'moves.list_all.result' && activeTurn?.turnId === message.turnId) {
    activeTurn = cacheAllMoves(activeTurn, message);
    advanceAgent().catch((error) => console.error(`Agent failed: ${error.message}`));
    return;
  }
  if (message.type === 'game.end') {
    console.log(`Game over: ${message.result}`);
    console.log(message.pgn);
    socket.close(1000, 'game complete');
    return;
  }
  if (message.type !== 'turn.start' || busy) return;
  activeTurn = { ...message, probeResults: {} };
  commandRounds = 0;
  advanceAgent().catch((error) => console.error(`Agent failed: ${error.message}`));
});
