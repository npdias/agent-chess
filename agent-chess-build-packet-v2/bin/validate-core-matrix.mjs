#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';

const server = process.argv[2] ?? 'http://127.0.0.1:3000';
const json = async (response) => {
  response = await response;
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return body;
};
const create = (body) => json(fetch(`${server}/api/matches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const bearer = (token) => token ? { authorization: `Bearer ${token}` } : {};
const match = (id, token) => json(fetch(`${server}/api/matches/${id}`, { headers: bearer(token) }));
const exportMatch = (id, token) => json(fetch(`${server}/api/matches/${id}/export`, { headers: bearer(token) }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
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
      agent.send(JSON.stringify({ type: 'move.submit', turnId: active.turnId, moveUci, publicTrace: { source: 'agent_reported', phase: 'choose', summary: `Matrix agent selected ${moveUci} after legal probe.`, candidates: [{ uci: moveUci, note: 'First authoritative legal candidate.' }], selectedMove: moveUci } }));
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
  const final = await match(created.matchId); const exported = await exportMatch(created.matchId);
  const spectator = await fetch(`${server}/api/matches/${created.matchId}/human-moves`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnId: final.activeTurn?.turnId ?? 'none', moveUci: 'a1a2' }) });
  const publicData = JSON.stringify({ final, exported }); agent.close(); observer.close();
  return { matchId: created.matchId, plies: final.game.ply, humanMoves, agentMoves, observerStates, acceptedDecision: final.activity.some((item) => item.type === 'agent.decision' && item.source === 'agent_reported' && item.candidates?.length && item.summary), spectatorSubmitStatus: spectator.status, capabilityValueLeak: [created.capabilities.white, created.capabilities.black].some((value) => publicData.includes(value)), capabilityNameLeak: /capabilities|seatToken|ticket|authorization|capability/.test(publicData), pgnPresent: Boolean(exported.pgn), engineMetadataPresent: 'engine' in exported };
}

async function privacyMatrix() {
  const created = await create({ mode: 'private_eval', visibility: 'private', seats: { white: { kind: 'human', name: 'Private Human' }, black: { kind: 'agent', name: 'Private Agent' } } });
  const path = `${server}/api/matches/${created.matchId}`;
  const unauthorizedGetStatus = (await fetch(path)).status;
  const boundGetStatus = (await fetch(path, { headers: bearer(created.capabilities.white) })).status;
  const unauthorizedExportStatus = (await fetch(`${path}/export`)).status;
  const privateEventsRejected = await new Promise((resolve) => {
    const socket = new WebSocket(new URL(`/events?matchId=${created.matchId}`, server).toString().replace('http', 'ws'));
    let opened = false;
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { socket.close(); finish(false); }, 1000);
    socket.once('open', () => { opened = true; });
    socket.once('error', () => finish(!opened));
    socket.once('close', () => finish(!opened));
  });
  return { unauthorizedGetStatus, boundGetStatus, unauthorizedExportStatus, privateEventsRejected };
}

async function guidanceMatrix() {
  const created = await create({ mode: 'exhibition', visibility: 'public', steeringMode: 'trainer', seats: { white: { kind: 'human', name: 'Guidance Human' }, black: { kind: 'agent', name: 'Guidance Agent' } } });
  const sentinel = 'PRIVATE_SENTINEL_guidance_prompt_memory';
  const steeringStatus = (await fetch(`${server}/api/matches/${created.matchId}/steering`, {
    method: 'POST', headers: { ...bearer(created.capabilities.white), 'content-type': 'application/json' }, body: JSON.stringify({ guidance: sentinel }),
  })).status;
  const observer = new WebSocket(new URL(`/events?matchId=${created.matchId}`, server).toString().replace('http', 'ws'));
  const state = await new Promise((resolve, reject) => {
    observer.once('error', reject);
    observer.on('message', (raw) => { const message = JSON.parse(raw); if (message.type === 'match.state') resolve(message); });
  });
  const snapshot = await match(created.matchId);
  const exported = await exportMatch(created.matchId);
  observer.close();
  const publicData = JSON.stringify({ snapshot, state, exported });
  return { steeringStatus, snapshotLeak: JSON.stringify(snapshot).includes(sentinel), eventsLeak: JSON.stringify(state).includes(sentinel), exportLeak: JSON.stringify(exported).includes(sentinel), activeTurnSteeringPresent: 'steering' in (snapshot.activeTurn ?? {}), capabilityValueLeak: Object.values(created.capabilities).some((value) => publicData.includes(value)) };
}

async function connectorMatrix() {
  const created = await create({ mode: 'exhibition', visibility: 'public', seats: { white: { kind: 'agent', name: 'Quoted Agent' }, black: { kind: 'human', name: 'Quoted Human' } } });
  const ticket = await json(fetch(`${server}/api/agent-sessions`, { method: 'POST', headers: bearer(created.capabilities.white) }));
  const command = `npm run --silent connect -- --server ${shellQuote(server)} --path ${shellQuote(ticket.wsPath)} --demo`;
  const child = spawn('/bin/zsh', ['-f', '-c', command], { cwd: new URL('..', import.meta.url) });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CONNECT_TIMEOUT')), 5000);
    const poll = () => {
      if (stdout.includes('Accepted:')) { clearTimeout(timer); resolve(); }
      else if (child.exitCode !== null) { clearTimeout(timer); reject(new Error('CONNECT_EARLY_EXIT')); }
      else setTimeout(poll, 10);
    };
    poll();
  });
  const resignStatus = (await fetch(`${server}/api/matches/${created.matchId}/resign`, { method: 'POST', headers: bearer(created.capabilities.black) })).status;
  const [exitCode] = await once(child, 'close');
  const output = `${stdout}\n${stderr}`;
  return { commandShape: "npm run --silent connect -- --server '<server>' --path '<one-use-path>' --demo", connected: stdout.includes('Connected to agent seat.'), resignStatus, terminalOutput: stdout.includes('Game over:'), exitCode, zshNoGlobFailure: !output.includes('no matches found'), capabilityValueLeak: Object.values(created.capabilities).some((value) => output.includes(value)), ticketValueLeak: output.includes(ticket.ticket) || output.includes(ticket.wsPath), stderrEmpty: !stderr.trim() };
}

async function lifecycle() {
  const config = { mode: 'exhibition', visibility: 'public', color: 'white', human: { name: 'Matrix Human' }, opponent: { kind: 'engine', name: 'Stockfish' }, engine: { skillLevel: 0, movetimeMs: 25 } };
  const aborted = await create(config);
  const abortStatus = (await fetch(`${server}/api/matches/${aborted.matchId}/abort`, { method: 'POST', headers: { authorization: `Bearer ${aborted.capabilities.white}` } })).status;
  const abortedExport = await exportMatch(aborted.matchId);
  const resigned = await create(config); const before = await match(resigned.matchId);
  await json(fetch(`${server}/api/matches/${resigned.matchId}/human-moves`, { method: 'POST', headers: { authorization: `Bearer ${resigned.capabilities.white}`, 'content-type': 'application/json' }, body: JSON.stringify({ turnId: before.activeTurn.turnId, moveUci: before.game.legalMoves[0].uci }) }));
  const resignStatus = (await fetch(`${server}/api/matches/${resigned.matchId}/resign`, { method: 'POST', headers: { authorization: `Bearer ${resigned.capabilities.white}` } })).status;
  const exportResponse = await fetch(`${server}/api/matches/${resigned.matchId}/export`);
  const exportStatus = exportResponse.status;
  const resignedExport = await exportResponse.json();
  return { abortStatus, abortedPgnResult: /\[Result "\*"\]/.test(abortedExport.pgn), abortedPgnTermination: /\[Termination "aborted"\]/.test(abortedExport.pgn), resignStatus, exportStatus, resignedPgnResult: /\[Result "0-1"\]/.test(resignedExport.pgn), resignedPgnTermination: /\[Termination "resignation"\]/.test(resignedExport.pgn), engineMetadataPresent: 'engine' in resignedExport };
}

console.log(JSON.stringify({ agent: await agentMatrix(), privacy: await privacyMatrix(), guidance: await guidanceMatrix(), connector: await connectorMatrix(), lifecycle: await lifecycle() }, null, 2));
