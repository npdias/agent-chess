#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SERVER = 'http://127.0.0.1:3000';
const PREFERRED_MOVES = ['e2e4', 'd2d4', 'g1f3', 'c2c4'];

export function parseArgs(args) {
  const options = { server: DEFAULT_SERVER, color: 'white', turns: 3 };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--server', '--color', '--turns'].includes(flag) || value === undefined) {
      throw new Error(`INVALID_ARGUMENT: ${flag ?? ''}`);
    }
    if (flag === '--server') options.server = value.replace(/\/$/, '');
    if (flag === '--color') options.color = value;
    if (flag === '--turns') options.turns = Number(value);
  }
  if (!['white', 'black'].includes(options.color)) throw new Error('--color must be white or black');
  if (!Number.isInteger(options.turns) || options.turns < 1) throw new Error('--turns must be a positive integer');
  return options;
}

export function chooseHumanMove(snapshot) {
  const legalMoves = snapshot?.game?.legalMoves ?? [];
  const selected = PREFERRED_MOVES.find((uci) => legalMoves.some((move) => move.uci === uci))
    ?? legalMoves.map((move) => move.uci).sort()[0];
  if (!selected) throw new Error('NO_LEGAL_MOVE');
  return selected;
}

async function responseJson(response) {
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

async function waitForHumanTurn(fetchImpl, server, matchId, color, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await responseJson(await fetchImpl(`${server}/api/matches/${matchId}`));
    if (snapshot.status !== 'active' && snapshot.status !== 'waiting') return snapshot;
    if (snapshot.activeTurn?.seatKind === 'human' && snapshot.activeTurn.activeColor === color) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('HUMAN_TURN_TIMEOUT');
}

export async function runSmoke({ server, color, turns }, fetchImpl = fetch) {
  const created = await responseJson(await fetchImpl(`${server}/api/matches`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'exhibition', visibility: 'public', color,
      human: { name: 'Smoke Human' }, opponent: { kind: 'engine', name: 'Stockfish' },
      engine: { skillLevel: 0, movetimeMs: 25 },
    }),
  }));
  const capability = created.capabilities[color];
  let snapshot;
  for (let moveNumber = 0; moveNumber < turns; moveNumber += 1) {
    snapshot = await waitForHumanTurn(fetchImpl, server, created.matchId, color);
    if (!snapshot.activeTurn) break;
    await responseJson(await fetchImpl(`${server}/api/matches/${created.matchId}/human-moves`, {
      method: 'POST',
      headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json' },
      body: JSON.stringify({ turnId: snapshot.activeTurn.turnId, moveUci: chooseHumanMove(snapshot) }),
    }));
  }
  snapshot = await responseJson(await fetchImpl(`${server}/api/matches/${created.matchId}`));
  return {
    matchId: created.matchId,
    plies: snapshot.game.ply,
    result: snapshot.game.result,
    status: snapshot.status,
    exportUrl: `${server}/api/matches/${created.matchId}/export`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSmoke(parseArgs(process.argv.slice(2))).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; },
  );
}
