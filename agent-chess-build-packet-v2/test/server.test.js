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

test('creates a match and sends the first legal turn to an authenticated agent seat', async () => {
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
    assert.equal(turn.color, 'white');
    assert.equal(turn.legalMoves.length, 20);
    assert.ok(turn.legalMoves.some((move) => move.uci === 'e2e4'));
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
    assert.equal(secondTurn.movesUci.length, 2);
    assert.equal(secondTurn.movesUci[0], 'e2e4');
    socket.close();
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
