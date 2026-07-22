#!/usr/bin/env node
import WebSocket from 'ws';
import { chooseDemoMove, runCommandAgent } from '../src/connector.js';

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
  if (message.type === 'game.end') {
    console.log(`Game over: ${message.result}`);
    console.log(message.pgn);
    socket.close(1000, 'game complete');
    return;
  }
  if (message.type !== 'turn.start' || busy) return;

  busy = true;
  try {
    const result = args.command
      ? await runCommandAgent(args.command, message)
      : {
          moveUci: chooseDemoMove(message),
          trace: { phase: 'demo', summary: 'Demo connector selected a preferred legal move.' },
        };

    if (result.trace) {
      socket.send(JSON.stringify({
        type: 'trace.publish',
        phase: result.trace.phase,
        summary: result.trace.summary,
      }));
    }
    socket.send(JSON.stringify({
      type: 'move.submit',
      turnId: message.turnId,
      moveUci: result.moveUci,
    }));
  } catch (error) {
    console.error(`Agent failed: ${error.message}`);
  } finally {
    busy = false;
  }
});
