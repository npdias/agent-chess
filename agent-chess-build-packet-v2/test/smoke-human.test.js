import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chooseHumanMove, parseArgs } from '../bin/smoke-human.js';

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

test('operator docs name runnable smoke commands and privacy boundaries', async () => {
  const [packageJson, readme, protocol] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/protocol-2.0.md', import.meta.url), 'utf8'),
  ]);
  assert.equal(JSON.parse(packageJson).scripts['smoke:human'], 'node bin/smoke-human.js');
  assert.match(readme, /npm run smoke:human -- --server http:\/\/127\.0\.0\.1:3000 --color white --turns 3/);
  for (const text of [readme, protocol]) {
    assert.match(text, /private reasoning/i);
    assert.match(text, /capability/i);
    assert.match(text, /no persistence/i);
    assert.match(text, /no.*(?:ratings|Elo)/i);
    assert.match(text, /no clocks/i);
  }
});
