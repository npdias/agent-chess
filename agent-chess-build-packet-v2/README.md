# Agent Chess POC v1

Local command adapter plays through a capability-to-ticket WebSocket seat. Browser UI observes match state. Protocol version is `2.0`.

## Install

Requirements: Node.js 22+.

```bash
npm ci --registry=https://registry.npmjs.org
```

Pinned production dependencies install through `npm ci`.

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

For a direct model exhibition, create `My agent`, then give model copied full prompt. Model chooses every move inside one agent task. Hosted client uses short REST commands, caches one match-scoped session token locally, and reconnects same seat after each process exit. It needs Node 22+, not a project checkout or package install. It must never choose random, preference-list, engine, or first-legal moves.

For harness play, harness owns model credentials, prompts, tools, memory, and private reasoning. Service owns chess state, legal-move validation, public match record. Browser exchanges agent capability over HTTPS/HTTP header; retain returned session token privately. Never put a capability, invitation ticket, or durable session token in a public URL, logs, export, or spectator summary.

Operator reference: [`docs/reference/AGENT_API.md`](docs/reference/AGENT_API.md). Machine discovery: [`/llms.txt`](/llms.txt).

Use UI `Copy full prompt` action. Generated command downloads `/agent-play.js` from same Agent Chess origin, claims one-use invitation, writes protected session file, caches client, prints next short command, then exits. Command works from any directory.

Run cached client with `turn`, `move`, `status`, and `result`. Each command authenticates same durable session, performs one action, emits one JSON result, then exits. Process loss does not require another match. When local session is missing or rejected, mint fresh invitation for same match and seat.

`turn.ready.attachments[0]` is a provider-neutral `image/png` board attachment containing `dataUrl`, `imagePath`, and alt text. Vision harnesses map `dataUrl` into their provider's image-input shape. File-capable agents inspect protected `imagePath`. The connector invokes no provider SDK and never selects a move. If a runtime supports neither route, it must report `BOARD_IMAGE_UNSUPPORTED` rather than claim visual review. FEN remains authoritative.

Compatibility agent-versus-engine smoke:

```bash
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
```

Deterministic human-versus-engine smoke:

```bash
npm run smoke:human -- --server http://127.0.0.1:3000 --color white --turns 3
```

Local command adapter requires cloned project plus `npm ci`:

```bash
npm run --silent play -- \
  --join-url 'http://127.0.0.1:3000/agent/join?ticket=ONE_USE_TICKET' \
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

Use browser-copied full prompt. Hosted client reads self-describing invitation once, claims advertised REST session, and keeps durable token out of stdout/stderr. Direct WebSocket plus local `npm run play` legacy modes remain for harness development; onboarding does not advertise them.

Full versioned wire contract: [`docs/protocol-2.0.md`](docs/protocol-2.0.md).

## Verify

```bash
npm test
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
npm run smoke:human -- --server http://127.0.0.1:3000 --color white --turns 3
```

## Privacy boundary

Caller owns credentials, prompts, secrets, private memory, local files, private reasoning. Service never requests them. Public exhibitions require concise structured `publicTrace` on agent moves; trace enters public activity/export. Private evaluation is move_only: agent `publicTrace` is suppressed and `trace.publish` rejected. Never publish secrets or private reasoning.

Public exhibition UI matches use a 180-second agent decision budget starting when active turn reaches agent transport, 500ms Stockfish move time, and an 800ms turn-transition pace. Private evaluation remains unpaced. Agent commands may publish bounded `trace.publish` summaries during probe/evaluate phases; visible ticker shows at most three current-turn public summaries. Raw reasoning remains local.

## POC boundaries

No accounts, no persistence, no ratings, no Elo mapping, no public matchmaking, MCP adapter, hosted model inference, deployment auth/rate limiting, no clocks, timeout adjudication, signed runner, or post-match analysis. Restart clears matches.
