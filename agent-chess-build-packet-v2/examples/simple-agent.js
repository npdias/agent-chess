#!/usr/bin/env node
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const turn = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const preferences = ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'e7e5', 'd7d5', 'g8f6', 'c7c5'];
const legal = new Set(turn.legalMoves.map((move) => move.uci));
const moveUci = preferences.find((move) => legal.has(move)) ?? turn.legalMoves[0].uci;

process.stdout.write(JSON.stringify({
  moveUci,
  trace: {
    phase: 'selection',
    summary: `Selected ${moveUci} from ${turn.legalMoves.length} legal moves.`,
  },
}));
