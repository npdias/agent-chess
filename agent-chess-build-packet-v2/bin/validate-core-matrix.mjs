#!/usr/bin/env node
import WebSocket from 'ws';

const server = process.argv[2] ?? 'http://127.0.0.1:3000';
const json = async (response) => {
  response = await response;
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return body;
};
const create = (body) => json(fetch(`${server}/api/matches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const match = (id) => json(fetch(`${server}/api/matches/${id}`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(id, predicate) {
  for (let until = Date.now() + 30_000; Date.now() < until; await sleep(25)) {
    const state = await match(id);
    if (predicate(state)) return state;
  }
  throw new Error('TIMEOUT');
}

async function agentMatrix() {
  const created = await create({ mode: 'exhibition', visibility: 'public', seats: { white: { kind: 'human', name: 'Matrix Human' }, black: { kind: 'agent', name: 'Matrix Agent' } } });
  const observer = new WebSocket(new URL(`/events?matchId=${created.matchId}`, server).toString().replace('http', 'ws'));
  let observerStates = 0;
  observer.on('message', (raw) => { if (JSON.parse(raw).type === 'match.state') observerStates += 1; });
  await new Promise((resolve, reject) => { observer.once('open', resolve); observer.once('error', reject); });
  const ticket = await json(fetch(`${server}/api/agent-sessions`, { method: 'POST', headers: { authorization: `Bearer ${created.capabilities.black}` } }));
  const agent = new WebSocket(new URL(ticket.wsPath, server).toString().replace('http', 'ws'));
  let active; let agentMoves = 0;
  agent.on('message', (raw) => {
    const message = JSON.parse(raw);
    if (message.type === 'turn.start') {
      active = message;
      agent.send(JSON.stringify({ type: 'moves.list', turnId: message.turnId, square: message.positionStatus.movablePieces[0].square }));
    } else if (message.type === 'moves.list.result' && active?.turnId === message.turnId) {
      const moveUci = message.moves[0].uci;
      agent.send(JSON.stringify({ type: 'move.submit', turnId: active.turnId, moveUci, publicTrace: { source: 'matrix-agent', phase: 'choose', summary: `Matrix agent selected ${moveUci} after legal probe.`, candidates: [{ uci: moveUci, note: 'First authoritative legal candidate.' }], selectedMove: moveUci } }));
      agentMoves += 1; active = null;
    }
  });
  await new Promise((resolve, reject) => { agent.once('open', resolve); agent.once('error', reject); });
  let humanMoves = 0;
  while ((await match(created.matchId)).game.ply < 10) {
    const state = await waitFor(created.matchId, (item) => item.activeTurn?.seatKind === 'human');
    await json(fetch(`${server}/api/matches/${created.matchId}/human-moves`, { method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}`, 'content-type': 'application/json' }, body: JSON.stringify({ turnId: state.activeTurn.turnId, moveUci: state.game.legalMoves[0].uci }) }));
    humanMoves += 1;
  }
  const final = await match(created.matchId); const exported = await json(fetch(`${server}/api/matches/${created.matchId}/export`));
  const spectator = await fetch(`${server}/api/matches/${created.matchId}/human-moves`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnId: final.activeTurn?.turnId ?? 'none', moveUci: 'a1a2' }) });
  const publicData = JSON.stringify({ final, exported }); agent.close(); observer.close();
  return { matchId: created.matchId, plies: final.game.ply, humanMoves, agentMoves, observerStates, acceptedDecision: final.activity.some((item) => item.type === 'agent.decision' && item.candidates?.length && item.summary), spectatorSubmitStatus: spectator.status, capabilityValueLeak: [created.capabilities.white, created.capabilities.black].some((value) => publicData.includes(value)), capabilityNameLeak: /capabilities|seatToken|ticket|authorization|capability/.test(publicData), pgnPresent: Boolean(exported.pgn) };
}

async function lifecycle() {
  const config = { mode: 'exhibition', visibility: 'public', color: 'white', human: { name: 'Matrix Human' }, opponent: { kind: 'engine', name: 'Stockfish' }, engine: { skillLevel: 0, movetimeMs: 25 } };
  const aborted = await create(config);
  const abortStatus = (await fetch(`${server}/api/matches/${aborted.matchId}/abort`, { method: 'POST', headers: { authorization: `Bearer ${aborted.capabilities.white}` } })).status;
  const resigned = await create(config); const before = await match(resigned.matchId);
  await json(fetch(`${server}/api/matches/${resigned.matchId}/human-moves`, { method: 'POST', headers: { authorization: `Bearer ${resigned.capabilities.white}`, 'content-type': 'application/json' }, body: JSON.stringify({ turnId: before.activeTurn.turnId, moveUci: before.game.legalMoves[0].uci }) }));
  const resignStatus = (await fetch(`${server}/api/matches/${resigned.matchId}/resign`, { method: 'POST', headers: { authorization: `Bearer ${resigned.capabilities.white}` } })).status;
  const exportStatus = (await fetch(`${server}/api/matches/${resigned.matchId}/export`)).status;
  return { abortStatus, resignStatus, exportStatus };
}

console.log(JSON.stringify({ agent: await agentMatrix(), lifecycle: await lifecycle() }, null, 2));
