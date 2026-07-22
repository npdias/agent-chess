#!/usr/bin/env node
import { StockfishEngine } from '../src/stockfish.js';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const turn = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const write = process.stdout.write.bind(process.stdout);
const log = console.log;
process.stdout.write = () => true;
console.log = () => {};
const engine = await StockfishEngine.start({ skillLevel: 20, movetimeMs: 1200 });
try {
  const moveUci = await engine.bestMove(turn.fen);
  if (!turn.legalMoves.some((move) => move.uci === moveUci)) {
    throw new Error(`ENGINE_RETURNED_ILLEGAL_MOVE: ${moveUci}`);
  }
  write(JSON.stringify({
    moveUci,
    trace: {
      phase: 'engine',
      summary: 'Local Stockfish selected a legal move after 1200 ms analysis.',
    },
  }));
} finally {
  engine.close();
  process.stdout.write = write;
  console.log = log;
}
