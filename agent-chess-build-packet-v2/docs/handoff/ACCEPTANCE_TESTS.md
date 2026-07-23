# Protocol 2.0 Acceptance Tests

## A. Compact turn snapshot

Given a standard starting game and an agent controlling White, `turn.start` must include:

- `protocolVersion: "2.0"`
- `agentColor: "white"`
- `sideToMove: "white"`
- six-field `fen`
- `ply: 0`
- empty `recentMoves`
- `positionStatus.inCheck: false`
- movable pieces grouped by origin square

It must not include:

- complete `legalMoves`
- complete `movesUci`
- chain-of-thought
- model credentials

## B. Recent move history

After:

```text
1. e4 e5 2. Nf3 Nc6
```

The snapshot must end with:

```json
[
  { "ply": 1, "color": "white", "uci": "e2e4", "san": "e4" },
  { "ply": 2, "color": "black", "uci": "e7e5", "san": "e5" },
  { "ply": 3, "color": "white", "uci": "g1f3", "san": "Nf3" },
  { "ply": 4, "color": "black", "uci": "b8c6", "san": "Nc6" }
]
```

At more than 12 plies, only the trailing 12 are sent by default.

## C. Movable pieces

At the initial position, White’s movable-piece list contains exactly:

```text
a2 b1 b2 c2 d2 e2 f2 g1 g2 h2
```

No destination list is present until probed.

## D. Piece-level probe

Request:

```json
{ "type": "moves.list", "turnId": "active", "square": "e2" }
```

Result includes exactly `e2e3` and `e2e4` in the starting position.

A request for `a1` returns `PIECE_NOT_MOVABLE`.

## E. Check response

Use a deterministic FEN where the side to move is checked.

Verify:

- `positionStatus.inCheck` is `true`.
- `movablePieces` contains only origins represented in the authoritative legal move set.
- Every move returned by any piece probe resolves the check.
- A move that leaves the king in check validates as illegal.

## F. Stale turn safety

After an accepted move:

- Previous `turnId` probes return `STALE_TURN`.
- Previous `turnId` submissions return `STALE_TURN` or the existing equivalent stable code.
- No stale request mutates match state.

## G. Local validation

- Malformed UCI is rejected locally.
- A candidate absent from cached/probed legal moves is rejected locally.
- Local rejection is not uploaded as a submitted move.
- A valid candidate may still be independently rejected by the server if the turn became stale.

## H. Steering

Locked match:

- Snapshot says `mode: "locked"`.
- Guidance cannot be altered after start.

Trainer match:

- Snapshot says `mode: "trainer"`.
- Queued guidance appears on the next turn.
- Guidance content is not required in server logs beyond match delivery behavior.

## I. Stockfish regression

A connected external agent can complete at least three of its turns against real Stockfish. Run this twice against one server process to verify the singleton queued Stockfish worker remains reusable.

## J. Privacy regression

Inspect network messages and server logs. Confirm they contain no:

- API keys
- System prompts
- Private chain-of-thought
- Local file contents
- Agent memory

## K. Hosted agent access E2E

Run:

```bash
node --test --test-concurrency=1 test/agent-access-e2e.test.js
```

Proof covers a REST agent as White plus hosted-MCP agent as Black against fake engines. Each agent completes two turns; REST same-move replay returns `replayed: true`; MCP publishes bounded public status plus decision; snapshot/export omit invitation, durable-session, seat capability secrets. A bounded decision deadline produces authoritative terminal `failed` result read through REST.

During a later active turn, the fixed Agent decision card prefers a current-turn public committed decision. If none exists, it keeps the latest allowed committed decision visible as `Last move · <disclosure source>`, including candidates, selected move, confidence, and elapsed time. It must never relabel that fallback as current thought or render private/unsupported disclosures.

## L. Desktop access proof

At `1280x720`, create Agent vs Computer, mint/connect agent invitation, advance at least two plies, then verify:

- `document.documentElement.scrollHeight <= window.innerHeight`
- board width equals board height
- right rail retains stable dimensions
- connector collapses after connection
- visible state identifies active turn owner

Evidence: `output/ux-validation/agent-access-1280x720.png`.
