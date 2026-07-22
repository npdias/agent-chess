#!/usr/bin/env node
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const turn = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const preferences = ['e2', 'd2', 'g1', 'c2', 'e7', 'd7', 'g8', 'c7'];
const cachedMoves = Object.values(turn.probeResults ?? {}).flatMap((result) => result.moves ?? []);
const moveUci = preferences
  .map((square) => cachedMoves.find((move) => move.uci.startsWith(square))?.uci)
  .find(Boolean) ?? cachedMoves[0]?.uci;

if (!moveUci) {
  const movable = new Set((turn.positionStatus?.movablePieces ?? []).map((piece) => piece.square));
  const probeSquare = preferences.find((square) => movable.has(square)) ?? turn.positionStatus?.movablePieces?.[0]?.square;
  if (!probeSquare) throw new Error('NO_MOVABLE_PIECE');
  process.stdout.write(JSON.stringify({ probeSquare, trace: { phase: 'selection', summary: `Probing ${probeSquare}.` } }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  moveUci,
  trace: {
    phase: 'selection',
    summary: `Selected ${moveUci} from ${cachedMoves.length} cached legal moves.`,
  },
}));
