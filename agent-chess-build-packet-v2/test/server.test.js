import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { Chess } from 'chess.js';
import WebSocket from 'ws';
import { createAgentChessServer } from '../src/server.js';
import { runSmoke } from '../bin/smoke-human.js';

class FakeStockfish {
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

test('agent capability exchanges once for a sixty-second ticket', async () => {
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
    assert.ok(Date.parse(ticket.expiresAt) - Date.now() <= 60_000);
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

test('browser copied --path connector command joins through its already-exchanged ticket', async () => {
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
    const child = spawn(process.execPath, ['bin/connect-agent.js', '--server', address.httpUrl, '--path', ticket.wsPath, '--demo'], {
      cwd: new URL('..', import.meta.url),
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connector did not join')), 3000);
      const poll = () => {
        if (stdout.includes('Connected to agent seat.')) { clearTimeout(timer); resolve(); }
        else setTimeout(poll, 10);
      };
      poll();
    });
    await fetch(`${address.httpUrl}/api/matches/${created.matchId}/resign`, {
      method: 'POST', headers: { authorization: `Bearer ${created.capabilities.black}` },
    });
    const [code] = await once(child, 'close');
    assert.equal(code, 0);
    assert.match(stdout, /Game over:/);
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
    const secondTicket = await exchange();
    const second = new WebSocket(`${address.wsUrl}${secondTicket.wsPath}`);
    const secondMessages = collectMessages(second);
    await new Promise((resolve, reject) => { second.once('open', resolve); second.once('error', reject); });
    const replay = await secondMessages.next((message) => message.type === 'turn.start');
    assert.equal(replay.turnId, firstTurn.turnId);
    assert.equal(replay.deadline, firstTurn.deadline);
    second.close();
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
    deadlineAgent.socket.close();
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

test('pauses after an engine failure and stores a visible recoverable error', async () => {
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
    assert.equal(failure.recoverable, true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const state = await fetch(`${address.httpUrl}/api/matches/${created.matchId}`).then((response) => response.json());
    assert.equal(calls, 1);
    assert.ok(state.activity.some((entry) => entry.type === 'error' && entry.summary === 'Engine unavailable'));
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
