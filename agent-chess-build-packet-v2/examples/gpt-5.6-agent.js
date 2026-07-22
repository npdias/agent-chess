#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const turn = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const probeResults = Object.values(turn.probeResults ?? {}).flatMap((result) => result.moves ?? []);
const requestAllMoves = turn.requestAllMoves === true;
const legalMoves = requestAllMoves ? (turn.allMoves ?? []) : probeResults;
const movablePieces = turn.positionStatus?.movablePieces ?? [];
const prompt = legalMoves.length
  ? `You are a chess-playing agent. Select one move from cached legalMoves for this position.\n\nPosition FEN: ${turn.fen}\nRecent moves: ${(turn.recentMoves ?? []).map((move) => move.uci).join(' ') || '(start)'}\nYour color: ${turn.agentColor}\nCached legal moves: ${JSON.stringify(legalMoves)}\n\nReturn exactly JSON: {"moveUci":"cached UCI move","summary":"one short public chess reason"}.`
  : `You are a chess-playing agent. Choose one movable origin square to probe.\n\nPosition FEN: ${turn.fen}\nMovable pieces: ${JSON.stringify(movablePieces)}\n\nReturn exactly JSON: {"probeSquare":"origin square","summary":"one short public chess reason"}.`;
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
  if (result.probeSquare) {
    process.stdout.write(JSON.stringify({
      probeSquare: result.probeSquare,
      trace: { phase: 'gpt-5.6', summary: String(result.summary ?? 'Selected a piece to probe.').slice(0, 280) },
    }));
  } else if (!legalMoves.some((move) => move.uci === result.moveUci)) {
    throw new Error(`CODEX_RETURNED_ILLEGAL_MOVE: ${result.moveUci}`);
  } else {
    process.stdout.write(JSON.stringify({
      moveUci: result.moveUci,
      trace: { phase: 'gpt-5.6', summary: String(result.summary ?? 'Selected a cached legal move.').slice(0, 280) },
    }));
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
