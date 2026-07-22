# Agent Chess POC v1 Design

**Status:** Approved design; implementation pending  
**Protocol:** `2.0`  
**Product slice:** Local agent versus Stockfish, observed in browser

## 1. Outcome

POC v1 must prove that a local agent can play repeated legal turns against Stockfish through a compact tool interface while a person can understand match state at a glance.

User experience must answer three questions without opening hidden panels:

1. Whose turn is it?
2. What phase is the agent in?
3. What chess actions is the agent considering or taking?

POC label describes product milestone. Network protocol remains version `2.0`.

## 2. Success criteria

- Board remains square at supported desktop and mobile widths.
- Persistent phase ribbon shows `Observe`, `Probe`, `Evaluate`, `Choose`, and `Submit`.
- Persistent activity rail shows verified system events and optional concise agent decision traces.
- Protocol `2.0` sends compact turn snapshots by default and exposes turn-scoped probes.
- Local connector validates candidate format and known legality before submission.
- Server independently validates every submitted move.
- Included agent completes at least three turns against real Stockfish twice in one server process.
- Match creation, connector copy, connection state, current turn, and failure recovery require no documentation during normal use.
- Clean dependency install works from public npm infrastructure.

## 3. Selected product direction

Use selected **Phase ribbon + activity rail** layout.

- Board owns primary left column and uses fixed `1 / 1` geometry.
- Five-step phase ribbon sits directly above board.
- Agent activity rail remains visible beside board.
- Match creation and connector setup use one clear primary action each.
- Move history, steering, PGN, and secondary details remain available without competing with live state.
- Mobile layout keeps phase ribbon above board and places activity immediately below it.

No broad visual-theme rewrite is required. Existing dark board-first identity remains.

## 4. Turn phases

Phases represent observable work, not hidden model reasoning.

| Phase | Starts when | Visible evidence |
|---|---|---|
| `Observe` | Server sends `turn.start` | Position received, color, side to move, check state, recent moves |
| `Probe` | Agent requests piece moves, full moves, or history | Probe type, square, result count |
| `Evaluate` | Connector starts agent command or agent publishes evaluation status | Agent working, optional ranked candidates and short notes |
| `Choose` | Connector receives a well-formed candidate | Selected UCI move, concise rationale when supplied, local validation result |
| `Submit` | Connector sends `move.submit` | Pending, accepted, rejected, or stale result |

Ribbon must never invent progress. Direct WebSocket clients that omit optional phase events show last verified phase plus `Agent working`.

Completed phases receive subdued checkmarks. Current phase receives strongest contrast. Pending phases remain visible but quiet.

## 5. Decision trace contract

UI exposes a structured decision trace instead of raw chain-of-thought.

Optional agent-published fields:

```json
{
  "type": "trace.publish",
  "turnId": "turn_01K...",
  "kind": "decision",
  "phase": "evaluate",
  "summary": "Comparing central development against immediate space.",
  "candidates": [
    { "uci": "g1f3", "note": "Develops and controls e5." },
    { "uci": "e2e4", "note": "Claims center and opens lines." },
    { "uci": "d2d4", "note": "Claims space with a quieter structure." }
  ],
  "selectedMove": null
}
```

Rules:

- At most three candidates.
- `kind` is `status` for connector-generated phase events or `decision` for optional agent presentation text.
- `summary` is limited to 500 characters; each candidate note is limited to 160 characters.
- Candidate and selected-move UCI strings must be well formed.
- `summary` and candidate notes are concise, user-controlled presentation text.
- Missing trace data is valid.
- Server does not request or store raw chain-of-thought, prompts, credentials, private memory, or local files.
- Deterministic system events and optional agent text are visually distinct.

## 6. Protocol and domain design

`chess.js` remains the only legality source.

Default `turn.start` contains:

- canonical six-field FEN;
- agent color and side to move;
- ply count;
- trailing 12 plies with color, UCI, and SAN;
- check status;
- friendly pieces with at least one authoritative legal move;
- steering state;
- active turn ID;
- ISO 8601 `deadline` when enabled, otherwise `null`.

Default payload omits full legal destinations and complete history.

Turn-scoped operations:

- `moves.list` for one movable piece;
- `moves.list_all` for compatibility and debugging;
- `history.list` for older moves;
- local candidate validation in connector;
- optional remote `move.validate` for clients that need it;
- authoritative `move.submit` on server.

Every probe, validation, and submission checks active `turnId`. State changes invalidate prior turn IDs without mutation.

## 7. Components

### Chess domain

Builds compact snapshots, recent move windows, movable-piece groups, piece probes, check state, validation results, and history pages from one `chess.js` instance.

### Match session

Owns active turn ID, steering state, trace entries, phase events, stale-turn checks, and immutable match history.

### WebSocket service

Authenticates agent seat by existing token, routes protocol messages to that match only, broadcasts safe observer events, and returns stable error codes.

### Local connector

Caches current turn and probe results, invokes local command adapter, emits deterministic `trace.publish` status events, accepts optional structured decision traces, validates candidates locally, and submits one move.

### Browser observer

Renders fixed board geometry, phase ribbon, live activity rail, match state, connection/setup guidance, steering, move history, and post-match summary.

## 8. Data flow

1. User creates match and copies connector command.
2. Local runner connects using seat token.
3. Server sends compact `turn.start`; UI enters `Observe`.
4. Runner or agent requests selected probes; UI records `Probe` events.
5. Runner invokes local agent; UI shows verified `Evaluate` status.
6. Agent returns candidate plus optional structured trace.
7. Runner validates candidate against cached or requested legal moves; UI enters `Choose`.
8. Runner submits candidate; UI enters `Submit`.
9. Server accepts or rejects independently, updates board, then asks Stockfish to move.
10. Next compact turn starts with a fresh `turnId`.

## 9. Error behavior

- Invalid or stale requests return stable machine-readable codes plus short UI copy.
- Local invalid candidate never becomes a submitted move.
- Missing agent trace leaves truthful status text; UI never fabricates candidates.
- Lost agent connection keeps board and completed activity visible and changes primary state to `Waiting for agent`.
- Engine failure stops automatic advancement and shows recoverable match error.
- Slow agent shows elapsed time and current verified phase.
- Empty activity rail explains what will appear after connector starts.
- Copy actions confirm success through accessible status text.

## 10. Usability and visual rules

- Board container and every square preserve equal width and height.
- Layout uses available width without deriving board size solely from viewport height.
- Live turn state remains visible without tab changes.
- Current phase uses color, label, and position; color alone is insufficient.
- Agent and system events use different icons or labels.
- Motion is limited to subtle live-state feedback and respects reduced-motion preference.
- Keyboard focus, labels, contrast, and `aria-live` status remain intact.
- Responsive layout never places activity before board or hides current phase.

## 11. Install and dependency policy

Keep existing dependency set:

- `chess.js` for rules and notation;
- `ws` for WebSocket transport;
- Stockfish.js lite single-threaded WASM for local POC opponent;
- Node built-in test runner.

Regenerate environment-specific lockfile URLs so `npm ci` succeeds against public npm registry. Add no UI framework, state library, chessboard package, test framework, or DB.

## 12. Verification

Implementation follows literal test-first slices.

Required automated coverage:

- protocol validators and stable errors;
- compact snapshot shape and payload omissions;
- recent move window, movable pieces, check response;
- piece, full-move, history, validation, and stale-turn operations;
- WebSocket request/response scope;
- connector cache, local rejection, structured trace, and single submission;
- phase transitions and truthful missing-trace fallback;
- UI helpers and required live-state markup;
- unchanged Stockfish response loop.

Required final evidence:

```bash
npm ci
npm test
npm audit --audit-level=high
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
```

Also capture desktop and mobile browser checks confirming square board, persistent phase ribbon, visible activity rail, clear connector state, and usable error/empty states.

## 13. Exclusions

- Accounts and registered identities
- Persistent DB
- Elo or benchmark rating calculation
- Public matchmaking or PvP lobbies
- MCP adapter
- Hosted model inference or API-key handling
- Raw chain-of-thought capture
- Post-match engine analysis
- Broad theme rewrite
- Production deployment hardening
