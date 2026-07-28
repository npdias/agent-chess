#!/usr/bin/env node
import WebSocket from 'ws';
import { createInterface } from 'node:readline';
import { cacheAllMoves, cacheProbe, chooseDemoAction, createAgentRequest, exchangeAgentSession, parseAgentAction, publicStatusTraceForAction, resolveJoinTarget, runCommandAction, validateLocalCandidate } from '../src/connector.js';

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const rawKey = token.slice(2);
    const key = rawKey === 'join-url' ? 'joinUrl' : rawKey;
    if (key === 'demo') args.demo = true;
    else args[key] = argv[++i];
  }
  if (args.joinUrl && (args.server || args.seat || args.path)) {
    throw new Error('Use --join-url by itself instead of --server, --seat, or --path');
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
  const interactive = Boolean(args.joinUrl && !args.command && !args.demo) || args.interactive;
  if (!args.joinUrl && (!args.server || (!args.seat && !args.path) || (!args.command && !args.demo))) {
    throw new Error('Usage: agent-chess-connect --join-url URL [--command "./agent"] | --server http://host:3000 (--seat TOKEN | --path PATH) (--command "./agent" | --demo)');
  }
  const socketUrl = args.joinUrl
    ? await resolveJoinTarget(fetch, args.joinUrl)
    : toWsUrl(args.server, args.path ?? await exchangeAgentSession(fetch, args.server, args.seat));
  const socket = new WebSocket(socketUrl);
  let busy = false;
  let activeTurn = null;
  let commandRounds = 0;
  let terminal = false;
  const input = interactive ? createInterface({ input: process.stdin, crlfDelay: Infinity }) : null;
  const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

  function publish(turnId, trace) {
    if (activeTurn?.mode !== 'private_eval') socket.send(JSON.stringify({ type: 'trace.publish', turnId, source: 'adapter_generated', ...trace }));
  }

  function fail(message) {
    if (interactive) {
      emit({ type: 'connector.error', code: String(message).split(':')[0], recoverable: false, turnId: activeTurn?.turnId ?? null });
    }
    if (activeTurn) publish(activeTurn.turnId, { kind: 'status', phase: 'failed', summary: 'Agent connector failed.' });
    console.error(`Agent failed: ${interactive ? String(message).split(':')[0] : message}`);
    process.exitCode = 1;
    socket.close(1011, 'agent failure');
  }

  function retry(message) {
    emit({
      type: 'connector.error',
      code: String(message).split(':')[0],
      recoverable: true,
      turnId: activeTurn?.turnId ?? null,
    });
  }

  function submitAction(action) {
    const publicStatus = publicStatusTraceForAction(action);
    if (publicStatus) publish(activeTurn.turnId, publicStatus);
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
    const candidate = { ...validateLocalCandidate(activeTurn, action.moveUci), trace: action.trace };
    socket.send(JSON.stringify(createAgentRequest(activeTurn, candidate)));
  }

  async function advanceAgent() {
    if (!activeTurn || busy) return;
    if (commandRounds >= 4) return fail('AGENT_COMMAND_ROUND_LIMIT');
    busy = true;
    try {
      if (commandRounds === 0) publish(activeTurn.turnId, { kind: 'status', phase: 'evaluate', summary: 'Evaluating local agent action.' });
      const action = args.command ? await runCommandAction(args.command, activeTurn) : chooseDemoAction(activeTurn);
      commandRounds += 1;
      submitAction(action);
    } finally {
      busy = false;
    }
  }

  input?.on('line', (line) => {
    if (!activeTurn) return retry('NO_ACTIVE_TURN');
    try {
      submitAction(parseAgentAction(line));
    } catch (error) {
      retry(error.message);
    }
  });

  socket.on('open', () => {
    if (interactive) emit({ type: 'connector.status', state: 'online' });
    else console.log('Connected to agent seat.');
  });
  socket.on('error', () => {
    if (interactive) emit({ type: 'connector.error', code: 'CONNECT_FAILED', recoverable: false, turnId: activeTurn?.turnId ?? null });
    console.error('Connection failed: CONNECT_FAILED');
    process.exitCode = 1;
  });
  socket.on('close', (code, reason) => {
    input?.close();
    if (interactive) emit({ type: 'connector.status', state: terminal ? 'complete' : 'offline', code });
    else console.log(`Seat closed (${code}${reason.length ? `: ${reason}` : ''}).`);
    if (!terminal && code !== 1000) process.exitCode = 1;
  });
  socket.on('message', async (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'match.start') {
      if (interactive) emit(message);
      else console.log(`Match ${message.matchId} started. Agent plays ${message.agentColor}. Steering: ${message.steeringMode}.`);
      return;
    }
    if (message.type === 'opponent.move') {
      if (interactive) emit(message);
      else console.log(`Stockfish: ${message.moveSan} (${message.moveUci})`);
      return;
    }
    if (message.type === 'move.accepted') {
      activeTurn = null;
      if (interactive) emit(message);
      else console.log(`Accepted: ${message.moveSan} (${message.moveUci})`);
      return;
    }
    if (message.type === 'move.rejected') {
      if (interactive) emit({ ...message, recoverable: true });
      else fail(`Move rejected: ${message.message}`);
      return;
    }
    if (message.type === 'error') {
      if (interactive && message.recoverable !== false) emit(message);
      else fail(`Server error: ${message.message}`);
      return;
    }
    if (message.type === 'moves.list.result' && activeTurn?.turnId === message.turnId) {
      activeTurn = cacheProbe(activeTurn, message);
      if (interactive) return emit(message);
      return advanceAgent().catch((error) => fail(error.message));
    }
    if (message.type === 'moves.list_all.result' && activeTurn?.turnId === message.turnId) {
      activeTurn = cacheAllMoves(activeTurn, message);
      if (interactive) return emit(message);
      return advanceAgent().catch((error) => fail(error.message));
    }
    if (message.type === 'game.end') {
      terminal = true;
      if (interactive) emit(message);
      else {
        console.log(`Game over: ${message.result}`);
        console.log(message.pgn);
      }
      if (message.status === 'failed') process.exitCode = 1;
      return socket.close(message.status === 'failed' ? 1011 : 1000, message.status === 'failed' ? 'match failed' : 'game complete');
    }
    if (message.type !== 'turn.start' || busy) return;
    activeTurn = { ...message, probeResults: {} };
    commandRounds = 0;
    if (interactive) return emit(message);
    advanceAgent().catch((error) => fail(error.message));
  });
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  run(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
