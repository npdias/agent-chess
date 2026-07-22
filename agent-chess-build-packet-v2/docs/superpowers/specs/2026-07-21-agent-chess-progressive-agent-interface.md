# Agent Chess Progressive Agent Interface Specification

**Status:** Implementation in progress; Task 8 final acceptance pending
**Protocol:** `2.0`
**Scope:** Agent-facing chess-state and move-selection interface

Implemented wire details live in [`../../protocol-2.0.md`](../../protocol-2.0.md). This document remains design/acceptance intent. Do not mark this interface implemented until Task 8 automated acceptance passes.

## 1. Objective

Minimize the context sent to an LLM or agent on every turn while preserving complete, deterministic access to all legal actions.

The interface uses progressive disclosure:

1. The turn begins with a self-sufficient planning snapshot.
2. The snapshot identifies the current position, the agent's color, the side to move, recent move history, check state, and legally movable pieces.
3. The agent requests legal moves for a selected piece only when it needs destination-level detail.
4. The agent may validate a candidate move locally.
5. The server independently validates the submitted move.

The benchmark therefore measures chess planning and move selection without requiring the agent to implement chess legality internally or consume a large legal-move dump every turn.

## 2. Authoritative chess formats

- **FEN** is the authoritative current-position snapshot.
- **UCI coordinate notation** is the canonical move identifier.
- **PGN** is the completed-game archive format.
- **SAN** may be returned as an optional human-readable label.
- `chess.js` remains the authoritative rules and legal-move engine.

## 3. Self-sufficient turn snapshot

Every `turn.start` message must contain enough information for an agent to understand the current game state and begin planning without an immediate follow-up request. It must not include the complete legal move list by default.

```json
{
  "type": "turn.start",
  "protocolVersion": "2.0",
  "gameId": "game_01K...",
  "turnId": "turn_01K...",
  "variant": "standard",
  "agentColor": "white",
  "sideToMove": "white",
  "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
  "ply": 4,
  "recentMoves": [
    { "ply": 1, "color": "white", "uci": "e2e4", "san": "e4" },
    { "ply": 2, "color": "black", "uci": "e7e5", "san": "e5" },
    { "ply": 3, "color": "white", "uci": "g1f3", "san": "Nf3" },
    { "ply": 4, "color": "black", "uci": "b8c6", "san": "Nc6" }
  ],
  "positionStatus": {
    "inCheck": false,
    "movablePieces": [
      { "square": "a2", "piece": "pawn" },
      { "square": "b1", "piece": "knight" },
      { "square": "d2", "piece": "pawn" },
      { "square": "f1", "piece": "bishop" },
      { "square": "f3", "piece": "knight" }
    ]
  },
  "steering": {
    "mode": "locked",
    "guidance": null
  },
  "deadline": 30000
}
```

### Snapshot invariant

The snapshot must be sufficient for initial planning:

- `fen` gives the complete current board state.
- `agentColor` affirms which side the connected agent controls.
- `sideToMove` explicitly confirms whose turn it is.
- `recentMoves` gives the latest configured move window and identifies who made each move.
- `positionStatus.inCheck` communicates the immediate king-safety constraint.
- `positionStatus.movablePieces` identifies every friendly piece with at least one legal move.
- Piece-level probes provide destination-level details only when requested.

### Required fields

- `fen`: complete six-field FEN and canonical board-state snapshot.
- `agentColor`: side permanently controlled by the connected agent for this game.
- `sideToMove`: side whose turn is currently active; it must equal `agentColor` in a `turn.start` message sent to that agent.
- `ply`: total number of half-moves already played.
- `recentMoves`: ordered trailing window of moves ending at the current position.
- `positionStatus.inCheck`: whether the agent's king is currently checked.
- `positionStatus.movablePieces`: only friendly pieces with at least one legal move.
- `steering`: immutable match steering mode plus any queued guidance.
- `deadline`: connector timeout hint in milliseconds, default `30000`. Current POC has no clocks or server-enforced deadline.

### Recent-move window

The number of recent moves is controlled by the versioned match profile:

```json
{
  "recentMoveWindowPlies": 12
}
```

Rules:

- The value is measured in plies, not full moves.
- Current POC emits up to 12 trailing plies.
- `recentMoves` contains up to that many trailing plies, fewer only near game start.
- Each entry includes `ply`, `color`, `uci`, and `san`.
- The final entry must reproduce the move immediately preceding the current position.
- Full move history remains available through an explicit history probe when needed.

A default of `12` plies is recommended for the first benchmark profile. This exposes the latest six full moves without repeatedly sending the entire game.

### Movable-piece representation

Each entry contains:

```json
{ "square": "f3", "piece": "knight" }
```

The list is derived from the authoritative legal move set by grouping moves by origin square. It must never be calculated independently from the legal-move generator.

### Optional local presentation aids

The local runner may derive an ASCII or Unicode board from `fen` for models that interpret text boards more reliably:

```json
{
  "boardAscii": "8  r . b q k b n r\n7  p p p p . p p p\n6  . . n . . . . .\n5  . . . . p . . .\n4  . . . . P . . .\n3  . . . . . N . .\n2  P P P P . P P P\n1  R N B Q K B . R\n   a b c d e f g h"
}
```

This is a local rendering aid, not additional authoritative state and not required on the network.

## 4. Piece-level move probe

The agent requests legal moves for one movable piece.

### Request

```json
{
  "type": "moves.list",
  "turnId": "turn_01K...",
  "square": "f3"
}
```

### Response

```json
{
  "type": "moves.list.result",
  "turnId": "turn_01K...",
  "square": "f3",
  "piece": "knight",
  "moves": [
    { "uci": "f3e5", "san": "Nxe5", "from": "f3", "to": "e5", "promotion": null },
    { "uci": "f3g5", "san": "Ng5", "from": "f3", "to": "g5", "promotion": null }
  ]
}
```

### Rules

- The requested square must appear in `movablePieces` for the active turn.
- Results are scoped to `turnId`.
- A stale request is rejected.
- An active movable origin returns its legal moves. Stale turn or state change rejects request.

## 5. Optional move-history expansion

An agent may request more history when the configured recent-move window is insufficient for planning, repetition analysis, or opening recognition.

### Request

```json
{
  "type": "history.list",
  "turnId": "turn_01K...",
  "beforePly": 25,
  "limit": 24
}
```

### Response

```json
{
  "type": "history.list.result",
  "turnId": "turn_01K...",
  "moves": [
    { "ply": 1, "color": "white", "uci": "e2e4", "san": "e4" },
    { "ply": 2, "color": "black", "uci": "e7e5", "san": "e5" }
  ],
  "hasMore": false
}
```

History requests are scoped to the active game and do not alter the board state.

## 6. Optional complete legal-move expansion

Advanced harnesses may request the full set explicitly:

```json
{
  "type": "moves.list_all",
  "turnId": "turn_01K..."
}
```

This operation exists for compatibility and debugging. It is not the default prompt input for basic LLM adapters.

## 7. Candidate validation

The local runner must expose candidate validation before final submission.

### Request

```json
{
  "type": "move.validate",
  "turnId": "turn_01K...",
  "moveUci": "f3e5"
}
```

### Valid response

```json
{
  "type": "move.validate.result",
  "turnId": "turn_01K...",
  "moveUci": "f3e5",
  "legal": true,
  "san": "Nxe5"
}
```

### Invalid response

```json
{
  "type": "move.validate.result",
  "turnId": "turn_01K...",
  "moveUci": "f3f5",
  "legal": false,
  "reason": "MOVE_NOT_LEGAL"
}
```

Validation should normally happen inside the local runner from its cached authoritative turn state. It must not send rejected candidate moves or private reasoning to the hosted service unless the harness explicitly uses a remote protocol operation.

## 8. Move submission

```json
{
  "type": "move.submit",
  "turnId": "turn_01K...",
  "moveUci": "f3e5"
}
```

The server independently confirms that:

- `turnId` is active.
- The move is well-formed UCI notation.
- The move is in the authoritative legal move set.
- No move has already been accepted for the turn.

Local validation improves usability but is never trusted as the arbiter.

## 9. Check communication

When king is in check, compact payload remains same shape:

```json
{
  "positionStatus": {
    "inCheck": true,
    "movablePieces": [
      { "square": "e1", "piece": "king" },
      { "square": "c2", "piece": "pawn" }
    ]
  }
}
```

Current POC does not send `checkingPieces`.

The service does not initially enumerate every immobile piece or explain why it cannot move. That representation is noisy and requires extra pseudo-legal analysis. The actionable information is:

- the king is in check;
- the checking piece or pieces, when cheaply available;
- the short list of pieces that can legally respond;
- legal responses available through piece-level probes.

## 10. Local tool surface

Future runner may expose same functions through CLI/MCP. Current POC provides only `npm run connect` command adapter plus WebSocket protocol:

```text
chess_get_position
chess_list_movable_pieces
chess_list_moves_for_piece
chess_get_move_history
chess_list_all_legal_moves
chess_validate_move
chess_submit_move
```

### Intended basic-agent loop

1. Receive `turn.start`.
2. Review `fen`, `agentColor`, `sideToMove`, `recentMoves`, check state, and `movablePieces`.
3. Request older history only when the recent window is insufficient.
4. Probe one or more promising pieces for destination-level legal moves.
5. Choose a move.
6. Validate it.
7. Submit it.

## 11. Steering interaction

Steering remains a match rule:

- `locked`: no user guidance after match start; required for benchmark-rated games.
- `trainer`: guidance may be queued for the next turn; private and unrated.

Guidance must not change chess legality. It is local agent context layered onto the same compact turn state.

## 11. Metrics

Future benchmark service may record:

- number of piece probes per turn;
- whether the full legal list was requested;
- first candidate legal rate;
- local validation retries;
- final submission legality;
- total turn latency.

Prompt contents, rejected free-text candidates, and private reasoning remain local.

## 12. Compatibility

Protocol `1.0` sends the complete `legalMoves` array with every turn.

Protocol `2.0` uses compact turn payloads and on-demand probes.

Current POC supports protocol `2.0` only:

```text
protocol 2.0 → cache legal set internally; expose progressive tools
```

Protocol `1.0` clients relying on default `legalMoves` are incompatible.

## 13. Acceptance criteria

The progressive interface is complete when:

1. `turn.start` omits the full legal-move array.
2. Every movable piece appears exactly once.
3. Every omitted friendly piece has zero legal moves.
4. `moves.list` returns exactly the legal moves originating from the requested square.
5. `moves.list_all` reconstructs the same complete legal set as `chess.js`.
6. `move.validate` accepts every legal move and rejects every illegal move for the active turn.
7. The server independently rejects illegal or stale submissions.
8. Check positions expose `inCheck` and only pieces capable of legal responses.
9. Existing games remain exportable as valid PGN.
10. The browser UI can still receive a complete observer snapshot independently of the compact agent payload.
