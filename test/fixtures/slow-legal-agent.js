const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const turn = JSON.parse(Buffer.concat(chunks).toString('utf8'));
await new Promise((resolve) => setTimeout(resolve, 50));
process.stdout.write(JSON.stringify({ moveUci: turn.legalMoves[0].uci }));
