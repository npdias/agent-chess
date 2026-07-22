import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('GPT chess agent requests low reasoning effort', async () => {
  const source = await readFile(new URL('../examples/gpt-5.6-agent.js', import.meta.url), 'utf8');
  assert.match(source, /'-c', 'model_reasoning_effort="low"'/);
});

test('GPT chess agent consumes cached probes and keeps full move expansion opt-in', async () => {
  const source = await readFile(new URL('../examples/gpt-5.6-agent.js', import.meta.url), 'utf8');
  assert.match(source, /probeResults/);
  assert.match(source, /requestAllMoves/);
  assert.doesNotMatch(source, /turn\.legalMoves/);
});
