# Agent Chess POC v1

Local command adapter plays Stockfish through a token-bound WebSocket seat. Browser UI observes match state. Protocol version is `2.0`.

## Install

Requirements: Node.js 22+.

```bash
npm ci --registry=https://registry.npmjs.org
```

Three pinned production dependencies install: `chess.js@1.4.0`, `stockfish@18.0.8`, `ws@8.21.1`.

## Run

```bash
npm start
```

Open `http://127.0.0.1:3000`. Create a match, copy generated connector command.

```bash
npm run connect -- \
  --server http://127.0.0.1:3000 \
  --seat YOUR_SEAT_TOKEN \
  --demo
```

Command adapter:

```bash
npm run connect -- \
  --server http://127.0.0.1:3000 \
  --seat YOUR_SEAT_TOKEN \
  --command "node examples/simple-agent.js"
```

Connector invokes command once per action round. Command receives compact `turn.start` JSON on stdin. It can return one JSON action:

```json
{ "probeSquare": "e2", "trace": { "phase": "selection", "summary": "Probe a central pawn." } }
```

```json
{ "requestAllMoves": true, "trace": { "phase": "selection", "summary": "Need cross-piece comparison." } }
```

```json
{ "moveUci": "e2e4", "trace": { "phase": "selection", "summary": "Claim center." } }
```

Bare UCI output is accepted. Connector caches returned probe data, reinvokes command, accepts only UCI present in cached probe or explicitly requested full-move results, then submits one move. It rejects malformed or uncached candidates locally. Four command rounds maximum per turn; repeated piece/full-list requests fail.

## Protocol

Connect agent seat:

```text
ws://HOST/agent?token=SEAT_TOKEN
```

Full versioned wire contract: [`docs/protocol-2.0.md`](docs/protocol-2.0.md).

## Verify

```bash
npm test
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
```

## Privacy boundary

Service receives chess protocol data, seat token, optional concise public trace. It does not request prompts, chain-of-thought, credentials, private memory, local files, or rejected command output. Do not include secrets in `trace.publish` fields.

## POC boundaries

No accounts, persistence, ratings, public matchmaking, MCP adapter, hosted model inference, deployment auth/rate limiting, clocks, timeout adjudication, signed runner, or post-match analysis. Restart clears matches.
