# Agent Chess Portable Arena and Human Play Design

**Status:** Approved design; ready for written-spec review

**Protocol baseline:** `2.0`

**Product direction:** Play-first chess experience with portable agent integration

**Execution boundary:** Caller-owned model inference and credentials

## 1. Outcome

Agent Chess must support familiar, reliable chess play across three seat types:

- human browser;
- caller-owned AI agent or evaluation harness;
- hosted chess engine.

Any two supported seats must share one authoritative match model. First public exhibition modes are human versus engine and human versus connected agent. Existing agent-versus-engine play remains supported. Public matches expose structured agent activity for spectators without requesting or storing raw private reasoning.

The product should feel like chess software before agent instrumentation becomes prominent. Board interaction, turn ownership, legal feedback, lifecycle controls, responsive layout, and match recovery take precedence over platform breadth.

## 2. Approved decisions

1. Use one canonical, versioned match protocol plus thin REST, WebSocket, MCP, CLI, and SDK adapters.
2. Keep model execution and provider credentials with the caller. Agent Chess never requests or stores model API keys.
3. Require structured public decision trace for public agent matches. Permit move-only output in private evaluation matches.
4. Treat trace as agent-reported presentation data, not raw chain-of-thought.
5. Add human-versus-agent and human-versus-engine as unrated exhibition modes.
6. Generalize White and Black as seats controlled by `human`, `agent`, or `engine` controllers.
7. Use a play-first experience modeled on familiar chess-site interaction patterns.
8. Validate generalized match play before adding ratings, Texel calibration, accounts, or public matchmaking.

## 3. Success criteria

- Human can complete a legal game as White or Black against current hosted engine.
- Human can complete a legal game against a connected caller-owned agent.
- Existing agent-versus-engine protocol remains compatible through transition period.
- Board supports click, drag, touch, and keyboard move entry.
- Legal destinations, last move, check, promotion, turn ownership, and match result remain unambiguous.
- Public spectator URL never grants move authority or exposes seat credentials.
- Spectators see verified phase state plus committed structured agent decisions.
- Agent or harness can discover exact protocol, schemas, errors, examples, and conformance checks from one documentation entry point.
- Match can terminate through chess rules, resignation, abort, timeout, or explicit failure without hanging.
- Completed match can be exported with config, PGN, public activity, result, and reproducibility metadata.
- Existing fixed 8x8 geometry and responsive board/activity layout do not regress.

## 4. Match and seat model

Replace asymmetric `agentColor` versus Stockfish ownership with explicit seats:

```json
{
  "mode": "exhibition",
  "visibility": "public",
  "seats": {
    "white": {
      "kind": "human",
      "name": "Nicholas"
    },
    "black": {
      "kind": "agent",
      "name": "My Agent",
      "traceRequirement": "structured_required"
    }
  },
  "clock": {
    "kind": "none"
  }
}
```

Each seat has:

- `color`: derived from map key;
- `kind`: `human`, `agent`, or `engine`;
- `name`: bounded display name;
- `controllerId`: internal controller reference;
- `connectionState`: `not_required`, `waiting`, `connected`, or `disconnected`;
- `traceRequirement`: `structured_required` or `optional` for agent seats; omitted for other seat kinds;
- engine profile metadata when `kind` is `engine`.

`MatchSession` owns game state, active color, active turn ID, lifecycle, public activity, clock state, and termination. It does not know transport details. Controller adapters translate seat-specific input into generic operations:

```text
createTurn(color)
publishActivity(color, turnId, activity)
submitMove(color, turnId, moveUci, publicTrace?)
resign(color)
disconnect(color)
```

`chess.js` remains the only legality and game-over authority.

## 5. Turn dispatch

One scheduler examines the active seat:

- `engine` controller requests a move from configured engine adapter, then submits through the same authoritative path.
- `agent` controller sends compact protocol turn to authenticated caller, then waits for probes, activity, and submission.
- `human` controller broadcasts active state, enables authenticated browser input, then waits for submission.

Every non-engine turn receives a fresh `turnId`. All probes, activity, move submissions, draw actions, and timeout decisions are scoped to that ID. Accepted move closes the turn atomically. Repeated or stale submissions cannot mutate state.

Current `agentColor` fields remain derived compatibility data while existing connector migrates. New code must not use them as match authority.

## 6. Match creation and supported combinations

Initial public exhibition combinations:

- human versus engine;
- human versus agent;
- agent versus engine.

Private evaluation also permits agent versus agent and move-only agents. Engine-versus-engine remains an internal calibration mode, not a public exhibition creation option.

Creation validates:

- exactly two seats;
- one White and one Black seat;
- supported combination for requested mode;
- public agent seats require structured trace capability;
- engine seat references registered engine profile;
- human exhibition contains exactly one human seat;
- public match contains no private prompt, model key, or provider credential.

Color can be White, Black, or Random. Random selection occurs server-side and is recorded.

## 7. Authentication and visibility

Match creation returns distinct capabilities:

- human seat capability when a human seat exists;
- agent seat capability when an agent seat exists;
- spectator URL containing only unprivileged match ID.

Human browser stores its capability in session storage and sends it as bearer authorization. Agent connector or MCP client exchanges its capability for a short-lived connection ticket. Public snapshots, activity events, logs, exports, copyable spectator links, and PGN never contain either secret.

Observer transport is read-only. Missing, wrong, expired, mismatched-color, or stale capabilities return machine-readable rejection without state mutation.

Hosted deployment later adds account identity and visibility policy. Capability isolation is sufficient for local and small hosted exhibition validation; it is not a substitute for account security or abuse controls.

## 8. Public agent activity

Public UI exposes observable chess decisions, not hidden reasoning.

Live operational phases remain:

```text
Observe -> Probe -> Evaluate -> Choose -> Submit
```

Status events may stream during turn. Candidate moves, selected move, and rationale are committed atomically with accepted move, then released to spectators. This prevents uncommitted or contradictory decision data from becoming authoritative UI state.

Example submission:

```json
{
  "type": "move.submit",
  "turnId": "turn_01K...",
  "moveUci": "e2e4",
  "publicTrace": {
    "source": "agent_reported",
    "phase": "choose",
    "summary": "Prefer immediate central control.",
    "candidates": [
      { "uci": "e2e4", "note": "Claims space and opens lines." },
      { "uci": "g1f3", "note": "Develops without committing center." }
    ],
    "selectedMove": "e2e4"
  }
}
```

Validation rules:

- public trace contains at most three candidates;
- summary is at most 500 characters;
- candidate note is at most 160 characters;
- candidate UCI values are legal for active position;
- `selectedMove` equals submitted `moveUci`;
- source is `agent_reported`, `provider_summary`, or `adapter_generated`;
- UI labels source exactly and never relabels commentary as raw thought;
- public agent match rejects move without required decision trace;
- private evaluation accepts move-only submission and records disclosure level `move_only`.

Service never requests or stores raw chain-of-thought, prompts, credentials, secrets, private memory, or local files.

## 9. Play-first browser experience

### Match setup

Setup asks only choices needed to start:

- opponent: My Agent or Computer;
- color: White, Black, or Random;
- engine strength when Computer is selected;
- clock: No clock initially, then supported Fischer presets;
- player and agent names.

All human modes display `Unrated exhibition`. Connector instructions appear only when an agent seat exists.

### Board interaction

- Click/tap source then destination.
- Drag piece to legal destination.
- Keyboard can focus squares, select source, select destination, and cancel.
- Legal destination indicators distinguish empty moves from captures.
- Last move highlights source and destination.
- Check highlights checked king.
- Promotion opens explicit Queen, Rook, Bishop, Knight chooser; auto-queen becomes later preference.
- Board faces human seat by default; Flip remains available.
- Input disables outside human turn and while submission is pending.
- Server rejection restores exact authoritative position plus concise error.
- Move, capture, check, and game-end sounds share one mute control and start only after browser user interaction.

### Player chrome

- Name, seat kind, connection status, and clock sit adjacent to board.
- Active clock/turn receives strongest emphasis without relying on color alone.
- Captured material and material difference are derived from current position.
- Abort appears before first accepted move; Resign replaces it afterward.
- Automatic draws follow chess rules through `chess.js`.
- Negotiated draw offers are deferred until controller-neutral draw protocol exists.
- Focus mode keeps board, player strips, clocks, critical controls, and compact activity.

### Move history and review

- Move list uses numbered SAN pairs.
- Selecting historical ply replays that position without changing live state.
- Return-to-live control appears when viewer is behind current ply.
- Completed match shows result, termination, PGN copy/download, Rematch, and New match.
- Deep engine review, inaccuracies, opening explorer, and accuracy score remain later work.

## 10. Spectator experience

Spectator URL opens current state without seat capability. View includes:

- fixed square board;
- both player strips;
- live turn and lifecycle state;
- phase ribbon for active agent turn;
- structured activity rail with source badges;
- move history and current-ply navigation;
- result, termination, and PGN after completion;
- share control.

Human player and spectator renderers consume same public snapshot. Only authenticated human view receives move controls. Spectator reconnect receives one current snapshot followed by incremental events. Duplicate events do not duplicate moves or activity.

## 11. Clocks, timeout, disconnect, and termination

First core validation uses explicit `clock.kind = "none"`; UI displays `No clock`, never a fake timer. Clocked exhibition follows after seat orchestration proves stable.

Clock schema supports:

```json
{
  "kind": "fischer",
  "initialSeconds": 600,
  "incrementSeconds": 0
}
```

Server owns elapsed time, increment application, pause policy, and timeout result. Client display is interpolation only. Evaluation matches may use separate `decisionDeadlineMs`; this operational limit is not presented as a chess clock.

Lifecycle states:

```text
waiting -> active -> completed
                  -> aborted
                  -> failed
```

Rules:

- abort valid before first accepted move;
- resignation valid after match begins;
- chess timeout produces result when clock enabled;
- agent decision deadline produces configured forfeit or failed-eval outcome;
- disconnect preserves board and completed activity;
- reconnect replays active turn with same `turnId` until deadline or accepted move;
- engine failure stops advancement and yields explicit `failed` state;
- game-end emission is idempotent.

## 12. Engine boundary

Add controller-neutral engine interface:

```text
startMatch(config)
bestMove(fen, limits)
closeMatch()
```

Current Stockfish adapter remains first implementation. One engine instance per validation match avoids cross-match search state and simplifies failure ownership. Later hosted scale may use isolated pool workers with explicit reset semantics.

Snapshot and export record engine name, package version, profile ID, search limit, and host build identifier. Current numeric `Skill Level` remains internal compatibility data; UI must not call it Elo.

Texel profiles, calibrated `Estimated Elo`, Stockfish Unlimited, and post-match Stockfish analysis follow after generalized match validation.

## 13. Portable integration and documentation

Canonical protocol is authoritative. Adapters must not define divergent match behavior.

Published surfaces:

- OpenAPI document for HTTP resources;
- JSON Schemas for match creation, turn snapshot, probe, activity, submission, errors, state, and export;
- WebSocket protocol reference;
- remote MCP server over Streamable HTTP;
- CLI reference connector;
- minimal JavaScript and Python clients;
- `/llms.txt` discovery map as convenience, not authority;
- five-minute agent quickstart;
- bare-model harness example;
- conformance command against running server.

Agent entry page states:

1. how to authenticate without exposing credential;
2. how to join seat;
3. exact turn payload;
4. how to request legal moves or history;
5. exact structured trace contract;
6. how to submit move;
7. timeout, reconnect, error, and completion behavior;
8. privacy boundary.

Raw LLM cannot connect by itself. Bare-model evaluation example provides caller-owned wrapper that fetches instructions, calls model, validates structured response, and submits move.

## 14. Error behavior

Every rejection returns stable code, short message, active match/turn context when safe, and `recoverable` flag.

Required codes include:

- `MATCH_NOT_FOUND`;
- `SEAT_UNAUTHORIZED`;
- `SEAT_NOT_ACTIVE`;
- `STALE_TURN`;
- `INVALID_MOVE_FORMAT`;
- `MOVE_NOT_LEGAL`;
- `TRACE_REQUIRED`;
- `TRACE_CANDIDATE_NOT_LEGAL`;
- `TRACE_SELECTED_MOVE_MISMATCH`;
- `MATCH_ABORTED`;
- `MATCH_COMPLETE`;
- `TURN_TIMEOUT`;
- `ENGINE_FAILURE`;
- `UNSUPPORTED_MESSAGE`.

Errors never expose tokens, stack traces, prompts, provider output, local paths, or engine internals to public clients.

## 15. Validation plan

### Automated

1. Existing protocol, domain, connector, server, Stockfish, and UI tests remain green.
2. Human White submits legal move; engine replies; next human turn is fresh.
3. Human Black waits while engine makes first move.
4. Human versus agent alternates controllers through same match session.
5. Missing, wrong, expired, wrong-color, stale, illegal, and out-of-turn submissions reject without mutation.
6. Public agent move without structured trace rejects; private move-only evaluation succeeds.
7. Trace candidates must be legal; selected trace move must equal submission.
8. Observer joining mid-match receives current snapshot then ordered incremental events.
9. Disconnect/reconnect preserves active turn and avoids duplicate activity.
10. Abort, resign, checkmate, draw, timeout, engine failure, and repeated game-end calls resolve once.
11. Public snapshots and exports contain no capabilities or credentials.
12. Human board helpers cover click, drag, touch, keyboard, promotion, highlights, pending state, and rejection recovery.
13. Desktop and mobile browser checks preserve square board and usable controls during human selection.

### Smoke matches

- Human versus Stockfish as White for at least three human turns.
- Human versus Stockfish as Black for at least three human turns.
- Human versus connected agent for at least ten plies.
- Demo agent versus Stockfish through completion or explicit bounded termination.
- Codex versus Stockfish for at least ten agent moves.
- Observer joins each mode mid-match and sees board, activity, move history, result, and PGN.

Capture match JSON export, PGN, desktop screenshot, and mobile screenshot for each final proof mode.

## 16. Delivery order

1. Add RED tests for generic seats, authority, lifecycle, and human submissions.
2. Refactor match session to controller-neutral seats while preserving protocol `2.0` compatibility.
3. Add authenticated human move path and generalized scheduler.
4. Prove no-clock human/agent/engine match combinations with deterministic fake controllers.
5. Add play-first board interaction and lifecycle controls.
6. Add committed structured trace rules plus spectator reconnect.
7. Add match export and reproducibility metadata.
8. Add server-authoritative clock mode.
9. Publish canonical schemas, quickstart, conformance suite, and reference clients.
10. Add remote MCP adapter against canonical protocol.
11. Run full automated, smoke, accessibility, responsive, and screenshot verification.

## 17. Deferred work

- Accounts and registered identities
- Glicko-2 ratings and leaderboards
- Texel strength calibration
- Public matchmaking and lobbies
- Tournaments and challenges
- Chat and social graph
- Premoves
- Board/piece theme library
- Negotiated draw offers
- Opening explorer
- Deep post-match analysis and accuracy labels
- Persistent production DB
- Production abuse prevention and rate limiting

## 18. Migration and compatibility

- Existing agent-versus-Stockfish creation payload remains accepted during one protocol transition window.
- Server converts legacy `agentColor`, `agentName`, `skillLevel`, and `movetimeMs` into generic seats plus engine config.
- Existing connector continues to receive protocol `2.0` turn payload while new fields remain additive.
- Breaking removal requires protocol version increment and published migration guide.
- UI reads generic seats first, then legacy fields during transition.

## 19. Design constraints

- Preserve current `chess.js` authority.
- Preserve fixed board geometry and responsive board/activity layout.
- Do not add raw chain-of-thought capture.
- Do not introduce hosted provider-key storage.
- Do not call uncalibrated engine settings Elo.
- Do not add platform breadth before proof matches pass.
- Do not treat `/llms.txt` or adapter-specific docs as protocol authority.
