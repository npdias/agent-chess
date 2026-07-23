import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAgentChessServer } from '../src/server.js';

class FakeEngine {
  async evaluate() { return { type: 'cp', value: 12, perspective: 'white' }; }
  async bestMove(fen) {
    const chess = new Chess(fen);
    const move = chess.moves({ verbose: true })[0];
    return `${move.from}${move.to}${move.promotion ?? ''}`;
  }
  close() {}
}

async function createMatch(address, agentColor, options = {}) {
  const response = await fetch(`${address.httpUrl}/api/matches`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'exhibition', visibility: 'public',
      ...options,
      seats: {
        white: agentColor === 'white' ? { kind: 'agent', name: 'REST White' } : { kind: 'engine', name: 'Engine' },
        black: agentColor === 'black' ? { kind: 'agent', name: 'MCP Black' } : { kind: 'engine', name: 'Engine' },
      },
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function mintInvite(address, capability) {
  const response = await fetch(`${address.httpUrl}/api/agent-connections`, {
    method: 'POST', headers: { authorization: `Bearer ${capability}` },
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function publicRecords(address, matchId) {
  const snapshot = await fetch(`${address.httpUrl}/api/matches/${matchId}`).then((response) => response.json());
  const exported = await fetch(`${address.httpUrl}/api/matches/${matchId}/export`).then((response) => response.json());
  return { snapshot, exported };
}

async function waitForAgentTurn(read, previousTurnId) {
  const deadline = Date.now() + 3_000;
  let last;
  while (Date.now() < deadline) {
    const joined = await read();
    last = joined;
    if (joined.turn && joined.turn.turnId !== previousTurnId) return joined.turn;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`agent turn timeout: ${JSON.stringify(last)}`);
}

function toolResult(result) {
  assert.equal(result.isError, undefined);
  return result.structuredContent ?? JSON.parse(result.content.find((entry) => entry.type === 'text').text);
}

test('REST White and MCP Black survive multiple turns without leaking invitation or session secrets', async () => {
  const server = createAgentChessServer({ stockfishFactory: async () => new FakeEngine() });
  const address = await server.start(0);
  let mcpTransport;
  try {
    const restMatch = await createMatch(address, 'white');
    const restInvite = await mintInvite(address, restMatch.capabilities.white);
    const restClaim = await fetch(restInvite.connection.rest.claimUrl, { method: 'POST' });
    assert.equal(restClaim.status, 201);
    const { sessionToken: restToken } = await restClaim.json();
    const restAuth = { authorization: `Bearer ${restToken}`, 'content-type': 'application/json' };
    const readRest = () => fetch(`${address.httpUrl}/api/agent/match`, { headers: restAuth }).then((response) => response.json());
    let restTurn = (await readRest()).turn;

    for (let moveNumber = 0; moveNumber < 2; moveNumber += 1) {
      const legal = await fetch(`${address.httpUrl}/api/agent/legal-moves?turnId=${restTurn.turnId}`, { headers: restAuth }).then((response) => response.json());
      const moveUci = legal.moves[0].uci;
      const decision = await fetch(`${address.httpUrl}/api/agent/decision`, {
        method: 'POST', headers: restAuth,
        body: JSON.stringify({ turnId: restTurn.turnId, source: 'agent_reported', phase: 'choose', summary: `REST selects turn ${moveNumber + 1}.`, selectedMove: moveUci, confidence: 0.75, elapsedMs: 25 }),
      });
      assert.equal(decision.status, 202);
      const submitted = await fetch(`${address.httpUrl}/api/agent/move`, { method: 'POST', headers: restAuth, body: JSON.stringify({ turnId: restTurn.turnId, moveUci }) });
      assert.equal(submitted.status, 202);
      if (moveNumber === 0) {
        const replay = await fetch(`${address.httpUrl}/api/agent/move`, { method: 'POST', headers: restAuth, body: JSON.stringify({ turnId: restTurn.turnId, moveUci }) }).then((response) => response.json());
        assert.equal(replay.replayed, true);
      }
      if (moveNumber === 0) restTurn = await waitForAgentTurn(readRest, restTurn.turnId);
    }
    assert.equal((await fetch(`${address.httpUrl}/api/agent/result`, { headers: restAuth }).then((response) => response.json())).status, 'active');

    const mcpMatch = await createMatch(address, 'black');
    const mcpInvite = await mintInvite(address, mcpMatch.capabilities.black);
    const client = new Client({ name: 'agent-access-e2e', version: '1.0.0' });
    mcpTransport = new StreamableHTTPClientTransport(new URL(`/mcp?ticket=${encodeURIComponent(mcpInvite.ticket)}`, address.httpUrl));
    await client.connect(mcpTransport);
    let mcpTurn = toolResult(await client.callTool({ name: 'join_match', arguments: {} })).turn;

    for (let moveNumber = 0; moveNumber < 2; moveNumber += 1) {
      const legal = toolResult(await client.callTool({ name: 'list_legal_moves', arguments: { turnId: mcpTurn.turnId } }));
      const moveUci = legal.moves[0].uci;
      assert.equal(toolResult(await client.callTool({ name: 'publish_status', arguments: { turnId: mcpTurn.turnId, source: 'agent_reported', phase: 'probe', summary: `MCP scans turn ${moveNumber + 1}.` } })).accepted, true);
      assert.equal(toolResult(await client.callTool({ name: 'publish_decision', arguments: { turnId: mcpTurn.turnId, source: 'agent_reported', phase: 'choose', summary: `MCP selects turn ${moveNumber + 1}.`, selectedMove: moveUci, confidence: 0.8, elapsedMs: 25 } })).accepted, true);
      const submitted = toolResult(await client.callTool({ name: 'submit_move', arguments: { turnId: mcpTurn.turnId, moveUci } }));
      assert.equal(submitted.accepted, true);
      if (moveNumber === 0) assert.equal(toolResult(await client.callTool({ name: 'submit_move', arguments: { turnId: mcpTurn.turnId, moveUci } })).replayed, true);
      if (moveNumber === 0) {
        const next = await client.callTool({ name: 'await_turn', arguments: { after: mcpTurn.turnId, waitMs: 1_000 } });
        mcpTurn = toolResult(next).turn;
        assert.ok(mcpTurn);
      }
    }
    assert.equal(toolResult(await client.callTool({ name: 'get_result', arguments: {} })).status, 'active');

    for (const [match, invite, sessionToken, minimumTraces] of [[restMatch, restInvite, restToken, 2], [mcpMatch, mcpInvite, null, 4]]) {
      const records = await publicRecords(address, match.matchId);
      const publicJson = JSON.stringify(records);
      assert.equal(publicJson.includes(invite.ticket), false);
      if (sessionToken) assert.equal(publicJson.includes(sessionToken), false);
      assert.equal(publicJson.includes(match.capabilities.white), false);
      assert.equal(publicJson.includes(match.capabilities.black), false);
      assert.ok(records.snapshot.activity.filter((entry) => entry.type === 'agent.trace' || entry.type === 'agent.decision').length >= minimumTraces);
    }

    const terminalMatch = await createMatch(address, 'white', { decisionDeadlineMs: 10 });
    const terminalInvite = await mintInvite(address, terminalMatch.capabilities.white);
    const { sessionToken: terminalToken } = await fetch(terminalInvite.connection.rest.claimUrl, { method: 'POST' }).then((response) => response.json());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const terminal = await fetch(`${address.httpUrl}/api/agent/result`, { headers: { authorization: `Bearer ${terminalToken}` } }).then((response) => response.json());
    assert.equal(terminal.status, 'failed');
  } finally {
    await mcpTransport?.terminateSession().catch(() => undefined);
    await server.stop();
  }
});
