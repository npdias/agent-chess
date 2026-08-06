import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Chess } from 'chess.js';
import WebSocket from 'ws';
import { createAgentChessServer, normalizeTurnPaceMs } from '../src/server.js';
import { runSmoke } from '../bin/smoke-human.js';
import { formatActivity, shellQuote } from '../public/app.js';

class FakeStockfish {
  async evaluate() {
    return { type: 'cp', value: 42, perspective: 'white' };
  }
  async bestMove(fen) {
    const chess = new Chess(fen);
    return chess.moves({ verbose: true })[0].lan;
  }
  close() {}
}

function collectMessages(socket) {
  const queue = [];
  const waiters = [];
  const seen = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    seen.push(message);
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      queue.push(message);
    }
  });

  return {
    count(predicate) { return seen.filter(predicate).length; },
    ordered() { return [...seen]; },
    next(predicate = () => true, timeoutMs = 3000) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const current = waiters.indexOf(waiter);
          if (current >= 0) waiters.splice(current, 1);
          reject(new Error('message timeout'));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

async function createMatch(address, body) {
  const response = await fetch(`${address.httpUrl}/api/matches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function getMatch(address, matchId, capability = null) {
  const response = await fetch(`${address.httpUrl}/api/matches/${matchId}`, {
    headers: capability ? { authorization: `Bearer ${capability}` } : {},
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForPly(address, matchId, ply, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const state = await getMatch(address, matchId);
    if (state.game.ply >= ply) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`ply ${ply} timeout`);
}

async function waitForEvaluation(address, matchId, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const state = await getMatch(address, matchId);
    if (state.evaluation) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('evaluation timeout');
}

test('serves machine discovery map from /llms.txt', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const response = await fetch(`${address.httpUrl}/llms.txt`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/plain/);
    const discovery = await response.text();
    assert.match(discovery, /docs\/reference\/AGENT_API\.md/);
    assert.match(discovery, /Agent Procedure/);
    assert.match(discovery, /agent-play\.js/);
    assert.match(discovery, /Use loopback/i);
    const api = await fetch(`${address.httpUrl}/docs/reference/AGENT_API.md`);
    assert.equal(api.status, 200);
    assert.match(api.headers.get('content-type') ?? '', /^text\/markdown/);
    assert.match(await api.text(), /# Agent API/);
    const connector = await fetch(`${address.httpUrl}/agent-play.js`);
    assert.equal(connector.status, 200);
    assert.match(connector.headers.get('content-type') ?? '', /^text\/javascript/);
    assert.equal(connector.headers.get('cache-control'), 'no-store');
    assert.match(await connector.text(), /new WebSocket/);
  } finally {
    await server.stop();
  }
});

test('rejects a public bind unless the operator opts in', async () => {
  const server = createAgentChessServer();
  try {
    await assert.rejects(
      server.start(0, '0.0.0.0'),
      /REMOTE_BIND_DISABLED/,
    );
  } finally {
    await server.stop();
  }
});

test('retries a transient public asset read before responding', async () => {
  let boardReads = 0;
  const server = createAgentChessServer({
    stockfishFactory: async () => new FakeStockfish(),
    onStaticReadFailure: () => {},
    readStaticFile: async (path) => {
      if (path.endsWith('board-interaction.js')) {
        boardReads += 1;
        if (boardReads === 1) {
          const error = new Error('temporary read failure');
          error.code = 'EAGAIN';
          throw error;
        }
      }
      return readFile(path);
    },
  });
  const address = await server.start(0);
  try {
    const response = await fetch(`${address.httpUrl}/board-interaction.js`);
    assert.equal(response.status, 200);
    assert.equal(boardReads, 2);
    assert.match(await response.text(), /function positionKey/);
  } finally {
    await server.stop();
  }
});

test('propagates authoritative material through public state, export, and agent turn', async () => {
  const server = createAgentChessServer();
  const address = await server.start(0);
  let socket;
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const connection = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    socket = new WebSocket(`${address.wsUrl}${connection.wsPath}`);
    const messages = collectMessages(socket);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const turn = await messages.next((message) => message.type === 'turn.start');
    const state = await getMatch(address, created.matchId);
    const exported = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/export`).then((response) => response.json());

    assert.deepEqual(turn.material, state.activeTurn.material);
    assert.equal(turn.balanceForAgent, 0);
    assert.deepEqual(state.game.material, turn.material);
    assert.deepEqual(exported.material, turn.material);
    assert.equal('balanceForAgent' in exported.material, false);
  } finally {
    socket?.close();
    await server.stop();
  }
});

test('publishes Stockfish evaluation without exposing engine internals', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'agent', name: 'Luna' }, black: { kind: 'engine', name: 'Computer' } },
    });
    const state = await waitForEvaluation(address, created.matchId);
    assert.deepEqual(state.evaluation, { type: 'cp', value: 42, perspective: 'white' });
    const exported = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/export`).then((response) => response.json());
    assert.deepEqual(exported.evaluation, state.evaluation);
  } finally {
    await server.stop();
  }
});

test('paces only public exhibitions and caps untrusted delay input', () => {
  assert.equal(normalizeTurnPaceMs({ mode: 'exhibition', visibility: 'public' }, 800), 800);
  assert.equal(normalizeTurnPaceMs({ mode: 'private_eval', visibility: 'private' }, 800), 0);
  assert.equal(normalizeTurnPaceMs({ mode: 'exhibition', visibility: 'public' }, 50_000), 5_000);
  assert.equal(normalizeTurnPaceMs({ mode: 'exhibition', visibility: 'public' }, -1), 0);
});

test('sends observer heartbeats without fabricating game activity', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish(), observerHeartbeatMs: 20 });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'engine', name: 'Engine' } },
    });
    const observer = new WebSocket(`${address.wsUrl}/events?matchId=${created.matchId}`);
    const messages = collectMessages(observer);
    await new Promise((resolve, reject) => { observer.once('open', resolve); observer.once('error', reject); });
    const heartbeat = await messages.next((message) => message.type === 'match.heartbeat');
    assert.match(heartbeat.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(heartbeat.matchId, created.matchId);
    assert.equal((await getMatch(address, created.matchId)).activity.length, 1);
    observer.close();
  } finally {
    await server.stop();
  }
});

async function runReferenceConnectorFailure(address, created, command) {
  const observer = new WebSocket(`${address.wsUrl}/events?matchId=${created.matchId}`);
  const messages = collectMessages(observer);
  await new Promise((resolve, reject) => { observer.once('open', resolve); observer.once('error', reject); });
  const child = spawn(process.execPath, [
    'bin/connect-agent.js', '--server', address.httpUrl, '--seat', created.capabilities.white, '--command', command,
  ], { cwd: new URL('..', import.meta.url) });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  const failedTrace = await messages.next((message) => message.type === 'trace.publish' && message.entry?.phase === 'failed');
  const snapshot = await getMatch(address, created.matchId);
  const exported = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/export`).then((response) => response.json());
  observer.close();
  return { code, stdout, stderr, failedTrace, snapshot, exported, events: messages.ordered() };
}

test('human White move is authenticated and followed by engine move', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'engine', name: 'Engine' } },
    });
    assert.ok(created.capabilities.white);
    const state = await getMatch(address, created.matchId);
    const response = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/human-moves`, {
      method: 'POST', headers: {
        authorization: `Bearer ${created.capabilities.white}`,
        'content-type': 'application/json',
      }, body: JSON.stringify({ turnId: state.activeTurn.turnId, moveUci: 'e2e4' }),
    });
    assert.equal(response.status, 202);
    await waitForPly(address, created.matchId, 2);
  } finally {
    await server.stop();
  }
});

test('creates public agent-engine exhibition from generic controller payload without leaking capability', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      controller: { kind: 'agent', name: 'My agent' },
      opponent: { kind: 'engine', name: 'Computer' }, color: 'black',
      skillLevel: 7, movetimeMs: 150,
    });
    assert.match(created.capabilities.black, /.+/);
    const snapshot = await getMatch(address, created.matchId);
    assert.equal(snapshot.seats.black.kind, 'agent');
    assert.equal(snapshot.seats.black.traceRequirement, 'structured_required');
    assert.equal(snapshot.seats.white.kind, 'engine');
    assert.equal(JSON.stringify(snapshot).includes(created.capabilities.black), false);
    const afterEngineWhite = await waitForPly(address, created.matchId, 1);
    assert.equal(afterEngineWhite.game.movesUci.length, 1);
    assert.equal(afterEngineWhite.activeTurn.seatKind, 'agent');
    assert.equal(afterEngineWhite.activeTurn.activeColor, 'black');
  } finally {
    await server.stop();
  }
});

test('human smoke completes exact requested turns as White and Black', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    for (const color of ['white', 'black']) {
      const result = await runSmoke({ server: address.httpUrl, color, turns: 2 });
      assert.equal(result.humanTurns, 2);
      assert.equal(result.status, 'active');
      assert.equal(result.exportUrl, `${address.httpUrl}/api/matches/${result.matchId}/export`);
    }
  } finally {
    await server.stop();
  }
});

test('generic agent smoke submits a structured trace accepted by the server', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const child = spawn(process.execPath, ['bin/smoke-agent.js', '--server', address.httpUrl, '--turns', '1'], {
      cwd: new URL('..', import.meta.url),
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 0, stderr);
    assert.match(stdout, /"matchId"/);
    const matchId = stdout.match(/"matchId":\s*"([^"]+)"/)?.[1];
    const snapshot = await getMatch(address, matchId);
    assert.ok(snapshot.activity.some((entry) => entry.type === 'agent.decision' && entry.summary));
  } finally {
    await server.stop();
  }
});

test('generic creation keeps capabilities out of public snapshots and export', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const snapshot = await getMatch(address, created.matchId, created.capabilities.white);
    const exported = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/export`).then((response) => response.json());
    const publicData = JSON.stringify({ snapshot, exported });
    assert.equal(publicData.includes(created.capabilities.white), false);
    assert.equal(publicData.includes(created.capabilities.black), false);
    assert.equal(publicData.includes('seatToken'), false);
  } finally {
    await server.stop();
  }
});

test('exports reproducibility metadata only for engine seats', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const engineMatch = await createMatch(address, {
      mode: 'exhibition', visibility: 'public', engine: { skillLevel: 7, movetimeMs: 90 },
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'engine', name: 'Engine' } },
    });
    const engineExport = await fetch(`${address.httpUrl}/api/matches/${engineMatch.matchId}/export`).then((response) => response.json());
    assert.deepEqual(engineExport.engine, {
      name: 'Stockfish 18 Lite', package: 'stockfish@18.0.8', profileId: 'stockfish-skill-7-movetime-90',
      skillLevel: 7, movetimeMs: 90, hostBuild: 'agent-chess@0.1.0-alpha',
    });

    const practiceMatch = await createMatch(address, {
      mode: 'exhibition', visibility: 'public', targetElo: 500, movetimeMs: 90,
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'engine', name: 'Engine' } },
    });
    const practiceExport = await fetch(`${address.httpUrl}/api/matches/${practiceMatch.matchId}/export`).then((response) => response.json());
    assert.deepEqual(practiceExport.engine, {
      name: 'Agent Chess Practice Bot', package: 'agent-chess@0.1.0-alpha',
      profileId: 'practice-estimated-500', targetElo: 500, strengthMode: 'practice',
      movetimeMs: 90, hostBuild: 'agent-chess@0.1.0-alpha',
    });

    const agentMatch = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const agentSnapshot = await getMatch(address, agentMatch.matchId);
    const agentExport = await fetch(`${address.httpUrl}/api/matches/${agentMatch.matchId}/export`).then((response) => response.json());
    assert.equal('engine' in agentSnapshot, false);
    assert.equal('engine' in agentExport, false);
  } finally {
    await server.stop();
  }
});

test('private snapshots require a bound seat capability and private event observers are denied', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'private_eval', visibility: 'private',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const path = `${address.httpUrl}/api/matches/${created.matchId}`;
    assert.equal((await fetch(path)).status, 401);
    assert.equal((await fetch(path, { headers: { authorization: `Bearer ${created.capabilities.white}` } })).status, 200);
    const observer = new WebSocket(`${address.wsUrl}/events?matchId=${created.matchId}`);
    await new Promise((resolve) => { observer.once('close', resolve); observer.once('error', resolve); });
  } finally {
    await server.stop();
  }
});

test('public snapshot, events, and export exclude steering guidance sentinels', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public', steeringMode: 'trainer',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const secret = 'PRIVATE_SENTINEL_guidance_prompt_memory';
    assert.equal((await fetch(`${address.httpUrl}/api/matches/${created.matchId}/steering`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}`, 'content-type': 'application/json' },
      body: JSON.stringify({ guidance: secret }),
    })).status, 202);
    const observer = new WebSocket(`${address.wsUrl}/events?matchId=${created.matchId}`);
    const events = collectMessages(observer);
    await new Promise((resolve, reject) => { observer.once('open', resolve); observer.once('error', reject); });
    const state = await events.next((message) => message.type === 'match.state');
    const snapshot = await getMatch(address, created.matchId, created.capabilities.white);
    const exported = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/export`).then((response) => response.json());
    for (const value of [snapshot, state, exported]) assert.equal(JSON.stringify(value).includes(secret), false);
    assert.equal(snapshot.activeTurn.steering, undefined);
    observer.close();
  } finally {
    await server.stop();
  }
});

test('agent capability exchanges once for a 180-second ticket', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const exchange = async () => fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    });
    const ticketResponse = await exchange();
    assert.equal(ticketResponse.status, 201);
    const ticket = await ticketResponse.json();
    assert.match(ticket.ticket, /.+/);
    assert.match(ticket.wsPath, /^\/agent\?ticket=/);
    assert.ok(Date.parse(ticket.expiresAt) - Date.now() <= 180_000);
    const first = new WebSocket(`${address.wsUrl}${ticket.wsPath}`);
    await new Promise((resolve, reject) => { first.once('open', resolve); first.once('error', reject); });
    const reused = new WebSocket(`${address.wsUrl}${ticket.wsPath}`);
    await new Promise((resolve) => {
      reused.once('close', resolve);
      reused.once('error', resolve);
    });
    first.close();
  } finally {
    await server.stop();
  }
});

test('durable REST agent session claims an invitation then submits an idempotent decision', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const connection = await fetch(`${address.httpUrl}/api/agent-connections`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    });
    assert.equal(connection.status, 201);
    const invite = await connection.json();
    assert.match(invite.connection.rest.claimUrl, /\/api\/agent\/claim\?ticket=/);
    assert.equal(JSON.stringify(await getMatch(address, created.matchId)).includes(invite.ticket), false);

    const claim = await fetch(invite.connection.rest.claimUrl, { method: 'POST' });
    assert.equal(claim.status, 201);
    const { sessionToken } = await claim.json();
    const claimedSnapshot = await getMatch(address, created.matchId);
    assert.equal(claimedSnapshot.connected, false);
    assert.equal(claimedSnapshot.agentSessionActive, true);
    assert.equal(claimedSnapshot.activity.some((entry) => entry.type === 'agent.turn.ready'), false);
    const auth = { authorization: `Bearer ${sessionToken}` };
    const joined = await fetch(`${address.httpUrl}/api/agent/match`, { headers: auth });
    assert.equal(joined.status, 200);
    const { turn } = await joined.json();
    const deliveredSnapshot = await getMatch(address, created.matchId);
    assert.deepEqual(
      deliveredSnapshot.activity.find((entry) => entry.type === 'agent.turn.ready')?.turnId,
      turn.turnId,
    );
    const legal = await fetch(`${address.httpUrl}/api/agent/legal-moves?turnId=${turn.turnId}`, { headers: auth });
    assert.equal(legal.status, 200);
    assert.ok((await legal.json()).moves.some((move) => move.uci === 'e2e4'));
    const decision = { turnId: turn.turnId, source: 'agent_reported', phase: 'choose', summary: 'Claim center.', selectedMove: 'e2e4', confidence: 0.82, elapsedMs: 2_400 };
    assert.equal((await fetch(`${address.httpUrl}/api/agent/decision`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(decision),
    })).status, 202);
    const move = { turnId: turn.turnId, moveUci: 'e2e4' };
    const first = await fetch(`${address.httpUrl}/api/agent/move`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(move),
    });
    assert.equal(first.status, 202);
    const publicDecision = (await getMatch(address, created.matchId)).activity.find((entry) => entry.type === 'agent.decision');
    assert.equal(publicDecision.confidence, 0.82);
    assert.equal(publicDecision.elapsedMs, 2_400);
    assert.equal(JSON.stringify(publicDecision).includes('private reasoning'), false);
    const replay = await fetch(`${address.httpUrl}/api/agent/move`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(move),
    });
    assert.equal((await replay.json()).replayed, true);
    assert.equal((await first.clone().json()).replayed, false);
    const poll = await fetch(`${address.httpUrl}/api/agent/turn?after=${turn.turnId}&waitMs=0`, { headers: auth });
    assert.deepEqual(await poll.json(), { turn: null, timeout: true });
    const conflicting = await fetch(`${address.httpUrl}/api/agent/move`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ ...move, moveUci: 'd2d4' }),
    });
    assert.equal(conflicting.status, 409);
    await fetch(`${address.httpUrl}/api/matches/${created.matchId}/resign`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.black}` },
    });
    const result = await fetch(`${address.httpUrl}/api/agent/result`, { headers: auth });
    assert.equal((await result.json()).status, 'completed');
    assert.equal((await fetch(`${address.httpUrl}/api/agent/match`)).status, 401);
  } finally {
    await server.stop();
  }
});

test('REST match and turn expose Black-relative material after captures', async () => {
  const server = createAgentChessServer();
  const address = await server.start(0);
  const claimBlackAgent = async (created) => {
    const invite = await fetch(`${address.httpUrl}/api/agent-connections`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.black}` },
    }).then((response) => response.json());
    const claimed = await fetch(invite.connection.rest.claimUrl, { method: 'POST' });
    assert.equal(claimed.status, 201);
    const { sessionToken } = await claimed.json();
    return { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' };
  };
  const waitForHumanTurn = async (created) => {
    const until = Date.now() + 3_000;
    while (Date.now() < until) {
      const state = await getMatch(address, created.matchId);
      if (state.activeTurn?.activeColor === 'white') return state.activeTurn;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('human turn timeout');
  };
  const submitHuman = async (created, moveUci) => {
    const turn = await waitForHumanTurn(created);
    const response = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/human-moves`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.capabilities.white}`, 'content-type': 'application/json' },
      body: JSON.stringify({ turnId: turn.turnId, moveUci }),
    });
    assert.equal(response.status, 202);
  };
  const readAgentTurn = async (auth) => {
    const joined = await fetch(`${address.httpUrl}/api/agent/match`, { headers: auth });
    assert.equal(joined.status, 200);
    const joinedTurn = (await joined.json()).turn;
    const polled = await fetch(`${address.httpUrl}/api/agent/turn?waitMs=0`, { headers: auth });
    assert.equal(polled.status, 200);
    const polledTurn = (await polled.json()).turn;
    assert.equal(polledTurn.turnId, joinedTurn.turnId);
    return [joinedTurn, polledTurn];
  };
  const submitAgent = async (auth, turn, moveUci) => {
    const decision = await fetch(`${address.httpUrl}/api/agent/decision`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ turnId: turn.turnId, summary: `Select ${moveUci}.`, selectedMove: moveUci }),
    });
    assert.equal(decision.status, 202);
    const moved = await fetch(`${address.httpUrl}/api/agent/move`, {
      method: 'POST', headers: auth, body: JSON.stringify({ turnId: turn.turnId, moveUci }),
    });
    assert.equal(moved.status, 202);
  };

  try {
    const down = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const downAuth = await claimBlackAgent(down);
    await submitHuman(down, 'e2e4');
    const [openingTurn] = await readAgentTurn(downAuth);
    await submitAgent(downAuth, openingTurn, 'd7d5');
    await submitHuman(down, 'e4d5');
    for (const turn of await readAgentTurn(downAuth)) {
      assert.equal(turn.material.balanceWhite, 1);
      assert.equal(turn.material.capturedByWhite.pawns, 1);
      assert.equal(turn.balanceForAgent, -1);
      assert.equal(JSON.stringify(turn.material).includes('winning'), false);
    }

    const up = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const upAuth = await claimBlackAgent(up);
    await submitHuman(up, 'f2f4');
    let [agentTurn] = await readAgentTurn(upAuth);
    await submitAgent(upAuth, agentTurn, 'e7e5');
    await submitHuman(up, 'g2g4');
    [agentTurn] = await readAgentTurn(upAuth);
    await submitAgent(upAuth, agentTurn, 'e5f4');
    await submitHuman(up, 'h2h3');
    for (const turn of await readAgentTurn(upAuth)) {
      assert.equal(turn.material.balanceWhite, -1);
      assert.equal(turn.material.capturedByBlack.pawns, 1);
      assert.equal(turn.balanceForAgent, 1);
      assert.equal(JSON.stringify(turn.material).includes('winning'), false);
    }
  } finally {
    await server.stop();
  }
});

test('REST same-move replay does not advance engine or replace current turn', async () => {
  let engine;
  class CountingStockfish extends FakeStockfish {
    calls = 0;
    async bestMove(fen) { this.calls += 1; return super.bestMove(fen); }
  }
  const server = createAgentChessServer({ stockfishFactory: async () => (engine = new CountingStockfish()) });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'engine', name: 'Engine' } },
    });
    const invite = await fetch(`${address.httpUrl}/api/agent-connections`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    const { sessionToken } = await fetch(invite.connection.rest.claimUrl, { method: 'POST' }).then((response) => response.json());
    const auth = { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' };
    const { turn } = await fetch(`${address.httpUrl}/api/agent/match`, { headers: auth }).then((response) => response.json());
    await fetch(`${address.httpUrl}/api/agent/decision`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ turnId: turn.turnId, summary: 'Claim center.', selectedMove: 'e2e4' }),
    });
    const move = { turnId: turn.turnId, moveUci: 'e2e4' };
    await fetch(`${address.httpUrl}/api/agent/move`, { method: 'POST', headers: auth, body: JSON.stringify(move) });
    const afterFirst = await fetch(`${address.httpUrl}/api/agent/match`, { headers: auth }).then((response) => response.json());
    assert.equal(engine.calls, 1);
    await fetch(`${address.httpUrl}/api/agent/move`, { method: 'POST', headers: auth, body: JSON.stringify(move) });
    const afterReplay = await fetch(`${address.httpUrl}/api/agent/match`, { headers: auth }).then((response) => response.json());
    assert.equal(engine.calls, 1);
    assert.equal(afterReplay.turn.turnId, afterFirst.turn.turnId);
  } finally {
    await server.stop();
  }
});

test('agent invitation describes a valid single-use connection without leaking its secret publicly', async () => {
  let ticketNow = Date.now();
  const server = createAgentChessServer({
    stockfishFactory: async () => new FakeStockfish(),
    ticketNow: () => ticketNow,
  });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const session = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    });
    assert.equal(session.status, 201);
    const ticket = await session.json();
    assert.equal(ticket.joinPath, `/agent/join?ticket=${encodeURIComponent(ticket.ticket)}`);

    const invite = await fetch(`${address.httpUrl}${ticket.joinPath}`);
    assert.equal(invite.status, 200);
    assert.equal(invite.headers.get('cache-control'), 'no-store');
    const contract = await invite.json();
    assert.deepEqual(Object.keys(contract).sort(), [
      'connection', 'instructions', 'match', 'messageFlow', 'protocolVersion', 'publicTrace', 'seat', 'security', 'service',
    ]);
    assert.equal(contract.protocolVersion, '2.0');
    assert.equal(contract.match.id, created.matchId);
    assert.equal(contract.seat.color, 'white');
    assert.deepEqual(Object.keys(contract.connection).sort(), ['rest', 'websocket']);
    assert.equal(
      contract.connection.rest.claimUrl,
      `${address.httpUrl}/api/agent/claim?ticket=${encodeURIComponent(ticket.ticket)}`,
    );
    assert.equal(contract.connection.websocket.url, `${address.wsUrl}${ticket.wsPath}`);
    assert.equal('mcp' in contract.connection, false);
    assert.equal('restActionOrder' in contract.instructions, false);
    assert.match(contract.instructions.actionOrder.join(' '), /open WebSocket.*match.start.*turn.start.*submit legal UCI/i);
    assert.match(contract.security.secretHandling, /secret.*expires.*single-use/i);
    assert.deepEqual(contract.publicTrace.phases, ['observe', 'probe', 'evaluate', 'choose', 'submit']);
    assert.deepEqual(contract.publicTrace.statusExample, {
      type: 'trace.publish', turnId: '<turnId>', source: 'agent_reported',
      phase: 'probe', summary: 'Comparing forcing moves and king safety.',
    });
    assert.deepEqual(contract.publicTrace.decisionExample.publicTrace, {
      source: 'agent_reported', phase: 'choose', summary: 'Develops while protecting the king.',
      candidates: [{ uci: 'g1f3', note: 'Development and king safety.' }], selectedMove: 'g1f3',
    });

    const repeatedInvite = await fetch(`${address.httpUrl}${ticket.joinPath}`);
    assert.equal(repeatedInvite.status, 200);
    const first = new WebSocket(contract.connection.websocket.url);
    await new Promise((resolve, reject) => { first.once('open', resolve); first.once('error', reject); });
    const expiringInvitation = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    const expiringSocket = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    ticketNow = Date.parse(expiringInvitation.expiresAt);
    assert.equal((await fetch(`${address.httpUrl}${expiringInvitation.joinPath}`)).status, 410);
    assert.equal((await fetch(`${address.httpUrl}/api/agent/claim?ticket=${encodeURIComponent(expiringInvitation.ticket)}`, {
      method: 'POST',
    })).status, 410);
    const expired = new WebSocket(`${address.wsUrl}${expiringSocket.wsPath}`);
    await new Promise((resolve) => { expired.once('close', resolve); expired.once('error', resolve); });
    ticketNow = Date.now();
    const second = new WebSocket(contract.connection.websocket.url);
    await new Promise((resolve) => { second.once('close', resolve); second.once('error', resolve); });
    const unknown = await fetch(`${address.httpUrl}/agent/join?ticket=unknown`);
    assert.equal(unknown.status, 410);
    const snapshot = await getMatch(address, created.matchId);
    const exported = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/export`).then((response) => response.json());
    const publicData = JSON.stringify({ snapshot, exported });
    assert.equal(publicData.includes(ticket.ticket), false);
    assert.equal(publicData.includes(ticket.joinPath), false);
    first.close();
  } finally {
    await server.stop();
  }
});

test('browser copied quoted --path command joins without printing its ticket', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const ticket = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    const command = `npm run --silent connect -- --server ${shellQuote(address.httpUrl)} --path ${shellQuote(ticket.wsPath)} --demo`;
    const child = spawn('/bin/sh', ['-f', '-c', command], {
      cwd: new URL('..', import.meta.url),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('connector did not join')), 3000);
      const poll = () => {
        if (stdout.includes('Accepted:')) finish(resolve);
        else if (child.exitCode !== null) finish(reject, new Error(`connector exited before join: ${child.exitCode}`));
        else if (!settled) setTimeout(poll, 10);
      };
      child.once('error', (error) => finish(reject, error));
      poll();
    });
    await fetch(`${address.httpUrl}/api/matches/${created.matchId}/resign`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.black}` },
    });
    const [code] = await once(child, 'close');
    assert.equal(code, 0, stderr);
    assert.match(stdout, /Game over:/);
    assert.doesNotMatch(`${stdout}\n${stderr}`, /no matches found/);
    assert.equal(`${stdout}\n${stderr}`.includes(ticket.ticket), false);
    assert.equal(`${stdout}\n${stderr}`.includes(ticket.wsPath), false);
    assert.equal(Object.values(created.capabilities).some((value) => `${stdout}\n${stderr}`.includes(value)), false);
  } finally {
    await server.stop();
  }
});

test('generic capabilities remain independent by seat color', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'private_eval', visibility: 'private',
      seats: { white: { kind: 'agent', name: 'A' }, black: { kind: 'agent', name: 'B' } },
    });
    assert.match(created.capabilities.white, /.+/);
    assert.match(created.capabilities.black, /.+/);
    assert.notEqual(created.capabilities.white, created.capabilities.black);
    const humans = await createMatch(address, {
      mode: 'private_eval', visibility: 'private',
      seats: { white: { kind: 'human', name: 'W' }, black: { kind: 'human', name: 'B' } },
    });
    assert.match(humans.capabilities.white, /.+/);
    assert.match(humans.capabilities.black, /.+/);
    assert.notEqual(humans.capabilities.white, humans.capabilities.black);
  } finally {
    await server.stop();
  }
});

test('rejects match creation after reaching process capacity', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  const body = {
    mode: 'private_eval',
    visibility: 'private',
    seats: {
      white: { kind: 'human', name: 'W' },
      black: { kind: 'human', name: 'B' },
    },
  };
  try {
    for (let index = 0; index < 64; index += 1) {
      const response = await fetch(`${address.httpUrl}/api/matches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 201);
    }
    const rejected = await fetch(`${address.httpUrl}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(rejected.status, 429);
    assert.deepEqual(await rejected.json(), { error: 'RESOURCE_LIMIT' });
  } finally {
    await server.stop();
  }
});

test('limits outstanding invitations for one agent seat', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'private_eval',
      visibility: 'private',
      seats: {
        white: { kind: 'agent', name: 'Agent' },
        black: { kind: 'human', name: 'Human' },
      },
    });
    for (let index = 0; index < 8; index += 1) {
      const response = await fetch(`${address.httpUrl}/api/agent-sessions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${created.capabilities.white}` },
      });
      assert.equal(response.status, 201);
    }
    const rejected = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.capabilities.white}` },
    });
    assert.equal(rejected.status, 429);
    assert.deepEqual(await rejected.json(), { error: 'RESOURCE_LIMIT' });
  } finally {
    await server.stop();
  }
});

test('agent reconnect preserves original active-turn deadline', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'private_eval', visibility: 'private', decisionDeadlineMs: 5000,
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const exchange = () => fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    const firstTicket = await exchange();
    const first = new WebSocket(`${address.wsUrl}${firstTicket.wsPath}`);
    const firstMessages = collectMessages(first);
    await new Promise((resolve, reject) => { first.once('open', resolve); first.once('error', reject); });
    const firstTurn = await firstMessages.next((message) => message.type === 'turn.start');
    first.close();
    await once(first, 'close');
    const secondTicket = await exchange();
    const second = new WebSocket(`${address.wsUrl}${secondTicket.wsPath}`);
    const secondMessages = collectMessages(second);
    await new Promise((resolve, reject) => { second.once('open', resolve); second.once('error', reject); });
    const replay = await secondMessages.next((message) => message.type === 'turn.start');
    assert.equal(replay.turnId, firstTurn.turnId);
    assert.equal(replay.deadline, firstTurn.deadline);
    const reconnectSnapshot = await getMatch(address, created.matchId, created.capabilities.white);
    assert.equal(reconnectSnapshot.activity.filter((entry) => entry.type === 'agent.disconnect' && entry.turnId === firstTurn.turnId).length, 1);
    assert.equal(reconnectSnapshot.activity.filter((entry) => entry.type === 'agent.turn.ready' && entry.turnId === firstTurn.turnId).length, 2);
    second.close();
  } finally {
    await server.stop();
  }
});

test('agent decision deadline starts when active turn reaches its first transport', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public', decisionDeadlineMs: 80,
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const beforeConnect = await getMatch(address, created.matchId);
    assert.equal(beforeConnect.status, 'active');
    assert.equal(beforeConnect.activeTurn.deadline, null);

    const ticket = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    const socket = new WebSocket(`${address.wsUrl}${ticket.wsPath}`);
    const messages = collectMessages(socket);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const turn = await messages.next((message) => message.type === 'turn.start');
    assert.equal(turn.deadlineMs, 80);
    assert.ok(new Date(turn.deadline).getTime() > Date.now());
    const ended = await messages.next((message) => message.type === 'game.end');
    assert.equal(ended.failureCode, 'AGENT_DECISION_TIMEOUT');
    socket.close();
  } finally {
    await server.stop();
  }
});

test('sends protocol game.end once for natural completion, resignation, and decision deadline', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  const connectAgent = async (created, color) => {
    const ticket = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities[color]}` },
    }).then((response) => response.json());
    const socket = new WebSocket(`${address.wsUrl}${ticket.wsPath}`);
    const messages = collectMessages(socket);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await messages.next((message) => message.type === 'match.start');
    return { socket, messages };
  };
  const submitHuman = async (created, turnId, moveUci) => fetch(`${address.httpUrl}/api/matches/${created.matchId}/human-moves`, {
    method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}`, 'content-type': 'application/json' },
    body: JSON.stringify({ turnId, moveUci }),
  });
  try {
    const natural = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const observer = new WebSocket(`${address.wsUrl}/events?matchId=${natural.matchId}`);
    const observerMessages = collectMessages(observer);
    await new Promise((resolve, reject) => { observer.once('open', resolve); observer.once('error', reject); });
    const agent = await connectAgent(natural, 'black');
    let state = await getMatch(address, natural.matchId);
    await submitHuman(natural, state.activeTurn.turnId, 'f2f3');
    let turn = await agent.messages.next((message) => message.type === 'turn.start');
    agent.socket.send(JSON.stringify({ type: 'move.submit', turnId: turn.turnId, moveUci: 'e7e5', publicTrace: { summary: 'e5', candidates: [{ uci: 'e7e5' }], selectedMove: 'e7e5' } }));
    await agent.messages.next((message) => message.type === 'move.accepted');
    state = await getMatch(address, natural.matchId);
    await submitHuman(natural, state.activeTurn.turnId, 'g2g4');
    turn = await agent.messages.next((message) => message.type === 'turn.start');
    agent.socket.send(JSON.stringify({ type: 'move.submit', turnId: turn.turnId, moveUci: 'd8h4', publicTrace: { summary: 'mate', candidates: [{ uci: 'd8h4' }], selectedMove: 'd8h4' } }));
    const ended = await agent.messages.next((message) => message.type === 'game.end');
    assert.equal(ended.result, '0-1');
    await observerMessages.next((message) => message.type === 'game.end');
    const finalState = await observerMessages.next((message) => message.type === 'match.state' && message.match.status === 'completed');
    assert.equal(finalState.match.activeTurn, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await getMatch(address, natural.matchId)).status, 'completed');
    assert.equal(agent.messages.count((message) => message.type === 'game.end'), 1);
    assert.equal(observerMessages.count((message) => message.type === 'game.end'), 1);
    agent.socket.close(); observer.close();

    const resigned = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const resignedAgent = await connectAgent(resigned, 'black');
    const resign = await fetch(`${address.httpUrl}/api/matches/${resigned.matchId}/resign`, {
      method: 'POST', headers: { authorization: `Bearer ${resigned.capabilities.white}` },
    });
    assert.equal(resign.status, 202);
    await resignedAgent.messages.next((message) => message.type === 'game.end');
    assert.equal((await fetch(`${address.httpUrl}/api/matches/${resigned.matchId}/resign`, {
      method: 'POST', headers: { authorization: `Bearer ${resigned.capabilities.white}` },
    })).status, 202);
    resignedAgent.socket.close();

    const aborted = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const abortedAgent = await connectAgent(aborted, 'black');
    assert.equal((await fetch(`${address.httpUrl}/api/matches/${aborted.matchId}/abort`, {
      method: 'POST', headers: { authorization: `Bearer ${aborted.capabilities.white}` },
    })).status, 202);
    await abortedAgent.messages.next((message) => message.type === 'game.end');
    abortedAgent.socket.close();

    const deadline = await createMatch(address, {
      mode: 'exhibition', visibility: 'public', decisionDeadlineMs: 20,
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const deadlineAgent = await connectAgent(deadline, 'white');
    await deadlineAgent.messages.next((message) => message.type === 'turn.start');
    const deadlineEnd = await deadlineAgent.messages.next((message) => message.type === 'game.end');
    assert.equal(deadlineEnd.result, '*');
    assert.deepEqual({ status: deadlineEnd.status, termination: deadlineEnd.termination, failureCode: deadlineEnd.failureCode }, {
      status: 'failed', termination: 'failure', failureCode: 'AGENT_DECISION_TIMEOUT',
    });
    const deadlineError = await deadlineAgent.messages.next((message) => message.type === 'error');
    assert.equal(deadlineError.code, 'AGENT_DECISION_TIMEOUT');
    const deadlineEvents = deadlineAgent.messages.ordered();
    assert.ok(deadlineEvents.findIndex((message) => message.type === 'error' && message.code === 'AGENT_DECISION_TIMEOUT')
      < deadlineEvents.findIndex((message) => message.type === 'game.end'));
    assert.doesNotMatch(JSON.stringify([deadlineEnd, deadlineError]), /Decision deadline exceeded/);
    assert.equal(deadlineAgent.messages.count((message) => message.type === 'game.end'), 1);
    deadlineAgent.socket.close();
  } finally {
    await server.stop();
  }
});

test('preserves provider summary provenance through connector protocol server and public snapshot', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const ticket = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    const socket = new WebSocket(`${address.wsUrl}${ticket.wsPath}`);
    const messages = collectMessages(socket);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const turn = await messages.next((message) => message.type === 'turn.start');
    socket.send(JSON.stringify({
      type: 'move.submit', turnId: turn.turnId, moveUci: 'e2e4',
      publicTrace: { source: 'provider_summary', summary: 'Provider picked center.', candidates: [{ uci: 'e2e4' }], selectedMove: 'e2e4' },
    }));
    await messages.next((message) => message.type === 'move.accepted');
    const state = await getMatch(address, created.matchId);
    assert.equal(state.activity.find((entry) => entry.type === 'agent.decision').source, 'provider_summary');
    socket.close();
  } finally {
    await server.stop();
  }
});

test('reference connector exits nonzero after stable decision-deadline failure', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public', decisionDeadlineMs: 30,
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const child = spawn(process.execPath, [
      'bin/connect-agent.js', '--server', address.httpUrl, '--seat', created.capabilities.white,
      '--command', 'node test/fixtures/slow-legal-agent.js',
    ], { cwd: new URL('..', import.meta.url) });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 1);
    assert.doesNotMatch(`${stdout}\n${stderr}`, /Decision deadline exceeded/);
    const snapshot = await getMatch(address, created.matchId);
    assert.deepEqual({ status: snapshot.status, termination: snapshot.termination, failureCode: snapshot.failureCode }, {
      status: 'failed', termination: 'failure', failureCode: 'AGENT_DECISION_TIMEOUT',
    });
  } finally {
    await server.stop();
  }
});

test('reference connector keeps command stderr diagnostics local and publishes stable failure status', async () => {
  const secret = 'connector-child-secret';
  const privatePath = '/Users/example/private-agent.js';
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const result = await runReferenceConnectorFailure(address, created, 'node test/fixtures/failing-secret-agent.js');
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(secret));
    assert.match(result.stderr, new RegExp(privatePath.replaceAll('/', '\\/')));
    assert.equal(result.failedTrace.entry.summary, 'Agent connector failed.');
    assert.equal(result.failedTrace.entry.source, 'adapter_generated');
    const publicText = JSON.stringify({ events: result.events, snapshot: result.snapshot, exported: result.exported });
    assert.doesNotMatch(publicText, new RegExp(secret));
    assert.doesNotMatch(publicText, new RegExp(privatePath.replaceAll('/', '\\/')));
  } finally {
    await server.stop();
  }
});

test('reference connector publishes stable failure when command returns invalid trace source', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const result = await runReferenceConnectorFailure(address, created, 'node test/fixtures/invalid-trace-source-agent.js');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /INVALID_TRACE_SOURCE/);
    assert.equal(result.failedTrace.entry.summary, 'Agent connector failed.');
    const publicText = JSON.stringify({ events: result.events, snapshot: result.snapshot, exported: result.exported });
    assert.doesNotMatch(publicText, /INVALID_TRACE_SOURCE|"System"/);
  } finally {
    await server.stop();
  }
});

test('reference connector exits nonzero on engine failure without raw diagnostics', async () => {
  const secret = 'engine-child-secret-diagnostic';
  const server = createAgentChessServer({ stockfishFactory: async () => ({
    async bestMove() { throw new Error(secret); }, close() {},
  }) });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, { agentColor: 'white' });
    const observer = new WebSocket(`${address.wsUrl}/events?matchId=${created.matchId}`);
    const observerMessages = collectMessages(observer);
    await new Promise((resolve, reject) => { observer.once('open', resolve); observer.once('error', reject); });
    const child = spawn(process.execPath, [
      'bin/connect-agent.js', '--server', address.httpUrl, '--seat', created.seatToken, '--demo',
    ], { cwd: new URL('..', import.meta.url) });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [code] = await once(child, 'close');
    const error = await observerMessages.next((message) => message.type === 'error');
    await observerMessages.next((message) => message.type === 'game.end');
    assert.equal(code, 1);
    assert.deepEqual(error, { type: 'error', code: 'ENGINE_FAILURE', message: 'Engine unavailable', recoverable: false });
    assert.equal(observerMessages.count((message) => message.type === 'game.end'), 1);
    assert.doesNotMatch(`${stdout}\n${stderr}`, new RegExp(secret));
    const events = observerMessages.ordered();
    assert.ok(events.findIndex((message) => message.type === 'error' && message.code === 'ENGINE_FAILURE')
      < events.findIndex((message) => message.type === 'game.end'));
    observer.close();
  } finally {
    await server.stop();
  }
});

test('terminal agent reconnect receives one game.end without re-emitting match terminal events', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const connect = async () => {
      const ticket = await fetch(`${address.httpUrl}/api/agent-sessions`, {
        method: 'POST', headers: { authorization: `Bearer ${created.capabilities.black}` },
      }).then((response) => response.json());
      const socket = new WebSocket(`${address.wsUrl}${ticket.wsPath}`);
      const messages = collectMessages(socket);
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      await messages.next((message) => message.type === 'match.start');
      return { socket, messages };
    };
    const first = await connect();
    await fetch(`${address.httpUrl}/api/matches/${created.matchId}/resign`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    });
    await first.messages.next((message) => message.type === 'game.end');
    first.socket.close();
    const second = await connect();
    await second.messages.next((message) => message.type === 'game.end');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(second.messages.count((message) => message.type === 'game.end'), 1);
    second.socket.close();
  } finally {
    await server.stop();
  }
});

test('terminal emission sends one game.end when resignation races agent connection dispatch', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const ticket = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.black}` },
    }).then((response) => response.json());
    const socket = new WebSocket(`${address.wsUrl}${ticket.wsPath}`);
    const messages = collectMessages(socket);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await fetch(`${address.httpUrl}/api/matches/${created.matchId}/resign`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    });
    await messages.next((message) => message.type === 'match.start');
    await messages.next((message) => message.type === 'game.end');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(messages.count((message) => message.type === 'game.end'), 1);
    socket.close();
  } finally {
    await server.stop();
  }
});

test('ignores rejected engine search after a human terminal action', async () => {
  let rejectMove;
  const pendingMove = new Promise((resolve, reject) => { rejectMove = reject; });
  const server = createAgentChessServer({ stockfishFactory: async () => ({ bestMove: () => pendingMove, close() {} }) });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'engine', name: 'Engine' } },
    });
    const state = await getMatch(address, created.matchId);
    await fetch(`${address.httpUrl}/api/matches/${created.matchId}/human-moves`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}`, 'content-type': 'application/json' },
      body: JSON.stringify({ turnId: state.activeTurn.turnId, moveUci: 'e2e4' }),
    });
    await fetch(`${address.httpUrl}/api/matches/${created.matchId}/resign`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    });
    rejectMove(new Error('late engine rejection'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const finalState = await getMatch(address, created.matchId);
    assert.equal(finalState.status, 'completed');
    assert.equal(finalState.activity.some((entry) => entry.code === 'ENGINE_FAILURE'), false);
  } finally {
    await server.stop();
  }
});

test('ignores stale engine results and failures after a human terminal action', async () => {
  let resolveMove;
  const pendingMove = new Promise((resolve) => { resolveMove = resolve; });
  const server = createAgentChessServer({ stockfishFactory: async () => ({ bestMove: () => pendingMove, close() {} }) });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'engine', name: 'Engine' } },
    });
    const state = await getMatch(address, created.matchId);
    assert.equal((await fetch(`${address.httpUrl}/api/matches/${created.matchId}/human-moves`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}`, 'content-type': 'application/json' },
      body: JSON.stringify({ turnId: state.activeTurn.turnId, moveUci: 'e2e4' }),
    })).status, 202);
    assert.equal((await fetch(`${address.httpUrl}/api/matches/${created.matchId}/resign`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    })).status, 202);
    resolveMove('e7e5');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const finalState = await getMatch(address, created.matchId);
    assert.equal(finalState.status, 'completed');
    assert.equal(finalState.game.ply, 1);
    assert.equal(finalState.activity.some((entry) => entry.code === 'ENGINE_FAILURE'), false);
  } finally {
    await server.stop();
  }
});

test('steering requires a bound seat capability', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'private_eval', visibility: 'private', steeringMode: 'trainer',
      seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'agent', name: 'Agent' } },
    });
    const path = `${address.httpUrl}/api/matches/${created.matchId}/steering`;
    assert.equal((await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guidance: 'x' }) })).status, 401);
    assert.equal((await fetch(path, { method: 'POST', headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' }, body: JSON.stringify({ guidance: 'x' }) })).status, 401);
    assert.equal((await fetch(path, { method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}`, 'content-type': 'application/json' }, body: JSON.stringify({ guidance: 'x' }) })).status, 202);
  } finally {
    await server.stop();
  }
});

test('engine failures never expose raw diagnostics', async () => {
  const secret = 'engine-secret-diagnostic';
  const server = createAgentChessServer({ stockfishFactory: async () => ({ async bestMove() { throw new Error(secret); }, close() {} }) });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'exhibition', visibility: 'public',
      seats: { white: { kind: 'engine', name: 'Engine' }, black: { kind: 'human', name: 'Human' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const snapshot = await getMatch(address, created.matchId);
    const exported = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/export`).then((response) => response.json());
    assert.equal(JSON.stringify({ snapshot, exported }).includes(secret), false);
    assert.equal(snapshot.status, 'failed');
    assert.equal(snapshot.termination, 'failure');
    assert.equal(snapshot.failureCode, 'ENGINE_FAILURE');
    assert.ok(snapshot.activity.some((entry) => entry.code === 'ENGINE_FAILURE' && entry.summary === 'Engine unavailable'));
  } finally {
    await server.stop();
  }
});

test('private_eval suppresses agent decision traces from state and export', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);
  try {
    const created = await createMatch(address, {
      mode: 'private_eval', visibility: 'private',
      seats: { white: { kind: 'agent', name: 'Agent' }, black: { kind: 'human', name: 'Human' } },
    });
    const ticket = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    const socket = new WebSocket(`${address.wsUrl}${ticket.wsPath}`);
    const messages = collectMessages(socket);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const turn = await messages.next((message) => message.type === 'turn.start');
    socket.send(JSON.stringify({ type: 'trace.publish', turnId: turn.turnId, summary: 'private reasoning' }));
    const rejected = await messages.next((message) => message.type === 'move.rejected');
    assert.equal(rejected.code, 'TRACE_NOT_ALLOWED');
    socket.send(JSON.stringify({ type: 'move.submit', turnId: turn.turnId, moveUci: 'e2e4', publicTrace: {
      summary: 'private reasoning', candidates: [{ uci: 'e2e4', note: 'secret' }], selectedMove: 'e2e4',
    } }));
    await messages.next((message) => message.type === 'move.accepted');
    const snapshot = await getMatch(address, created.matchId, created.capabilities.white);
    const exported = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/export`, {
      headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    assert.equal(JSON.stringify({ snapshot, exported }).includes('private reasoning'), false);
    assert.equal(snapshot.activity.some((entry) => entry.type === 'agent.decision'), false);
    socket.close();
  } finally {
    await server.stop();
  }
});

test('engine startup failures use a stable public error without factory diagnostics', async () => {
  const secret = 'factory-startup-secret';
  const server = createAgentChessServer({ stockfishFactory: async () => { throw new Error(secret); } });
  const address = await server.start(0);
  try {
    const response = await fetch(`${address.httpUrl}/api/matches`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'exhibition', visibility: 'public', seats: {
        white: { kind: 'engine', name: 'Engine' }, black: { kind: 'human', name: 'Human' },
      } }),
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.deepEqual(body, { error: 'ENGINE_UNAVAILABLE', message: 'Engine unavailable' });
    assert.equal(JSON.stringify(body).includes(secret), false);
  } finally {
    await server.stop();
  }
});

test('sends a compact protocol 2.0 turn and routes probes to its authenticated seat', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);

  try {
    const response = await fetch(`${address.httpUrl}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentColor: 'white', steeringMode: 'locked' }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.ok(created.matchId);
    assert.ok(created.seatToken);

    const socket = new WebSocket(`${address.wsUrl}/agent?token=${created.seatToken}`);
    const messages = collectMessages(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    const started = await messages.next( (message) => message.type === 'match.start');
    assert.equal(started.matchId, created.matchId);

    const turn = await messages.next( (message) => message.type === 'turn.start');
    assert.equal(turn.agentColor, 'white');
    assert.equal(turn.protocolVersion, '2.0');
    assert.equal(turn.deadline, null);
    assert.equal('legalMoves' in turn, false);
    assert.deepEqual(turn.positionStatus.movablePieces.find((piece) => piece.square === 'e2'), {
      square: 'e2', piece: 'pawn',
    });

    socket.send(JSON.stringify({ type: 'moves.list', turnId: turn.turnId, square: 'e2' }));
    const listed = await messages.next((message) => message.type === 'moves.list.result');
    assert.equal(listed.turnId, turn.turnId);
    assert.equal(listed.square, 'e2');
    assert.deepEqual(listed.moves.map((move) => move.uci), ['e2e3', 'e2e4']);

    socket.send(JSON.stringify({ type: 'moves.list', turnId: 'stale-turn', square: 'e2' }));
    const rejected = await messages.next((message) => message.type === 'move.rejected');
    assert.equal(rejected.code, 'STALE_TURN');
    socket.close();
  } finally {
    await server.stop();
  }
});

test('accepts an agent move, runs the opponent, and emits the next turn', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);

  try {
    const created = await fetch(`${address.httpUrl}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentColor: 'white', steeringMode: 'trainer' }),
    }).then((response) => response.json());

    const socket = new WebSocket(`${address.wsUrl}/agent?token=${created.seatToken}`);
    const messages = collectMessages(socket);
    await new Promise((resolve) => socket.once('open', resolve));
    await messages.next( (message) => message.type === 'match.start');
    const firstTurn = await messages.next( (message) => message.type === 'turn.start');

    socket.send(JSON.stringify({
      type: 'move.submit',
      turnId: firstTurn.turnId,
      moveUci: 'e2e4',
    }));

    const accepted = await messages.next( (message) => message.type === 'move.accepted');
    assert.equal(accepted.moveUci, 'e2e4');

    const secondTurn = await messages.next(
      (message) => message.type === 'turn.start' && message.turnId !== firstTurn.turnId
    );
    assert.equal(secondTurn.recentMoves.length, 2);
    assert.equal(secondTurn.recentMoves[0].uci, 'e2e4');
    socket.close();
  } finally {
    await server.stop();
  }
});

test('fails after an engine error and stores a visible nonrecoverable error', async () => {
  let calls = 0;
  const server = createAgentChessServer({ stockfishFactory: async () => ({
    async bestMove() { calls += 1; throw new Error('engine unavailable'); }, close() {},
  }) });
  const address = await server.start(0);
  try {
    const created = await fetch(`${address.httpUrl}/api/matches`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentColor: 'white' }),
    }).then((response) => response.json());
    const agent = new WebSocket(`${address.wsUrl}/agent?token=${created.seatToken}`);
    const messages = collectMessages(agent);
    await new Promise((resolve) => agent.once('open', resolve));
    await messages.next((message) => message.type === 'match.start');
    const turn = await messages.next((message) => message.type === 'turn.start');
    agent.send(JSON.stringify({ type: 'move.submit', turnId: turn.turnId, moveUci: 'e2e4' }));
    const failure = await messages.next((message) => message.type === 'error' && message.code === 'ENGINE_FAILURE');
    assert.equal(failure.recoverable, false);
    const ended = await messages.next((message) => message.type === 'game.end');
    assert.deepEqual({ status: ended.status, termination: ended.termination, failureCode: ended.failureCode }, {
      status: 'failed', termination: 'failure', failureCode: 'ENGINE_FAILURE',
    });
    assert.equal(messages.count((message) => message.type === 'game.end'), 1);
    const events = messages.ordered();
    assert.ok(events.findIndex((message) => message.type === 'error' && message.code === 'ENGINE_FAILURE')
      < events.findIndex((message) => message.type === 'game.end'));
    await new Promise((resolve) => setTimeout(resolve, 25));
    const state = await fetch(`${address.httpUrl}/api/matches/${created.matchId}`).then((response) => response.json());
    assert.equal(calls, 1);
    const failureActivity = state.activity.find((entry) => entry.type === 'error' && entry.summary === 'Engine unavailable');
    assert.equal(failureActivity.recoverable, false);
    assert.equal(formatActivity(failureActivity).label, 'Match failed');
    agent.close();
  } finally {
    await server.stop();
  }
});

test('broadcasts only status progress in observer state before move submission', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeStockfish() });
  const address = await server.start(0);

  try {
    const created = await fetch(`${address.httpUrl}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentColor: 'white' }),
    }).then((response) => response.json());
    const observer = new WebSocket(`${address.wsUrl}/events?matchId=${created.matchId}`);
    const observerMessages = collectMessages(observer);
    const agent = new WebSocket(`${address.wsUrl}/agent?token=${created.seatToken}`);
    const agentMessages = collectMessages(agent);
    await Promise.all([observer, agent].map((socket) => new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    })));
    await agentMessages.next((message) => message.type === 'match.start');
    const turn = await agentMessages.next((message) => message.type === 'turn.start');
    await observerMessages.next((message) => message.type === 'match.state');

    agent.send(JSON.stringify({
      type: 'trace.publish',
      turnId: turn.turnId,
      summary: 'Malformed trace.',
      candidates: [{ uci: 'e2e9', note: 'Invalid destination.' }],
    }));
    const rejected = await agentMessages.next((message) => message.type === 'move.rejected');
    assert.equal(rejected.code, 'INVALID_MOVE_FORMAT');
    assert.equal(rejected.turnId, turn.turnId);
    const afterRejected = await fetch(`${address.httpUrl}/api/matches/${created.matchId}`).then((response) => response.json());
    assert.equal(afterRejected.activity.some((entry) => entry.type === 'agent.trace'), false);

    agent.send(JSON.stringify({
      type: 'trace.publish',
      turnId: turn.turnId,
      kind: 'decision',
      phase: 'choose',
      summary: 'Prefer center.',
      candidates: [{ uci: 'e2e4', note: 'Controls d5.' }],
      selectedMove: 'e2e4',
    }));

    const state = await observerMessages.next((message) => (
      message.type === 'match.state'
      && message.match.activity.some((entry) => entry.type === 'agent.trace')
    ));
    const trace = state.match.activity.find((entry) => entry.type === 'agent.trace');
    assert.deepEqual(trace.candidates, []);
    assert.equal(trace.selectedMove, null);
    assert.equal(trace.kind, 'status');
    assert.equal(trace.source, 'agent_reported');
    assert.equal(trace.actor, 'connector');
    agent.close();
    observer.close();
  } finally {
    await server.stop();
  }
});

test('owns one engine instance per match', async () => {
  let starts = 0;
  const server = createAgentChessServer({
    stockfishFactory: async () => {
      starts += 1;
      return new FakeStockfish();
    },
  });
  const address = await server.start(0);

  try {
    for (let i = 0; i < 2; i += 1) {
      const response = await fetch(`${address.httpUrl}/api/matches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillLevel: i }),
      });
      assert.equal(response.status, 201);
    }
    assert.equal(starts, 2);
  } finally {
    await server.stop();
  }
});
