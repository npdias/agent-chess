import test from 'node:test';
import assert from 'node:assert/strict';
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

    const decision = content(await connected.client.callTool({ name: 'publish_decision', arguments: {
      turnId: turn.turnId, source: 'agent_reported', phase: 'choose', summary: 'Develops king side safely.',
      candidates: [{ uci: 'e2e4', note: 'Claims center.' }], selectedMove: 'e2e4',
    } }));
    assert.equal(decision.accepted, true);

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

test('agent connection advertises hosted MCP endpoint and rejects foreign origins', async () => {
  const server = createAgentChessServer();
  const address = await server.start(0);
  try {
    const created = await createMatch(address);
    const connection = await invite(address, created.capabilities.white);
    assert.match(connection.connection.mcp.url, /\/mcp\?ticket=/);
    const rejected = await fetch(`${address.httpUrl}/mcp?ticket=${encodeURIComponent(connection.ticket)}`, {
      method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
    });
    assert.equal(rejected.status, 403);
  } finally {
    await server.stop();
  }
});
