import { spawn } from 'node:child_process';

export function chooseDemoMove(turn) {
  const preference = ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'e7e5', 'd7d5', 'g8f6', 'c7c5'];
  const legal = new Set(turn.legalMoves.map((move) => move.uci));
  return preference.find((move) => legal.has(move)) ?? turn.legalMoves[0]?.uci ?? null;
}

export function parseAgentOutput(stdout, turn) {
  const text = String(stdout ?? '').trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { moveUci: text };
  }

  const moveUci = parsed.moveUci ?? parsed.move ?? parsed.uci;
  const legal = new Set(turn.legalMoves.map((move) => move.uci));
  if (!legal.has(moveUci)) throw new Error(`ILLEGAL_AGENT_OUTPUT: ${moveUci}`);

  let trace = null;
  if (parsed.trace?.summary) {
    trace = {
      phase: String(parsed.trace.phase ?? 'thinking').slice(0, 40),
      summary: String(parsed.trace.summary).slice(0, 1000),
    };
  }
  return { moveUci, trace };
}

export function runCommandAgent(command, turn, { timeoutMs = Number(process.env.AGENT_COMMAND_TIMEOUT_MS ?? turn.deadlineMs ?? 30_000) } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('AGENT_COMMAND_TIMEOUT'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`AGENT_COMMAND_FAILED(${code}): ${Buffer.concat(stderr).toString('utf8').trim()}`));
        return;
      }
      try {
        resolve(parseAgentOutput(Buffer.concat(stdout).toString('utf8'), turn));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(`${JSON.stringify(turn)}\n`);
  });
}
