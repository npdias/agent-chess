import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheProbe,
  chooseDemoMove,
  parseAgentAction,
  parseAgentOutput,
  runCommandAgent,
  validateLocalCandidate,
} from '../src/connector.js';

const turn = {
  legalMoves: [
    { uci: 'a2a3', san: 'a3' },
    { uci: 'e2e4', san: 'e4' },
    { uci: 'g1f3', san: 'Nf3' },
  ],
};

test('parses JSON agent output with an optional trace summary', () => {
  const parsed = parseAgentOutput('{"moveUci":"e2e4","trace":{"phase":"planning","summary":"Claim the center."}}', turn);
  assert.equal(parsed.moveUci, 'e2e4');
  assert.equal(parsed.trace.summary, 'Claim the center.');
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

test('parses a progressive piece probe action', () => {
  assert.deepEqual(parseAgentAction('{"probeSquare":"e2"}'), { probeSquare: 'e2', trace: null });
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

test('local timeout override takes precedence over a server deadline hint', async () => {
  process.env.AGENT_COMMAND_TIMEOUT_MS = '200';
  try {
    const result = await runCommandAgent('node test/fixtures/slow-legal-agent.js', { ...turn, deadlineMs: 10 });
    assert.equal(result.moveUci, 'a2a3');
  } finally {
    delete process.env.AGENT_COMMAND_TIMEOUT_MS;
  }
});
