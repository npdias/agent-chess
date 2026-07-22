import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import WebSocket from 'ws';
import { createAgentChessServer } from '../src/server.js';

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
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
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

test('broadcasts trace candidates in observer state', async () => {
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
    assert.deepEqual(trace.candidates, [{ uci: 'e2e4', note: 'Controls d5.' }]);
    assert.equal(trace.selectedMove, 'e2e4');
    assert.equal(trace.kind, 'decision');
    agent.close();
    observer.close();
  } finally {
    await server.stop();
  }
});

test('reuses one queued engine instance across multiple matches', async () => {
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
    assert.equal(starts, 1);
  } finally {
    await server.stop();
  }
});
