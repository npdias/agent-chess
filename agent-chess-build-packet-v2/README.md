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

Open `http://127.0.0.1:3000`. Create a match, then copy `Copy full prompt` for remote model handoff or `Copy link only` for an existing harness. Invitation links are secret, single-use, and expire after three minutes.

Docker uses same local service:

```bash
docker build -t agent-chess-poc .
docker run --rm -p 3000:3000 agent-chess-poc
```

## Human exhibitions

Open `http://127.0.0.1:3000`, select `Computer` or `My agent`, select White, Black, or Random, then create an unrated exhibition. Human moves use the browser-held seat capability; spectators opening `/?match=MATCH_ID` can observe public state but cannot make human moves.

For a direct model exhibition, create `My agent`, then give model copied full prompt. Model chooses every move. Hosted MCP is preferred; durable REST is fallback; WebSocket CLI remains compatibility fallback. Transport/harness code may fetch turns, validate req/res, reconnect, and submit model-selected moves. It must never choose random, preference-list, engine, or first-legal moves.

For harness play, harness owns model credentials, prompts, tools, memory, and private reasoning. Service owns chess state, legal-move validation, public match record. Browser exchanges agent capability over HTTPS/HTTP header; retain returned session token privately. Never put a capability, invitation ticket, or durable session token in a public URL, logs, export, or spectator summary.

Operator reference: [`docs/reference/AGENT_API.md`](docs/reference/AGENT_API.md). Machine discovery: [`/llms.txt`](/llms.txt).

```bash
npm run connect -- --server http://127.0.0.1:3000 --path '/agent?ticket=ONE_USE_TICKET' --command "node examples/simple-agent.js"
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

Use either `--seat CAPABILITY` to exchange at `POST /api/agent-sessions`, or browser-copied `--path /agent?ticket=...` to connect an already-exchanged one-use ticket. Do not combine them or place raw capability in a WebSocket URL.

Full versioned wire contract: [`docs/protocol-2.0.md`](docs/protocol-2.0.md).

## Verify

```bash
npm test
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
npm run smoke:human -- --server http://127.0.0.1:3000 --color white --turns 3
```

## Privacy boundary

Caller owns credentials, prompts, secrets, private memory, local files, private reasoning. Service never requests them. Public exhibitions require concise structured `publicTrace` on agent moves; trace enters public activity/export. Private evaluation is move_only: agent `publicTrace` is suppressed and `trace.publish` rejected. Never publish secrets or private reasoning.

Public exhibition UI matches use a 90-second agent decision budget, 500ms Stockfish move time, and an 800ms turn-transition pace. Private evaluation remains unpaced. Agent commands may publish bounded `trace.publish` summaries during probe/evaluate phases; the visible ticker shows at most three current-turn public summaries. Raw reasoning remains local.

## POC boundaries

No accounts, no persistence, no ratings, no Elo mapping, no public matchmaking, MCP adapter, hosted model inference, deployment auth/rate limiting, no clocks, timeout adjudication, signed runner, or post-match analysis. Restart clears matches.
