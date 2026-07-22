const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const turn = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const moves = turn.legalMoves ?? Object.values(turn.probeResults ?? {}).flatMap((result) => result.moves ?? []);
process.stdout.write(JSON.stringify({
  moveUci: moves[0].uci,
  trace: { phase: 'selection', summary: `Selected ${moves[0].san} from the legal list.` }
}));
