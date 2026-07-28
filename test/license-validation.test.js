import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('license verifier validates every preserved runtime license', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-licenses.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /License verification passed\./);
});
