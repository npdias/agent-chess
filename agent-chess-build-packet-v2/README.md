# Agent Chess MVP

A board-first proof for connecting a locally running agent to a hosted chess match against Stockfish.

## What works

- Standard chess state and rules through `chess.js`
- Stockfish 18 Lite WASM opponent
- FEN board state and full UCI move history
- Current protocol sends the complete legal-move list; protocol 2.0 is specified to use compact movable-piece summaries with on-demand move probes
- Strict server-side move validation
- WebSocket agent seat
- Browser observer UI with board, moves, connection state, steering, and opt-in trace summaries
- Match-time steering rules: `locked` or `trainer`
- Generic command adapter: JSON turn on stdin, JSON/UCI move on stdout
- PGN generation

The prototype stores matches in memory. Restarting the server clears them.

## Run

Requirements: Node.js 22+.

```bash
npm install
npm start
```

Open `http://127.0.0.1:3000`, create a match, and copy the generated seat token.

### Connect the included demo agent

```bash
npm run connect -- \
  --server http://127.0.0.1:3000 \
  --seat YOUR_SEAT_TOKEN \
  --demo
```

### Connect a command-line harness

```bash
npm run connect -- \
  --server http://127.0.0.1:3000 \
  --seat YOUR_SEAT_TOKEN \
  --command "node examples/simple-agent.js"
```

The command is invoked once per agent turn. It receives one JSON object on stdin:

```json
{
  "type": "turn.start",
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "movesUci": [],
  "legalMoves": [
    { "uci": "e2e4", "san": "e4", "from": "e2", "to": "e4", "promotion": null }
  ],
  "steering": { "mode": "trainer", "guidance": "Control the center." }
}
```

It writes either a bare legal UCI move:

```text
e2e4
```

or JSON:

```json
{
  "moveUci": "e2e4",
  "trace": {
    "phase": "planning",
    "summary": "Claim the center and open lines for the bishop and queen."
  }
}
```

`trace` is optional and explicitly published. Private reasoning, prompts, credentials, and local files never enter the match service.

## Smoke test

With the server running:

```bash
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
```

This creates a real Stockfish match, connects an external agent seat, submits three agent moves, and verifies that the server reached at least five plies.

## Test

```bash
npm test
```

## WebSocket protocol

Connect to:

```text
ws://HOST/agent?token=SEAT_TOKEN
```

Server messages:

- `match.start`
- `turn.start`
- `opponent.move`
- `move.accepted`
- `move.rejected`
- `game.end`

Client messages:

```json
{ "type": "move.submit", "turnId": "...", "moveUci": "e2e4" }
```

Optional public trace summary:

```json
{ "type": "trace.publish", "phase": "planning", "summary": "Develop before attacking." }
```

## Current boundaries

Not implemented yet:

- Accounts or registered agent identities
- Persistent storage
- Elo benchmark suites
- Private agent-vs-agent lobbies
- Clocks and timeout adjudication
- Signed downloadable runner
- Codex/Hermes-specific adapters or MCP surface
- Deployment authentication/rate limiting
- Post-match engine analysis

The current slice proves the critical contract: an external local agent can inspect a standardized position, select from legal moves, and complete turns against a controlled Stockfish opponent.

The next protocol revision is specified in [`docs/superpowers/specs/2026-07-21-agent-chess-progressive-agent-interface.md`](docs/superpowers/specs/2026-07-21-agent-chess-progressive-agent-interface.md). It replaces the default full legal-move dump with a compact list of movable pieces plus on-demand piece-level move lookup and candidate validation.

## Local Codex build handoff

Start with [`CODEX_KICKOFF.md`](CODEX_KICKOFF.md). The full build packet is under [`docs/handoff/`](docs/handoff/).
