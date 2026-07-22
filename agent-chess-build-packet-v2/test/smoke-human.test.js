import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { chooseHumanMove, parseArgs, runSmoke } from '../bin/smoke-human.js';

test('human smoke parses only supported command arguments', () => {
  assert.deepEqual(parseArgs([
    '--server', 'http://127.0.0.1:3010', '--color', 'black', '--turns', '3',
  ]), { server: 'http://127.0.0.1:3010', color: 'black', turns: 3 });
  assert.throws(() => parseArgs(['--color', 'green']), /--color/);
});

test('human smoke chooses a deterministic legal move from a snapshot', () => {
  assert.equal(chooseHumanMove({ game: { legalMoves: [
    { uci: 'a2a3' }, { uci: 'e2e4' }, { uci: 'g1f3' },
  ] } }), 'e2e4');
  assert.throws(() => chooseHumanMove({ game: { legalMoves: [] } }), /NO_LEGAL_MOVE/);
});

test('human smoke submits exactly requested human turns', async () => {
  let submissions = 0;
  const responses = [
    { status: 'active', activeTurn: { turnId: 'turn-1', seatKind: 'human', activeColor: 'white' }, game: { legalMoves: [{ uci: 'e2e4' }], ply: 0, result: '*' } },
    { status: 'active', activeTurn: { turnId: 'turn-2', seatKind: 'human', activeColor: 'white' }, game: { legalMoves: [{ uci: 'e2e4' }], ply: 2, result: '*' } },
    { status: 'active', activeTurn: null, game: { legalMoves: [], ply: 3, result: '*' } },
  ];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/api/matches')) return new Response(JSON.stringify({ matchId: 'match-1', capabilities: { white: 'secret' } }), { status: 201 });
    if (url.endsWith('/human-moves')) {
      submissions += 1;
      assert.equal(options.headers.authorization, 'Bearer secret');
      return new Response(JSON.stringify({ accepted: true, moveUci: 'e2e4', moveSan: 'e4' }), { status: 202 });
    }
    return new Response(JSON.stringify(responses.shift()), { status: 200 });
  };
  const result = await runSmoke({ server: 'http://smoke.test', color: 'white', turns: 2 }, fetchImpl);
  assert.equal(submissions, 2);
  assert.equal(result.humanTurns, 2);
});

test('human smoke reports only accepted moves when match ends early', async () => {
  let submissions = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/matches')) return new Response(JSON.stringify({ matchId: 'match-1', capabilities: { white: 'secret' } }), { status: 201 });
    if (url.endsWith('/human-moves')) {
      submissions += 1;
      return new Response(JSON.stringify({ accepted: true, moveUci: 'e2e4', moveSan: 'e4' }), { status: 202 });
    }
    return new Response(JSON.stringify(submissions
      ? { status: 'completed', activeTurn: null, game: { legalMoves: [], ply: 1, result: '1-0' } }
      : { status: 'active', activeTurn: { turnId: 'turn-1', seatKind: 'human', activeColor: 'white' }, game: { legalMoves: [{ uci: 'e2e4' }], ply: 0, result: '*' } }), { status: 200 });
  };
  const result = await runSmoke({ server: 'http://smoke.test', color: 'white', turns: 3 }, fetchImpl);
  assert.equal(submissions, 1);
  assert.equal(result.humanTurns, 1);
});

test('human smoke CLI omits capability from exact public output', async () => {
  const capability = 'capability-sentinel';
  let submitted = false;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    let body = '';
    for await (const chunk of request) body += chunk;
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.method === 'POST' && url.pathname === '/api/matches') return send(201, { matchId: 'match-1', capabilities: { white: capability } });
    if (request.method === 'POST' && url.pathname.endsWith('/human-moves')) {
      assert.equal(request.headers.authorization, `Bearer ${capability}`);
      assert.equal(JSON.parse(body).moveUci, 'e2e4');
      submitted = true;
      return send(202, { accepted: true, moveUci: 'e2e4', moveSan: 'e4' });
    }
    return send(200, submitted
      ? { status: 'active', activeTurn: null, game: { legalMoves: [], ply: 1, result: '*' } }
      : { status: 'active', activeTurn: { turnId: 'turn-1', seatKind: 'human', activeColor: 'white' }, game: { legalMoves: [{ uci: 'e2e4' }], ply: 0, result: '*' } });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const child = spawn(process.execPath, ['bin/smoke-human.js', '--server', `http://127.0.0.1:${port}`, '--color', 'white', '--turns', '1'], { cwd: new URL('..', import.meta.url) });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 0, stderr);
    assert.equal(stdout.includes(capability), false);
    assert.deepEqual(Object.keys(JSON.parse(stdout)), ['matchId', 'plies', 'result', 'status', 'exportUrl']);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('operator docs name runnable smoke commands and privacy boundaries', async () => {
  const [packageJson, readme, protocol] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/protocol-2.0.md', import.meta.url), 'utf8'),
  ]);
  assert.equal(JSON.parse(packageJson).scripts['smoke:human'], 'node bin/smoke-human.js');
  assert.equal(JSON.parse(packageJson).scripts.smoke, 'node bin/smoke-agent.js');
  assert.match(readme, /npm run smoke:human -- --server http:\/\/127\.0\.0\.1:3000 --color white --turns 3/);
  assert.match(protocol, /\{ "ticket", "wsPath", "expiresAt" \}/);
  assert.match(protocol, /\{ "accepted": true, "moveUci", "moveSan" \}/);
  assert.match(protocol, /selectedMove.*match/i);
  assert.match(protocol, /resign.*after start/i);
  assert.match(protocol, /abort.*before ply one/i);
  assert.match(protocol, /legacy.*trace.*optional/i);
  const smokeAgent = await readFile(new URL('../bin/smoke-agent.js', import.meta.url), 'utf8');
  assert.match(smokeAgent, /exchangeAgentSession/);
  assert.match(smokeAgent, /created\.capabilities\.white/);
  assert.match(smokeAgent, /ticket/);
  assert.doesNotMatch(smokeAgent, /seatToken|\{ token:/);
  for (const text of [readme, protocol]) {
    assert.match(text, /private reasoning/i);
    assert.match(text, /capability/i);
    assert.match(text, /no persistence/i);
    assert.match(text, /no.*(?:ratings|Elo)/i);
    assert.match(text, /no clocks/i);
  }
});
