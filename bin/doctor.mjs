import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import packageJson from '../package.json' with { type: 'json' };

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const dependencyEntrypoints = {
  '@modelcontextprotocol/sdk': '@modelcontextprotocol/sdk/server/mcp.js',
};

async function readNpmVersion() {
  try {
    const { stdout } = await execFileAsync('npm', ['--version'], { timeout: 5_000 });
    return stdout.trim();
  } catch {
    return 'not found';
  }
}

function isPortAvailable(port) {
  return new Promise((resolvePort) => {
    const probe = createServer();
    probe.once('error', (error) => resolvePort({ available: false, error }));
    probe.listen(port, '127.0.0.1', () => {
      probe.close((error) => resolvePort(error ? { available: false, error } : { available: true }));
    });
  });
}

function isInstalled(dependency) {
  try {
    require.resolve(dependencyEntrypoints[dependency] ?? dependency);
    return true;
  } catch {
    return false;
  }
}

export async function inspectLaunch({
  nodeVersion = process.version,
  npmVersion,
  dependencies = Object.keys(packageJson.dependencies),
  port = 3000,
  probePort = isPortAvailable,
} = {}) {
  const lines = [];
  const detectedNpmVersion = npmVersion ?? await readNpmVersion();
  const nodeMajor = Number.parseInt(nodeVersion.replace(/^v/, '').split('.')[0], 10);
  const nodeOk = nodeMajor === 22;
  lines.push(nodeOk
    ? `PASS Node.js: ${nodeVersion} (major 22)`
    : `FAIL Node.js: ${nodeVersion} (requires major 22)`);

  const npmMajor = Number.parseInt(detectedNpmVersion.split('.')[0], 10);
  const npmOk = npmMajor >= 10;
  lines.push(npmOk
    ? `PASS npm: ${detectedNpmVersion} (major ${npmMajor})`
    : detectedNpmVersion === 'not found'
      ? 'FAIL npm: not found'
      : `FAIL npm: ${detectedNpmVersion} (requires major 10 or later)`);

  const missingDependencies = dependencies.filter((dependency) => !isInstalled(dependency));
  const dependenciesOk = missingDependencies.length === 0;
  lines.push(dependenciesOk
    ? `PASS dependencies: ${dependencies.join(', ')}`
    : `FAIL dependencies: missing ${missingDependencies.join(', ')}`);

  const portResult = await probePort(port);
  const portStatus = portResult.available
    ? 'PASS'
    : portResult.error?.code === 'EADDRINUSE'
      ? 'FAIL'
      : 'SKIP';
  const portMessage = portStatus === 'PASS'
    ? 'available'
    : portStatus === 'FAIL'
      ? 'in use'
      : `cannot check (${portResult.error?.code ?? 'unknown error'})`;
  lines.push(`${portStatus} port ${port}: ${portMessage}`);

  const ok = nodeOk && npmOk && dependenciesOk && portStatus !== 'FAIL';
  lines.push(`${ok ? 'PASS' : 'FAIL'} launch diagnostics`);
  return { ok, output: `${lines.join('\n')}\n` };
}

async function main() {
  const result = await inspectLaunch();
  process.stdout.write(result.output);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
