# Agent Chess — Codex Build Kickoff

You are taking over an existing Node.js prototype in this repository. Do not restart from scratch.

## Mission

Implement the next working slice of Agent Chess: protocol `2.0` progressive turn snapshots and on-demand chess probes, while preserving the existing playable agent-vs-Stockfish flow.

A locally running agent must be able to connect through the existing runner, receive a compact but self-sufficient turn snapshot, inspect moves for selected pieces, validate a candidate locally, and submit one legal move. The hosted service remains the authoritative chess arbiter. User prompts, API keys, private reasoning, and harness internals remain local.

## Read first

1. `README.md`
2. `docs/superpowers/specs/2026-07-21-agent-chess-progressive-agent-interface.md`
3. `docs/handoff/BUILD_BRIEF.md`
4. `docs/handoff/IMPLEMENTATION_PLAN.md`
5. `docs/handoff/ACCEPTANCE_TESTS.md`
6. Existing implementation and tests under `src/`, `bin/`, and `test/`

## Current state

The prototype already proves:

- `chess.js` authoritative rules and PGN
- Stockfish 18 Lite WASM opponent
- WebSocket agent seat
- Browser observer board
- Strict server-side move validation
- Generic command adapter
- Locked/trainer steering modes
- Current protocol `1.0` sends the full legal-move list on every turn

Do not regress those behaviors.

## Target slice

Implement protocol `2.0`:

- `turn.start` includes:
  - FEN
  - agent color
  - side to move
  - current ply
  - last 12 plies with actor color, UCI, and SAN
  - check status
  - checking pieces when deterministically available
  - compact list of friendly pieces that have at least one legal move
  - steering state
  - deadline when enabled
- Full legal destinations are omitted from the default snapshot.
- Add turn-scoped probes:
  - `moves.list`
  - `moves.list_all`
  - `history.list`
- Add local candidate validation in the connector.
- Preserve authoritative server validation at `move.submit`.
- Update the sample command adapter and README.
- Add tests proving payload compactness, probe correctness, stale-turn rejection, check behavior, and unchanged Stockfish play.

## Hard boundaries

Do not add in this slice:

- Accounts
- Persistent DB
- Registered-agent identities
- Elo calculation
- PvP lobbies
- Public matchmaking
- UI redesign
- Post-match engine analysis
- Hosted LLM inference
- API-key handling
- MCP adapter unless the CLI implementation is fully complete and tested first

## Engineering rules

- Work test-first.
- Keep `chess.js` as the single legality source.
- Derive movable pieces by grouping the authoritative legal move set by origin square.
- Never calculate movable pieces through a second independent rules path.
- Scope every probe and submission to the active `turnId`.
- Do not expose chain-of-thought. `trace.publish` remains optional, concise, and user-controlled.
- Preserve Node.js 22+ and the current dependency footprint unless a change is justified in the plan.
- Run the full suite and the real Stockfish smoke test before claiming completion.

## Start command

```bash
npm install
npm test
```

Then execute `docs/handoff/IMPLEMENTATION_PLAN.md` task-by-task.

## Completion evidence

Return:

1. Changed-file summary
2. Protocol examples
3. Full test output
4. Real Stockfish smoke-test output
5. Remaining known gaps
6. Commit SHA
