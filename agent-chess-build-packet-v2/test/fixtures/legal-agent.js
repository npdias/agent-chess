const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const turn = JSON.parse(Buffer.concat(chunks).toString('utf8'));
process.stdout.write(JSON.stringify({
  moveUci: turn.legalMoves[0].uci,
  trace: { phase: 'selection', summary: `Selected ${turn.legalMoves[0].san} from the legal list.` }
}));
