#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const turn = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const legalMoves = turn.legalMoves.map(({ uci, san }) => ({ uci, san }));
const prompt = `You are a chess-playing agent. Select one move from legalMoves for this position.\n\nPosition FEN: ${turn.fen}\nMoves played: ${(turn.movesUci ?? []).join(' ') || '(start)'}\nYour color: ${turn.agentColor}\nOptional guidance: ${turn.steering?.guidance ?? '(none)'}\nLegal moves: ${JSON.stringify(legalMoves)}\n\nDo not use tools. Return exactly JSON: {"moveUci":"legal UCI move","summary":"one short public chess reason"}.`;
const dir = await mkdtemp(join(tmpdir(), 'agent-chess-gpt-'));
const output = join(dir, 'response.txt');

try {
  const child = spawn('codex', [
    'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
    '--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="low"',
    '--output-last-message', output, prompt,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error(`CODEX_AGENT_FAILED: ${stderr.trim()}`);

  const result = JSON.parse(await readFile(output, 'utf8'));
  if (!legalMoves.some((move) => move.uci === result.moveUci)) {
    throw new Error(`CODEX_RETURNED_ILLEGAL_MOVE: ${result.moveUci}`);
  }
  process.stdout.write(JSON.stringify({
    moveUci: result.moveUci,
    trace: { phase: 'gpt-5.6', summary: String(result.summary ?? 'Selected a legal move.').slice(0, 280) },
  }));
} finally {
  await rm(dir, { recursive: true, force: true });
}
