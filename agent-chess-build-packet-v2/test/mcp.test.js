import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAgentChessServer } from '../src/server.js';

async function createMatch(address) {
  const response = await fetch(`${address.httpUrl}/api/matches`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'exhibition', visibility: 'public',
      seats: {
        white: { kind: 'agent', name: 'MCP Agent' },
        black: { kind: 'human', name: 'Human' },
      },
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function invite(address, capability) {
  const response = await fetch(`${address.httpUrl}/api/agent-connections`, {
    method: 'POST', headers: { authorization: `Bearer ${capability}` },
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function connect(address, ticket) {
  const client = new Client({ name: 'mcp-integration-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`/mcp?ticket=${encodeURIComponent(ticket)}`, address.httpUrl));
  await client.connect(transport);
  return { client, transport };
}

function content(result) {
  assert.equal(result.isError, undefined);
  const text = result.content.find((entry) => entry.type === 'text')?.text;
  assert.ok(text);
  return JSON.parse(text);
}

function rawMcpPost(address, ticket, headers, body) {
  const target = new URL(address.httpUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: target.hostname, port: target.port, method: 'POST', path: `/mcp?ticket=${encodeURIComponent(ticket)}`, headers }, (response) => {
      response.resume();
      response.once('end', () => resolve(response));
    });
    request.once('error', reject);
    request.end(body);
  });
}

test('MCP invitation claims once, exposes deterministic tools, and delegates a public move flow', async () => {
  const server = createAgentChessServer();
  const address = await server.start(0);
  let transport;
  try {
    const created = await createMatch(address);
    const connection = await invite(address, created.capabilities.white);
    const connected = await connect(address, connection.ticket);
    transport = connected.transport;

    const listed = await connected.client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      'join_match', 'await_turn', 'list_legal_moves', 'publish_status',
      'publish_decision', 'submit_move', 'get_result',
    ]);

    const joined = content(await connected.client.callTool({ name: 'join_match', arguments: {} }));
    assert.equal(joined.color, 'white');
    const turn = joined.turn;
    assert.ok(turn.turnId);
    assert.equal(JSON.stringify(joined).includes('sessionToken'), false);

    const waited = content(await connected.client.callTool({ name: 'await_turn', arguments: { after: 'old-turn', waitMs: 0 } }));
    assert.equal(waited.timeout, false);
    assert.equal(waited.turn.turnId, turn.turnId);

    const legal = content(await connected.client.callTool({ name: 'list_legal_moves', arguments: { turnId: turn.turnId } }));
    assert.ok(legal.moves.some((move) => move.uci === 'e2e4'));

    const status = content(await connected.client.callTool({ name: 'publish_status', arguments: {
      turnId: turn.turnId, source: 'agent_reported', phase: 'probe', summary: 'Checking forcing moves.',
    } }));
    assert.equal(status.publicTrace.summary, 'Checking forcing moves.');
    const publicState = await fetch(`${address.httpUrl}/api/matches/${created.matchId}`).then((response) => response.json());
    const published = publicState.activity.find((entry) => entry.type === 'agent.trace' && entry.summary === 'Checking forcing moves.');
    assert.deepEqual(published, {
      type: 'agent.trace', source: 'agent_reported', actor: 'connector', kind: 'status', phase: 'probe',
      turnId: turn.turnId, summary: 'Checking forcing moves.', candidates: [], selectedMove: null, at: published.at,
    });
    assert.equal(JSON.stringify(published).includes('reasoning'), false);

    const decision = content(await connected.client.callTool({ name: 'publish_decision', arguments: {
      turnId: turn.turnId, source: 'agent_reported', phase: 'choose', summary: 'Develops king side safely.',
      candidates: [{ uci: 'e2e4', note: 'Claims center.' }], selectedMove: 'e2e4', confidence: 0.8, elapsedMs: 1_500,
    } }));
    assert.equal(decision.accepted, true);
    assert.equal(decision.publicTrace.confidence, 0.8);
    assert.equal(decision.publicTrace.elapsedMs, 1_500);

    const submitted = content(await connected.client.callTool({ name: 'submit_move', arguments: { turnId: turn.turnId, moveUci: 'e2e4' } }));
    assert.equal(submitted.accepted, true);
    assert.equal(submitted.moveUci, 'e2e4');
    assert.equal(JSON.stringify(submitted).includes('sessionToken'), false);

    const result = content(await connected.client.callTool({ name: 'get_result', arguments: {} }));
    assert.equal(result.status, 'active');
    await assert.rejects(connect(address, connection.ticket), /4\d\d|INVITATION|session/i);
  } finally {
    await transport?.terminateSession().catch(() => undefined);
    await server.stop();
  }
});

test('MCP rejects expired invitation tickets', async () => {
  let now = 1_000;
  const server = createAgentChessServer({ ticketNow: () => now });
  const address = await server.start(0);
  try {
    const created = await createMatch(address);
    const connection = await invite(address, created.capabilities.white);
    now = 181_001;
    await assert.rejects(connect(address, connection.ticket), /4\d\d|INVITATION|session/i);
  } finally {
    await server.stop();
  }
});

test('agent connection advertises hosted MCP endpoint and rejects foreign origins even when Host matches', async () => {
  const server = createAgentChessServer();
  const address = await server.start(0);
  try {
    const created = await createMatch(address);
    const connection = await invite(address, created.capabilities.white);
    assert.match(connection.connection.mcp.url, /\/mcp\?ticket=/);
    const rejected = await rawMcpPost(address, connection.ticket, { origin: 'https://attacker.example', host: 'attacker.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }));
    assert.equal(rejected.statusCode, 403);
    const nonHttpTicket = await invite(address, created.capabilities.white);
    const nonHttp = await rawMcpPost(address, nonHttpTicket.ticket, { origin: 'ftp://localhost', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }));
    assert.equal(nonHttp.statusCode, 403);
  } finally {
    await server.stop();
  }
});

test('MCP accepts only exact configured public origin', async () => {
  const original = process.env.AGENT_CHESS_PUBLIC_ORIGIN;
  process.env.AGENT_CHESS_PUBLIC_ORIGIN = 'https://agent-chess.example';
  const server = createAgentChessServer();
  const address = await server.start(0);
  const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  try {
    const created = await createMatch(address);
    const acceptedTicket = await invite(address, created.capabilities.white);
    const accepted = await fetch(`${address.httpUrl}/mcp?ticket=${encodeURIComponent(acceptedTicket.ticket)}`, {
      method: 'POST', headers: { origin: 'https://agent-chess.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: initialize,
    });
    assert.notEqual(accepted.status, 403);
    const rejectedTicket = await invite(address, created.capabilities.white);
    const rejected = await fetch(`${address.httpUrl}/mcp?ticket=${encodeURIComponent(rejectedTicket.ticket)}`, {
      method: 'POST', headers: { origin: 'http://agent-chess.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: initialize,
    });
    assert.equal(rejected.status, 403);
  } finally {
    if (original === undefined) delete process.env.AGENT_CHESS_PUBLIC_ORIGIN;
    else process.env.AGENT_CHESS_PUBLIC_ORIGIN = original;
    await server.stop();
  }
});
