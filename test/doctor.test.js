import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLaunch } from '../bin/doctor.mjs';

test('doctor passes required Node 22, installed app dependencies, available port', async () => {
  const result = await inspectLaunch({
    nodeVersion: 'v22.23.1',
    npmVersion: '10.9.8',
    dependencies: ['chess.js'],
    port: 0,
    probePort: async () => ({ available: true }),
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /PASS Node\.js: v22\.23\.1/);
  assert.match(result.output, /PASS npm: 10\.9\.8/);
  assert.match(result.output, /PASS dependencies: chess\.js/);
  assert.match(result.output, /PASS port 0: available/);
  assert.match(result.output, /PASS launch diagnostics/);
});

test('doctor fails unsupported Node major', async () => {
  const result = await inspectLaunch({
    nodeVersion: 'v21.9.0',
    npmVersion: '10.9.8',
    dependencies: ['chess.js'],
    port: 0,
    probePort: async () => ({ available: true }),
  });

  assert.equal(result.ok, false);
  assert.match(result.output, /FAIL Node\.js: v21\.9\.0 \(requires major 22\)/);
  assert.match(result.output, /FAIL launch diagnostics/);
});

test('doctor fails npm major below 10', async () => {
  const result = await inspectLaunch({
    nodeVersion: 'v22.23.1',
    npmVersion: '9.9.4',
    dependencies: ['chess.js'],
    port: 0,
    probePort: async () => ({ available: true }),
  });

  assert.equal(result.ok, false);
  assert.match(result.output, /FAIL npm: 9\.9\.4 \(requires major 10 or later\)/);
  assert.match(result.output, /FAIL launch diagnostics/);
});

test('doctor reports an occupied port without starting an app server', async () => {
  const result = await inspectLaunch({
    port: 3000,
    probePort: async () => ({ available: false, error: { code: 'EADDRINUSE' } }),
  });

  assert.equal(result.ok, false);
  assert.match(result.output, /FAIL port 3000: in use/);
});

test('doctor skips port result when system blocks an availability probe', async () => {
  const result = await inspectLaunch({
    port: 3000,
    probePort: async () => ({ available: false, error: { code: 'EPERM' } }),
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /SKIP port 3000: cannot check \(EPERM\)/);
});
