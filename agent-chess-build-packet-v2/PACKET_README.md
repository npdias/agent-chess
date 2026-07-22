# Agent Chess Build Packet v2

This packet contains the latest working Agent Chess prototype, the agreed product/protocol specifications, Codex kickoff instructions, implementation plans, acceptance tests, and UI references.

## Start here

1. Read `CODEX_KICKOFF.md`.
2. Read `docs/superpowers/specs/2026-07-21-agent-chess-progressive-agent-interface.md`.
3. Run the existing verification suite before editing:

```bash
npm ci
npm test
```

4. Start the app:

```bash
npm start
```

5. Open `http://127.0.0.1:3000`.

## Current implementation

The code already includes:

- `chess.js` board state, legal-move validation, FEN, SAN, and PGN
- Stockfish 18 Lite WASM opponent through a queued worker
- HTTP match creation and observation
- WebSocket agent-seat transport
- Local command adapter and demo agent
- Steering modes and structured agent trace summaries
- Board-first live-match UI
- Post-match summary/replay UI
- Automated tests and real-engine smoke tooling

## Next protocol milestone

Implement protocol 2.0 progressive disclosure without regressing the current playable loop:

- Each turn provides a self-contained compact snapshot:
  - canonical FEN
  - agent color and side to move
  - last configured N plies, including mover color, UCI, and SAN
  - check status
  - legally movable friendly pieces
  - steering state and deadline
- Agents can probe legal destinations for one piece.
- Agents can optionally request all legal moves or older history.
- Agents can validate a candidate locally before submission.
- The server remains the final authority.

## Important scope boundary

Do not mix protocol 2.0 work with accounts, Elo, persistence, public matchmaking, or visual-theme refinement. Preserve the existing working prototype first.
