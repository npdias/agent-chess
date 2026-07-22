# Protocol 2.0 Progressive Turn Interface — Implementation Plan

> Execute sequentially. Each task must end green before the next begins.

## Goal

Replace the protocol `1.0` full legal-move dump with a compact protocol `2.0` turn snapshot and turn-scoped on-demand probes, without breaking the existing playable Stockfish match.

## Task 1 — Lock protocol types and compatibility boundary

Files:

- Modify: `src/protocol.js`
- Test: `test/protocol.test.js`

Deliverables:

- Protocol version constant `2.0`
- Message-type constants or validators for:
  - `turn.start`
  - `moves.list`
  - `moves.list.result`
  - `moves.list_all`
  - `moves.list_all.result`
  - `history.list`
  - `history.list.result`
  - `move.validate`
  - `move.validate.result`
  - `move.submit`
- Stable rejection codes:
  - `STALE_TURN`
  - `INVALID_SQUARE`
  - `PIECE_NOT_MOVABLE`
  - `INVALID_MOVE_FORMAT`
  - `MOVE_NOT_LEGAL`

Tests:

- Reject missing/unknown message types.
- Reject probe requests without `turnId`.
- Accept canonical requests.

## Task 2 — Build compact turn snapshots in the chess domain

Files:

- Modify: `src/game.js`
- Test: `test/game.test.js`

Add focused functions:

```js
getRecentMoves(limitPlies = 12)
getMovablePieces()
getMovesForSquare(square)
getCheckingPieces()
buildTurnSnapshot({ gameId, turnId, agentColor, steering, deadline, recentMoveWindowPlies = 12 })
```

Required behavior:

- `getMovablePieces()` groups authoritative verbose legal moves by `from`.
- Each piece entry contains `square`, `piece`, and `color` only.
- `buildTurnSnapshot()` does not contain `legalMoves` or `movesUci` full history.
- `recentMoves` contains up to 12 trailing plies with `ply`, `color`, `uci`, `san`.
- `agentColor` and `sideToMove` are explicit.
- `positionStatus.inCheck` is correct.
- `checkingPieces` is present only when deterministically computed; an empty list is valid when not in check.

Tests:

- Starting position exposes ten movable white pieces, not twenty moves.
- A blocked friendly piece is absent.
- A checked position exposes only pieces that can participate in legal check responses.
- Recent history truncates to the configured number of plies.
- Reconstructing from FEN remains valid.

## Task 3 — Add match-level probe operations

Files:

- Modify: `src/match.js`
- Test: `test/match.test.js`

Add methods:

```js
listMovesForPiece({ turnId, square })
listAllMoves({ turnId })
listHistory({ turnId, beforePly, limit })
validateCandidate({ turnId, moveUci })
```

Rules:

- Every operation validates active `turnId`.
- `listMovesForPiece` rejects squares absent from current `movablePieces`.
- `listAllMoves` returns the current authoritative verbose legal list.
- `listHistory` is read-only and paginated.
- `validateCandidate` does not alter the game.
- Final `submitMove` remains independently authoritative.

Tests:

- Legal piece probe returns only that piece’s moves.
- Stale turn rejected after a move changes state.
- Candidate validation does not consume the turn.
- Legal candidate validates; illegal candidate returns stable reason.
- Full list still available on request.

## Task 4 — Wire WebSocket request/response messages

Files:

- Modify: `src/server.js`
- Test: `test/server.test.js`

Implement handlers for:

- `moves.list`
- `moves.list_all`
- `history.list`
- Optional remote `move.validate`

Requirements:

- Responses include `turnId`.
- Errors use stable codes.
- One client cannot query another match or turn.
- `turn.start` now sends the compact snapshot.
- Existing move submission, opponent response, trace publishing, and game-end events remain working.

Tests:

- End-to-end WebSocket probe flow.
- Stale-turn probe rejection.
- Default `turn.start` lacks full legal move list.
- Submitted legal move still triggers Stockfish reply and next turn.

## Task 5 — Add local runner cache and CLI probes

Files:

- Modify: `src/connector.js`
- Modify: `bin/connect-agent.js`
- Test: `test/connector.test.js`

Runner responsibilities:

- Cache current `turn.start` by `turnId`.
- Cache piece-level probe results.
- Validate UCI format locally.
- Validate candidate against cached moves when available.
- Request the relevant piece move list when needed.

CLI or internal commands:

```text
turn
pieces
moves <square>
validate <uci>
move <uci>
history [limit]
```

For the existing one-shot command adapter, provide helper data or an adapter API that lets a harness request probes without receiving the full move list by default. Do not silently re-expand every turn before invoking the command, since that defeats the context goal.

Tests:

- Compact snapshot reaches command adapter.
- Piece probe can be requested.
- Local validation rejects malformed or known-illegal moves before server submission.
- Validated move submits once.

## Task 6 — Update included example agent

Files:

- Modify: `examples/simple-agent.js`
- Test: `test/connector.test.js` or new focused test

Behavior:

- Read compact snapshot.
- Choose one movable piece.
- Request or consume that piece’s legal moves through the supported adapter mechanism.
- Return one UCI move.
- Publish only a concise optional trace summary.

The example may choose randomly; chess strength is not part of this milestone.

## Task 7 — Update observer UI minimally

Files:

- Modify: `public/app.js`
- Modify: `public/index.html` only if required
- Modify: `public/styles.css` only if required
- Test: `test/ui.test.js`

Show:

- Agent color
- Side to move
- In-check status
- Recent-move window
- Movable-piece squares
- Existing board, move history, steering, and trace sections

Do not redesign the theme.

## Task 8 — Documentation and migration notes

Files:

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-21-agent-chess-progressive-agent-interface.md` status
- Create: `docs/protocol-2.0.md`

Document:

- Exact JSON schemas and examples
- v1-to-v2 breaking changes
- CLI/harness usage
- Privacy behavior
- Local validation versus server authority

Mark spec implemented only after all acceptance tests pass.

## Task 9 — Full verification

Run:

```bash
npm test
npm audit --audit-level=high
npm start
```

In a second shell:

```bash
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
```

Required evidence:

- All tests pass.
- Audit reports zero high/critical vulnerabilities.
- Two consecutive real Stockfish smoke matches pass in the same server process.
- Default turn payload contains no full legal-move list.
- Piece probe and candidate validation are demonstrated in logs or tests.
