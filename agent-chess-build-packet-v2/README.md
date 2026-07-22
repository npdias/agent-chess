# Agent Chess POC v1

Local command adapter plays through a capability-to-ticket WebSocket seat. Browser UI observes match state. Protocol version is `2.0`.

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

Docker uses same local service:

```bash
docker build -t agent-chess-poc .
docker run --rm -p 3000:3000 agent-chess-poc
```

## Human exhibitions

Open `http://127.0.0.1:3000`, select `Computer` or `My agent`, select White, Black, or Random, then create an unrated exhibition. Human moves use the browser-held seat capability; spectators opening `/?match=MATCH_ID` can observe public state but cannot make human moves.

For a local agent exhibition, create `My agent`, then copy connector command shown only in creating browser. Local runner owns model credentials, prompts, tools, memory, private reasoning. Service owns chess state, legal-move validation, public match record. Exchange agent capability over HTTPS/HTTP header for short-lived ticket before WebSocket connection; never put raw capability in a WebSocket URL.

```bash
npm run connect -- --server http://127.0.0.1:3000 --seat YOUR_AGENT_CAPABILITY --command "node examples/simple-agent.js"
```

Compatibility agent-versus-engine smoke:

```bash
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
```

Deterministic human-versus-engine smoke:

```bash
npm run smoke:human -- --server http://127.0.0.1:3000 --color white --turns 3
```

```bash
npm run connect -- \
  --server http://127.0.0.1:3000 \
  --seat YOUR_AGENT_CAPABILITY \
  --demo
```

Command adapter:

```bash
npm run connect -- \
  --server http://127.0.0.1:3000 \
  --seat YOUR_AGENT_CAPABILITY \
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

Exchange agent capability at `POST /api/agent-sessions`, then connect returned one-use WebSocket ticket path. Do not place raw capability in WebSocket URL.

Full versioned wire contract: [`docs/protocol-2.0.md`](docs/protocol-2.0.md).

## Verify

```bash
npm test
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
npm run smoke:human -- --server http://127.0.0.1:3000 --color white --turns 3
```

## Privacy boundary

Caller owns credentials, prompts, secrets, private memory, local files, private reasoning. Service never requests them. Public exhibitions require concise structured `publicTrace` on agent moves; trace enters public activity/export. Private evaluation is move_only: agent `publicTrace` is suppressed and `trace.publish` rejected. Never publish secrets or private reasoning.

## POC boundaries

No accounts, no persistence, no ratings, no Elo mapping, no public matchmaking, MCP adapter, hosted model inference, deployment auth/rate limiting, no clocks, timeout adjudication, signed runner, or post-match analysis. Restart clears matches.
