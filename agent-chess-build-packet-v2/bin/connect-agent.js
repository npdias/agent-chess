#!/usr/bin/env node
import WebSocket from 'ws';
import { cacheAllMoves, cacheProbe, chooseDemoAction, createAgentRequest, exchangeAgentSession, publicStatusTraceForAction, runCommandAction, validateLocalCandidate } from '../src/connector.js';

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'demo') args.demo = true;
    else args[key] = argv[++i];
  }
  if (args.seat && args.path) throw new Error('Use exactly one of --seat or --path');
  return args;
}

export function toWsUrl(server, wsPath) {
  const url = new URL(server);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const target = new URL(wsPath, server);
  url.pathname = target.pathname;
  url.search = target.search;
  return url.toString();
}

export async function run(args) {
  if (!args.server || (!args.seat && !args.path) || (!args.command && !args.demo)) {
    throw new Error('Usage: agent-chess-connect --server http://host:3000 (--seat TOKEN | --path /agent?ticket=TOKEN) (--command "./agent" | --demo)');
  }
  const wsPath = args.path ?? await exchangeAgentSession(fetch, args.server, args.seat);
  const socket = new WebSocket(toWsUrl(args.server, wsPath));
  let busy = false;
  let activeTurn = null;
  let commandRounds = 0;

  function publish(turnId, trace) {
    if (activeTurn?.mode !== 'private_eval') socket.send(JSON.stringify({ type: 'trace.publish', turnId, source: 'adapter_generated', ...trace }));
  }

  function fail(message) {
    if (activeTurn) publish(activeTurn.turnId, { kind: 'status', phase: 'failed', summary: 'Agent connector failed.' });
    console.error(`Agent failed: ${message}`);
    process.exitCode = 1;
    socket.close(1011, 'agent failure');
  }

  async function advanceAgent() {
    if (!activeTurn || busy) return;
    if (commandRounds >= 4) return fail('AGENT_COMMAND_ROUND_LIMIT');
    busy = true;
    try {
      if (commandRounds === 0) publish(activeTurn.turnId, { kind: 'status', phase: 'evaluate', summary: 'Evaluating local agent action.' });
      const action = args.command ? await runCommandAction(args.command, activeTurn) : chooseDemoAction(activeTurn);
      commandRounds += 1;
      const publicStatus = publicStatusTraceForAction(action);
      if (publicStatus) publish(activeTurn.turnId, publicStatus);
      if (action.probeSquare) {
        if (activeTurn.probeResults?.[action.probeSquare]) throw new Error('REPEATED_PROBE');
        socket.send(JSON.stringify(createAgentRequest(activeTurn, action)));
      } else if (action.requestAllMoves) {
        if (activeTurn.allMoves) throw new Error('REPEATED_FULL_MOVE_LIST');
        socket.send(JSON.stringify(createAgentRequest(activeTurn, action)));
      } else {
        const candidate = { ...validateLocalCandidate(activeTurn, action.moveUci), trace: action.trace };
        publish(activeTurn.turnId, { kind: 'status', phase: 'choose', summary: `Submitting ${candidate.moveUci}.` });
        socket.send(JSON.stringify(createAgentRequest(activeTurn, candidate)));
      }
    } finally {
      busy = false;
    }
  }

  socket.on('open', () => console.log('Connected to agent seat.'));
  socket.on('error', (error) => { console.error(`Connection failed: ${error.message}`); process.exitCode = 1; });
  socket.on('close', (code, reason) => console.log(`Seat closed (${code}${reason.length ? `: ${reason}` : ''}).`));
  socket.on('message', async (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'match.start') return console.log(`Match ${message.matchId} started. Agent plays ${message.agentColor}. Steering: ${message.steeringMode}.`);
    if (message.type === 'opponent.move') return console.log(`Stockfish: ${message.moveSan} (${message.moveUci})`);
    if (message.type === 'move.accepted') return console.log(`Accepted: ${message.moveSan} (${message.moveUci})`);
    if (message.type === 'move.rejected') return fail(`Move rejected: ${message.message}`);
    if (message.type === 'error') return fail(`Server error: ${message.message}`);
    if (message.type === 'moves.list.result' && activeTurn?.turnId === message.turnId) {
      activeTurn = cacheProbe(activeTurn, message);
      return advanceAgent().catch((error) => fail(error.message));
    }
    if (message.type === 'moves.list_all.result' && activeTurn?.turnId === message.turnId) {
      activeTurn = cacheAllMoves(activeTurn, message);
      return advanceAgent().catch((error) => fail(error.message));
    }
    if (message.type === 'game.end') {
      console.log(`Game over: ${message.result}`);
      console.log(message.pgn);
      if (message.status === 'failed') process.exitCode = 1;
      return socket.close(message.status === 'failed' ? 1011 : 1000, message.status === 'failed' ? 'match failed' : 'game complete');
    }
    if (message.type !== 'turn.start' || busy) return;
    activeTurn = { ...message, probeResults: {} };
    commandRounds = 0;
    advanceAgent().catch((error) => fail(error.message));
  });
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  run(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
