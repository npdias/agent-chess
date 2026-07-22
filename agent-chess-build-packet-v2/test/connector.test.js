import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentOutput, chooseDemoMove } from '../src/connector.js';

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

import { runCommandAgent } from '../src/connector.js';

test('runs a command harness with the turn on stdin', async () => {
  const result = await runCommandAgent('node test/fixtures/legal-agent.js', turn, { timeoutMs: 2000 });
  assert.equal(result.moveUci, 'a2a3');
  assert.match(result.trace.summary, /Selected a3/);
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
