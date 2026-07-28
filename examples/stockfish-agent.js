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
  const cachedMoves = Object.values(turn.probeResults ?? {}).flatMap((result) => result.moves ?? []);
  if (!cachedMoves.some((move) => move.uci === moveUci)) {
    write(JSON.stringify({
      probeSquare: moveUci.slice(0, 2),
      trace: { phase: 'engine', summary: 'Local Stockfish selected an origin to probe.' },
    }));
  } else {
    write(JSON.stringify({
      moveUci,
      trace: {
        phase: 'engine',
        summary: 'Local Stockfish selected a cached legal move after 1200 ms analysis.',
      },
    }));
  }
} finally {
  engine.close();
  process.stdout.write = write;
  console.log = log;
}
