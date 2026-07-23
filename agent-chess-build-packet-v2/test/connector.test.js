import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheProbe,
  cacheAllMoves,
  chooseDemoAction,
  chooseDemoMove,
  createAgentRequest,
  exchangeAgentSession,
  parseAgentAction,
  parseAgentOutput,
  publicStatusTraceForAction,
  runCommandAgent,
  validateLocalCandidate,
} from '../src/connector.js';
import { parseArgs, toWsUrl } from '../bin/connect-agent.js';

const turn = {
  legalMoves: [
    { uci: 'a2a3', san: 'a3' },
    { uci: 'e2e4', san: 'e4' },
    { uci: 'g1f3', san: 'Nf3' },
  ],
};

test('exchanges seat capability for ticket WebSocket path without exposing it', async () => {
  let request;
  const wsPath = await exchangeAgentSession(async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, json: async () => ({ wsPath: '/agent?ticket=short-lived' }) };
  }, 'http://localhost:3000', 'capability-secret');
  assert.equal(wsPath, '/agent?ticket=short-lived');
  assert.equal(request.url, 'http://localhost:3000/api/agent-sessions');
  assert.equal(request.options.headers.authorization, 'Bearer capability-secret');
});

test('accepts copied browser ticket path without exchanging a seat capability', () => {
  const args = parseArgs(['--server', 'http://localhost:3000', '--path', '/agent?ticket=short-lived', '--demo']);
  assert.deepEqual(args, { server: 'http://localhost:3000', path: '/agent?ticket=short-lived', demo: true });
  assert.equal(toWsUrl(args.server, args.path), 'ws://localhost:3000/agent?ticket=short-lived');
  assert.throws(() => parseArgs(['--server', 'http://localhost:3000', '--seat', 'capability', '--path', '/agent?ticket=short-lived', '--demo']), /exactly one/);
});

test('parses JSON agent output with an optional trace summary', () => {
  const parsed = parseAgentOutput('{"moveUci":"e2e4","trace":{"phase":"planning","summary":"Claim the center."}}', turn);
  assert.equal(parsed.moveUci, 'e2e4');
  assert.equal(parsed.trace.summary, 'Claim the center.');
});

test('preserves bounded structured decision trace fields from command output', () => {
  const parsed = parseAgentOutput(JSON.stringify({
    moveUci: 'e2e4',
    trace: {
      kind: 'decision', phase: 'choose', summary: 'Claim center.',
      candidates: [{ uci: 'e2e4', note: 'Space.' }], selectedMove: 'e2e4',
    },
  }), turn);
  assert.deepEqual(parsed.trace, {
    source: 'agent_reported', kind: 'decision', phase: 'choose', summary: 'Claim center.',
    candidates: [{ uci: 'e2e4', note: 'Space.' }], selectedMove: 'e2e4',
  });
});

test('preserves an allowed command trace source and defaults absent source to agent reported', () => {
  const provider = parseAgentOutput(JSON.stringify({
    moveUci: 'e2e4', trace: { source: 'provider_summary', summary: 'Provider selected center.' },
  }), turn);
  const defaulted = parseAgentOutput('{"moveUci":"e2e4","trace":{"summary":"Selected center."}}', turn);
  assert.equal(provider.trace.source, 'provider_summary');
  assert.equal(defaulted.trace.source, 'agent_reported');
});

test('defaults only absent, null, or empty command trace source to agent reported', () => {
  for (const source of [undefined, null, '']) {
    const trace = { summary: 'Selected center.', ...(source !== undefined ? { source } : {}) };
    const parsed = parseAgentOutput(JSON.stringify({ moveUci: 'e2e4', trace }), turn);
    assert.equal(parsed.trace.source, 'agent_reported');
  }
});

test('rejects an explicit unsupported command trace source', () => {
  assert.throws(() => parseAgentAction(JSON.stringify({
    moveUci: 'e2e4', trace: { source: 'System', summary: 'Selected center.' },
  })), /INVALID_TRACE_SOURCE/);
});

test('rejects an unsupported command trace source when summary is absent', () => {
  assert.throws(() => parseAgentAction(JSON.stringify({
    moveUci: 'e2e4', trace: { source: 'System' },
  })), /INVALID_TRACE_SOURCE/);
});

test('rejects an unsupported command trace source when summary is empty', () => {
  assert.throws(() => parseAgentAction(JSON.stringify({
    moveUci: 'e2e4', trace: { source: 'System', summary: '' },
  })), /INVALID_TRACE_SOURCE/);
});

test('rejects unsupported trace provenance returned by a command before submission', async () => {
  await assert.rejects(
    runCommandAgent('node test/fixtures/invalid-trace-source-agent.js', turn, { timeoutMs: 2000 }),
    /INVALID_TRACE_SOURCE/
  );
});

test('accepts a bare UCI move from a simple command harness', () => {
  assert.deepEqual(parseAgentOutput('g1f3\n', turn), { moveUci: 'g1f3', trace: null });
});

test('rejects command output that is not in the supplied legal set', () => {
  assert.throws(() => parseAgentOutput('{"moveUci":"e2e5"}', turn), /ILLEGAL_AGENT_OUTPUT/);
});

test('demo connector chooses a legal central move when available', () => {
  assert.equal(chooseDemoMove(turn), 'e2e4');
});

test('demo move trace names its selected legal candidate', () => {
  const action = chooseDemoAction({
    probeResults: { e2: { moves: [{ uci: 'e2e4', san: 'e4' }] } },
  });

  assert.deepEqual(action.trace.candidates, [{ uci: 'e2e4', note: 'Demo legal candidate.' }]);
  assert.equal(action.trace.selectedMove, 'e2e4');
  assert.equal(action.trace.source, 'adapter_generated');
});

test('parses a progressive piece probe action', () => {
  assert.deepEqual(parseAgentAction('{"probeSquare":"e2"}'), { probeSquare: 'e2', trace: null });
});

test('parses an explicit full move-list request', () => {
  assert.deepEqual(parseAgentAction('{"requestAllMoves":true}'), { requestAllMoves: true, trace: null });
});

test('publishes bounded agent summaries for probe actions without precommitting candidates', () => {
  assert.deepEqual(publicStatusTraceForAction({
    requestAllMoves: true,
    trace: {
      source: 'agent_reported', kind: 'decision', phase: 'probe',
      summary: 'Comparing forcing moves.',
      candidates: [{ uci: 'e2e4', note: 'Private until commit.' }], selectedMove: 'e2e4',
    },
  }), {
    source: 'agent_reported', kind: 'status', phase: 'probe', summary: 'Comparing forcing moves.',
  });
  assert.equal(publicStatusTraceForAction({ moveUci: 'e2e4', trace: { summary: 'Choose e4.' } }), null);
  assert.equal(publicStatusTraceForAction({ probeSquare: 'e2', trace: null }), null);
});

test('maps explicit full-list action to a turn-scoped outbound request', () => {
  assert.deepEqual(createAgentRequest({ turnId: 'turn-all' }, { requestAllMoves: true }), {
    type: 'moves.list_all', turnId: 'turn-all',
  });
});

test('attaches public trace to submitted move and binds selected move', () => {
  assert.deepEqual(createAgentRequest({ turnId: 'turn-move' }, {
    moveUci: 'e2e4',
    trace: { source: 'agent_reported', phase: 'choose', summary: 'Claim center.', candidates: [{ uci: 'e2e4' }] },
  }), {
    type: 'move.submit', turnId: 'turn-move', moveUci: 'e2e4',
    publicTrace: {
      source: 'agent_reported', phase: 'choose', summary: 'Claim center.', candidates: [{ uci: 'e2e4' }], selectedMove: 'e2e4',
    },
  });
});

test('private_eval move requests suppress public trace attachment', () => {
  assert.deepEqual(createAgentRequest({ turnId: 'private-turn', mode: 'private_eval' }, {
    moveUci: 'e2e4', trace: { summary: 'private reasoning', selectedMove: 'e2e4' },
  }), { type: 'move.submit', turnId: 'private-turn', moveUci: 'e2e4' });
});

test('rejects a malformed or uncached candidate before WebSocket submission', () => {
  assert.throws(() => validateLocalCandidate(turn, 'e2e5'), /MOVE_NOT_LEGAL/);
  assert.throws(() => validateLocalCandidate(turn, 'e2-e4'), /MOVE_NOT_LEGAL/);
});

test('caches a piece probe under its current turn before accepting its move', () => {
  const compactTurn = { turnId: 'turn-1', fen: 'start', probeResults: {} };
  const cached = cacheProbe(compactTurn, {
    turnId: 'turn-1', square: 'e2', moves: [{ uci: 'e2e4', san: 'e4' }],
  });

  assert.equal(validateLocalCandidate(cached, 'e2e4').moveUci, 'e2e4');
  assert.deepEqual(cached.probeResults.e2.moves, [{ uci: 'e2e4', san: 'e4' }]);
});

test('caches explicit full-list results before accepting a full-list candidate', () => {
  const compactTurn = { turnId: 'turn-all', fen: 'start', probeResults: {} };
  const cached = cacheAllMoves(compactTurn, {
    turnId: 'turn-all', moves: [{ uci: 'g1f3', san: 'Nf3' }],
  });

  assert.equal(cached.requestAllMoves, true);
  assert.equal(validateLocalCandidate(cached, 'g1f3').moveUci, 'g1f3');
});

test('runs a command harness with the turn on stdin', async () => {
  const result = await runCommandAgent('node test/fixtures/legal-agent.js', turn, { timeoutMs: 2000 });
  assert.equal(result.moveUci, 'a2a3');
  assert.match(result.trace.summary, /Selected a3/);
});

test('delivers a compact snapshot plus cached probe results to command adapter', async () => {
  const result = await runCommandAgent('node test/fixtures/legal-agent.js', {
    turnId: 'turn-compact',
    fen: 'start',
    probeResults: { e2: { moves: [{ uci: 'e2e4', san: 'e4' }] } },
  }, { timeoutMs: 2000 });
  assert.equal(result.moveUci, 'e2e4');
});

test('delivers cached full-list results to command adapter before a move is selected', async () => {
  const result = await runCommandAgent('node test/fixtures/legal-agent.js', {
    turnId: 'turn-all', fen: 'start', requestAllMoves: true,
    allMoves: [{ uci: 'g1f3', san: 'Nf3' }],
  }, { timeoutMs: 2000 });
  assert.equal(result.moveUci, 'g1f3');
});

test('local timeout override takes precedence over a server deadline hint', async () => {
  process.env.AGENT_COMMAND_TIMEOUT_MS = '200';
  try {
    const result = await runCommandAgent('node test/fixtures/slow-legal-agent.js', { ...turn, deadlineMs: 10 });
    assert.equal(result.moveUci, 'a2a3');
  } finally {
    delete process.env.AGENT_COMMAND_TIMEOUT_MS;
  }
});
