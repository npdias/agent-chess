import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createAgentChessServer } from '../src/server.js';

const hostedClientPath = fileURLToPath(new URL('../public/agent-play.js', import.meta.url));

function jsonLines(stream) {
  const queue = [];
  const waiters = [];
  const lines = createInterface({ input: stream });
  lines.on('line', (line) => {
    let value;
    try { value = JSON.parse(line); } catch { return; }
    const index = waiters.findIndex(({ predicate }) => predicate(value));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(value);
    } else {
      queue.push(value);
    }
  });
  return {
    next(predicate, timeoutMs = 3000) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const current = waiters.indexOf(waiter);
          if (current >= 0) waiters.splice(current, 1);
          reject(new Error('connector output timeout'));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    close() { lines.close(); },
  };
}

async function createAgentVsHuman(address) {
  const response = await fetch(`${address.httpUrl}/api/matches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'exhibition',
      visibility: 'public',
      seats: {
        white: { kind: 'agent', name: 'Agent' },
        black: { kind: 'human', name: 'Human' },
      },
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function runClient(clientPath, args, cwd, timeoutMs = 3000) {
  const child = spawn(process.execPath, [clientPath, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  const [code, signal] = await once(child, 'exit');
  clearTimeout(timer);
  const stdoutText = Buffer.concat(stdout).toString();
  const stderrText = Buffer.concat(stderr).toString();
  assert.equal(code, 0, `client exited ${code ?? signal}: ${stderrText || stdoutText}`);
  const messages = stdoutText.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return { message: messages.at(-1), stdout: stdoutText, stderr: stderrText };
}

async function runFailingClient(clientPath, args, cwd, timeoutMs = 3000) {
  const child = spawn(process.execPath, [clientPath, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  const [code, signal] = await once(child, 'exit');
  clearTimeout(timer);
  const stdoutText = Buffer.concat(stdout).toString();
  const stderrText = Buffer.concat(stderr).toString();
  assert.notEqual(code, 0, `client unexpectedly succeeded${signal ? ` (${signal})` : ''}`);
  const messages = stdoutText.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return { message: messages.at(-1), stdout: stdoutText, stderr: stderrText };
}

test('short REST commands resume one match across separate client processes', async () => {
  const server = createAgentChessServer();
  const address = await server.start(0);
  const emptyCwd = await mkdtemp(join(tmpdir(), 'agent-chess-rest-play-'));
  let sessionDirectory;
  try {
    const created = await createAgentVsHuman(address);
    const invitation = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    const joinUrl = new URL(invitation.joinPath, address.httpUrl).toString();

    const joined = await runClient(hostedClientPath, ['join', '--join-url', joinUrl], emptyCwd);
    assert.equal(joined.message.type, 'session.ready');
    assert.equal(joined.message.matchId, created.matchId);
    sessionDirectory = dirname(joined.message.clientPath);
    const sessionMode = (await stat(joined.message.sessionPath)).mode & 0o777;
    assert.equal(sessionMode, 0o600);
    const storedSession = JSON.parse(await readFile(joined.message.sessionPath, 'utf8'));

    const turn = await runClient(
      joined.message.clientPath,
      ['turn', '--match', created.matchId],
      emptyCwd,
    );
    assert.equal(turn.message.type, 'turn.ready');
    assert.ok(turn.message.legalMoves.some(({ uci }) => uci === 'e2e4'));
    assert.equal('boardImage' in turn.message.turn, false);
    assert.equal(turn.message.attachments.length, 1);
    const [attachment] = turn.message.attachments;
    assert.equal(attachment.type, 'image');
    assert.equal(attachment.mimeType, 'image/png');
    assert.equal(attachment.alt, 'Canonical board position from authoritative FEN. White to move.');
    assert.match(attachment.dataUrl, /^data:image\/png;base64,/);
    assert.ok(attachment.imagePath.startsWith(`${sessionDirectory}/`));
    assert.equal((await stat(attachment.imagePath)).mode & 0o777, 0o600);
    const imageBytes = await readFile(attachment.imagePath);
    assert.equal(imageBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual(imageBytes, Buffer.from(attachment.dataUrl.split(',')[1], 'base64'));

    const moved = await runClient(
      joined.message.clientPath,
      [
        'move',
        '--match',
        created.matchId,
        '--json',
        JSON.stringify({
          turnId: turn.message.turn.turnId,
          moveUci: 'e2e4',
          publicTrace: {
            source: 'agent_reported',
            phase: 'choose',
            summary: 'Claims central space.',
            candidates: [{ uci: 'e2e4', note: 'Space and development.' }],
            selectedMove: 'e2e4',
          },
        }),
      ],
      emptyCwd,
    );
    assert.equal(moved.message.accepted, true);
    const snapshot = await fetch(`${address.httpUrl}/api/matches/${created.matchId}`).then((response) => response.json());
    assert.deepEqual(snapshot.game.movesUci, ['e2e4']);
    const humanMove = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/human-moves`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${created.capabilities.black}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ turnId: snapshot.activeTurn.turnId, moveUci: 'e7e5' }),
    });
    assert.equal(humanMove.status, 202);
    const nextTurn = await runClient(
      joined.message.clientPath,
      ['turn', '--match', created.matchId],
      emptyCwd,
    );
    assert.notEqual(nextTurn.message.attachments[0].imagePath, attachment.imagePath);
    await assert.rejects(stat(attachment.imagePath), { code: 'ENOENT' });
    assert.equal((await stat(nextTurn.message.attachments[0].imagePath)).mode & 0o777, 0o600);

    const status = await runClient(
      joined.message.clientPath,
      ['status', '--match', created.matchId],
      emptyCwd,
    );
    assert.equal(status.message.type, 'session.status');
    assert.equal(status.message.matchId, created.matchId);
    assert.equal(status.message.session, 'valid');

    const captured = [joined, turn, moved, status].flatMap(({ stdout, stderr }) => [stdout, stderr]).join('\n');
    assert.equal(captured.includes(invitation.ticket), false);
    assert.equal(captured.includes(storedSession.sessionToken), false);
  } finally {
    await server.stop();
    if (sessionDirectory) await rm(sessionDirectory, { recursive: true, force: true });
    await rm(emptyCwd, { recursive: true, force: true });
  }
});

test('join leaves invitation reusable when client cache download fails', async () => {
  const server = createAgentChessServer();
  const address = await server.start(0);
  const emptyCwd = await mkdtemp(join(tmpdir(), 'agent-chess-cache-failure-'));
  let proxy;
  try {
    const created = await createAgentVsHuman(address);
    const invitation = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((response) => response.json());
    const realContract = await fetch(new URL(invitation.joinPath, address.httpUrl)).then((response) => response.json());
    proxy = createHttpServer((request, response) => {
      if (request.url?.startsWith('/agent/join')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(realContract));
        return;
      }
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unavailable' }));
    });
    await new Promise((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const proxyAddress = proxy.address();
    const joinUrl = `http://127.0.0.1:${proxyAddress.port}/agent/join?ticket=${encodeURIComponent(invitation.ticket)}`;
    const failed = await runFailingClient(hostedClientPath, ['join', '--join-url', joinUrl], emptyCwd);
    assert.equal(failed.message.code, 'CONNECTOR_DOWNLOAD_FAILED_503');

    const claim = await fetch(realContract.connection.rest.claimUrl, { method: 'POST' });
    assert.equal(claim.status, 201);
  } finally {
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
    await server.stop();
    await rm(emptyCwd, { recursive: true, force: true });
  }
});

test('short REST status diagnoses a missed decision deadline', async () => {
  const server = createAgentChessServer();
  const address = await server.start(0);
  const emptyCwd = await mkdtemp(join(tmpdir(), 'agent-chess-rest-timeout-'));
  let sessionDirectory;
  try {
    const response = await fetch(`${address.httpUrl}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'exhibition',
        visibility: 'public',
        decisionDeadlineMs: 60,
        seats: {
          white: { kind: 'agent', name: 'Agent' },
          black: { kind: 'human', name: 'Human' },
        },
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    const invitation = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((result) => result.json());
    const joinUrl = new URL(invitation.joinPath, address.httpUrl).toString();
    const joined = await runClient(hostedClientPath, ['join', '--join-url', joinUrl], emptyCwd);
    sessionDirectory = dirname(joined.message.clientPath);
    await runClient(joined.message.clientPath, ['turn', '--match', created.matchId], emptyCwd);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const status = await runClient(
      joined.message.clientPath,
      ['status', '--match', created.matchId],
      emptyCwd,
    );
    assert.equal(status.message.match, 'failed');
    assert.equal(status.message.error, 'AGENT_DECISION_TIMEOUT');
    assert.equal(status.message.nextAction, 'read_result');
  } finally {
    await server.stop();
    if (sessionDirectory) await rm(sessionDirectory, { recursive: true, force: true });
    await rm(emptyCwd, { recursive: true, force: true });
  }
});

test('legacy WebSocket mode still recovers from invalid local move', async () => {
  const server = createAgentChessServer();
  const address = await server.start(0);
  const emptyCwd = await mkdtemp(join(tmpdir(), 'agent-chess-play-'));
  let child;
  let output;
  try {
    const created = await createAgentVsHuman(address);
    const sessionResponse = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.capabilities.white}` },
    });
    assert.equal(sessionResponse.status, 201);
    const session = await sessionResponse.json();
    const joinUrl = new URL(session.joinPath, address.httpUrl).toString();

    child = spawn(process.execPath, [hostedClientPath, '--join-url', joinUrl], {
      cwd: emptyCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    output = jsonLines(child.stdout);

    const startup = await Promise.race([
      output.next((message) => (
        (message.type === 'connector.status' && message.state === 'online')
        || (message.type === 'connector.error' && message.recoverable === false)
      )),
      once(child, 'exit').then(([code]) => {
        throw new Error(`connector exited ${code}: ${Buffer.concat(stderr).toString()}`);
      }),
    ]);
    assert.deepEqual(startup, { type: 'connector.status', state: 'online' });
    const connectedMatch = await fetch(`${address.httpUrl}/api/matches/${created.matchId}`).then((response) => response.json());
    assert.ok(connectedMatch.activity.some((entry) => entry.type === 'agent.connect'));
    const turn = await output.next((message) => message.type === 'turn.start');
    const legal = await output.next((message) => message.type === 'moves.list_all.result');
    assert.ok(legal.moves.some((move) => move.uci === 'e2e4'));
    child.stdin.write(`${JSON.stringify({
      probeSquare: 'e2',
      trace: { source: 'private_reasoning' },
    })}\n`);
    const invalidTrace = await output.next((message) => message.type === 'connector.error');
    assert.equal(invalidTrace.code, 'INVALID_TRACE_SOURCE');

    child.stdin.write(`${JSON.stringify({
      moveUci: 'e2e5',
      trace: { phase: 'choose', summary: 'Testing a rejected local candidate.' },
    })}\n`);
    const rejected = await output.next((message) => message.type === 'connector.error');
    assert.deepEqual(
      { code: rejected.code, recoverable: rejected.recoverable, turnId: rejected.turnId },
      { code: 'MOVE_NOT_LEGAL', recoverable: true, turnId: turn.turnId }
    );
    assert.equal(child.exitCode, null);

    child.stdin.write(`${JSON.stringify({
      moveUci: 'e2e4',
      trace: {
        source: 'agent_reported',
        phase: 'choose',
        summary: 'Claims central space.',
        candidates: [{ uci: 'e2e4', note: 'Space and development.' }],
        selectedMove: 'e2e4',
      },
    })}\n`);
    const accepted = await output.next((message) => message.type === 'move.accepted');
    assert.equal(accepted.moveUci, 'e2e4');

    const resigned = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/resign`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.capabilities.black}` },
    });
    assert.equal(resigned.status, 202);
    const ended = await output.next((message) => message.type === 'game.end');
    assert.equal(ended.status, 'completed');
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    const disconnectedMatch = await fetch(`${address.httpUrl}/api/matches/${created.matchId}`).then((response) => response.json());
    assert.equal(disconnectedMatch.activity.at(-1).type, 'agent.disconnect');
    assert.equal(Buffer.concat(stderr).toString().includes(joinUrl), false);
  } finally {
    output?.close();
    if (child?.exitCode === null) child.kill('SIGTERM');
    await server.stop();
    await rm(emptyCwd, { recursive: true, force: true });
  }
});

test('hosted connector exits cleanly after a failed game terminal event', async () => {
  const server = createAgentChessServer();
  const address = await server.start(0);
  const emptyCwd = await mkdtemp(join(tmpdir(), 'agent-chess-failed-play-'));
  let child;
  let output;
  try {
    const response = await fetch(`${address.httpUrl}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'exhibition',
        visibility: 'public',
        decisionDeadlineMs: 80,
        seats: {
          white: { kind: 'agent', name: 'Agent' },
          black: { kind: 'human', name: 'Human' },
        },
      }),
    });
    const created = await response.json();
    const session = await fetch(`${address.httpUrl}/api/agent-sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.capabilities.white}` },
    }).then((result) => result.json());
    const joinUrl = new URL(session.joinPath, address.httpUrl).toString();
    child = spawn(process.execPath, [hostedClientPath, '--join-url', joinUrl], {
      cwd: emptyCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    output = jsonLines(child.stdout);
    await output.next((message) => message.type === 'turn.start');
    await output.next((message) => message.type === 'game.end' && message.status === 'failed');
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.doesNotMatch(Buffer.concat(stderr).toString(), /InvalidAccessError|invalid code/);
  } finally {
    output?.close();
    if (child?.exitCode === null) child.kill('SIGTERM');
    await server.stop();
    await rm(emptyCwd, { recursive: true, force: true });
  }
});
