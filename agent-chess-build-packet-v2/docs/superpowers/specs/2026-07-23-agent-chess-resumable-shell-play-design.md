# Resumable Shell Play for Agent Chess

**Status:** Approved direction  
**Date:** 2026-07-23  
**Primary client:** Codex/Pi-style agents with short-lived, noninteractive shell tools

## Problem

Current direct-play onboarding starts one long-running WebSocket connector that reads moves from stdin. This works only when agent host can stream process output, retain process handle, then write follow-up input. A noninteractive shell tool blocks until connector exits, so model never receives `turn.start` in time to submit move. Server eventually records `AGENT_FAILURE`, even though failure occurred before chess decision.

Connection loss also strands current invitation flow. User must mint another invitation and may create another match, despite existing match, seat, active turn remaining authoritative.

## Goals

1. One pasted prompt lets one Codex/Pi task join and play complete match without further human input.
2. Every transport action runs as short shell command that exits after one response.
3. One invitation claims seat once. Durable session token reconnects same seat and match until match reaches terminal state.
4. Connector/process exit never ends match or requires new match.
5. Same move can be retried safely using existing `turnId` idempotency.
6. Auth token never appears in stdout, stderr, public activity, copied diagnostics, or move trace.
7. Model selects every move. Transport never chooses random, preferred, engine, or first-legal fallback.
8. Existing LLM prompt-cache behavior remains: one agent task, stable instructions, compact appended turn packets, no model subprocess per move.
9. One `status` command explains current match state, last successful phase, waiting owner, and next action.
10. Transport failure remains distinct from chess decision failure.

## Non-goals

- Background daemon or local WebSocket supervisor
- New DB or persistence across Agent Chess server restart
- OpenTelemetry deployment
- New dependency
- MCP redesign
- Chess engine inside connector
- Automated move selection
- Cross-task recovery of private model context or provider prompt cache
- Tournament, rating, matchmaking, or account work

## Chosen Architecture

Existing REST session service remains canonical control plane:

- `POST /api/agent/claim`
- `GET /api/agent/turn`
- `GET /api/agent/legal-moves`
- `POST /api/agent/move`
- `GET /api/agent/result`

Hosted `agent-play.js` gains short-command mode. WebSocket mode remains compatibility path for interactive harnesses.

```text
join invite -> persist scoped session -> exit
turn        -> fetch turn plus legal moves -> exit
move        -> submit model-selected move -> exit
status      -> inspect local session plus public match/result -> exit
result      -> read terminal result, remove local session -> exit
```

MCP remains adapter over same `agentAccess` service. No transport owns chess state.

## Session Bootstrap

Browser continues minting one-use, three-minute, match-bound, seat-bound invitation. Invitation contract exposes REST claim URL alongside existing WebSocket information.

Copied prompt launches hosted script once:

```text
agent-play.js join --join-url INVITATION_URL
```

`join`:

1. Reads invitation contract without consuming ticket.
2. Claims REST session once.
3. Creates match-specific directory below OS temp directory with mode `0700`.
4. Writes versioned session JSON with mode `0600`.
5. Caches hosted `agent-play.js` beside session file for short later invocations.
6. Prints only nonsecret match ID, seat, session path alias, and exact next command.
7. Exits `0`.

Session JSON contains:

```json
{
  "version": 1,
  "serverUrl": "http://127.0.0.1:3200",
  "matchId": "MATCH_ID",
  "color": "white",
  "sessionToken": "SECRET"
}
```

Token never appears in process arguments after bootstrap. Ticket may appear in copied prompt and transcript; product must describe it honestly as transcript-exposed, single-use bootstrap credential, not claim it remains unlogged.

## Command Contract

Commands emit one JSON object to stdout. Diagnostics use stderr only when they contain local-only detail. Public-safe error JSON remains on stdout.

### `turn`

```text
agent-play.js turn --match MATCH_ID [--wait-ms 25000]
```

Behavior:

1. Loads stored session.
2. Calls `GET /api/agent/turn`.
3. When turn exists, calls `GET /api/agent/legal-moves` using returned `turnId`.
4. Emits one `turn.ready` object containing compact turn, material, recent moves, position status, deadline, and authoritative legal moves.
5. Emits `turn.wait` on bounded long-poll timeout.
6. Emits `game.end` when match is terminal.

Calling `turn` again after process loss resumes same active turn. It never creates match or claims another seat.

### `move`

```text
agent-play.js move --match MATCH_ID --json MOVE_JSON
```

`MOVE_JSON` contains `turnId`, `moveUci`, and bounded `publicTrace`. Script performs syntax checks only, then submits to authoritative server. Existing replay behavior returns accepted prior result when same `turnId` and `moveUci` repeat. Conflicting replay returns stable `CONFLICTING_REPLAY`.

### `status`

```text
agent-play.js status --match MATCH_ID
```

`status` authenticates through `GET /api/agent/result`, reads public match snapshot, then emits:

```json
{
  "type": "session.status",
  "matchId": "MATCH_ID",
  "seat": "white",
  "session": "valid",
  "match": "active",
  "turnId": "TURN_ID",
  "waitingOn": "agent",
  "deadline": "ISO_TIMESTAMP",
  "lastSuccessfulStep": "legal_moves_received",
  "nextAction": "submit_move",
  "error": null
}
```

Output contains no token, invitation, local absolute path, prompt, private memory, provider diagnostic, or private reasoning.

### `result`

```text
agent-play.js result --match MATCH_ID
```

Returns status, termination, result, PGN. Terminal result removes session token file and cached script. Nonterminal result preserves both and reports next action.

## Full-Match Agent Loop

Copied prompt instructs one model task:

1. Run `join`.
2. Run `turn`.
3. If `turn.wait`, retry `turn`.
4. If `turn.ready`, evaluate position and authoritative legal moves.
5. Run `move` with model-selected UCI and bounded public trace.
6. Wait for accepted result before commentary.
7. Repeat `turn`.
8. On command/process failure, run `status`, follow `nextAction`, and retry same command.
9. Stop only on `game.end` or terminal `result`.

Connector never launches model. One Codex/Pi task owns entire chess loop.

## Reconnect Semantics

Match lifecycle and connection lifecycle remain separate:

- Process exit: no server mutation.
- HTTP disconnect: client retries same command.
- Agent task continues: same local session token reconnects automatically.
- Active turn: same `turnId` returns until accepted move or terminal match.
- Submitted move with lost response: repeat same `turnId` plus `moveUci`; server returns replayed acceptance.
- Missing or corrupt session file: `SESSION_NOT_FOUND` or `SESSION_INVALID`; user mints fresh invitation for same match and seat.
- Expired bootstrap invitation before claim: `INVITATION_EXPIRED`; user mints fresh invitation for same match.
- Terminal match: moves reject; `result` remains readable before local cleanup.

Server decision deadline starts when active turn is delivered through REST. Transport disconnect alone never emits `AGENT_FAILURE`. Existing deadline remains authoritative after delivery and across retries.

## Error Contract

Every failure emits stable shape:

```json
{
  "type": "connector.error",
  "code": "SESSION_NOT_FOUND",
  "phase": "load_session",
  "recoverable": true,
  "matchId": "MATCH_ID",
  "turnId": null,
  "nextAction": "request_reconnect_invitation"
}
```

Required codes:

| Code | Meaning | Recovery |
|---|---|---|
| `INVITATION_EXPIRED` | Bootstrap expired before claim | Mint invitation for same match |
| `INVITATION_ALREADY_CLAIMED` | Bootstrap already consumed | Load existing session or mint same-match invitation |
| `SESSION_NOT_FOUND` | Local session missing | Mint same-match invitation |
| `SESSION_INVALID` | File malformed, unsafe, or wrong version | Remove invalid file, mint same-match invitation |
| `UNAUTHORIZED` | Server rejected durable token | Mint same-match invitation |
| `SERVER_UNREACHABLE` | Network/server unavailable | Retry `status` |
| `TURN_WAIT` | No new turn inside wait window | Retry `turn` |
| `STALE_TURN` | Move targets old turn | Run `turn` |
| `MOVE_NOT_LEGAL` | Server rejected move | Re-evaluate returned legal moves |
| `CONFLICTING_REPLAY` | Different move reused same turn | Run `status`, then `turn` |
| `AGENT_DECISION_TIMEOUT` | Model missed delivered-turn deadline | Terminal; report separately from transport |
| `MATCH_TERMINAL` | Match already ended | Run `result` |

No raw stack, token, ticket, local path, or server internals enter public-safe error.

## Token Caching

Two caches remain distinct.

### Auth session

Durable REST token is written once, reused by every short command, then removed after terminal result. Reconnect never consumes another invitation unless local state is lost or server rejects token.

### LLM prompt cache

One Codex/Pi task plays whole match. System instructions and tool definitions remain stable; turn packets append as compact tool results. Connector does not spawn cold model process per move. Transport implementation must not rewrite static prompt prefix or inject changing timestamps/nonces into instructions.

Transport reconnect preserves match and auth session. New agent task may lose provider prompt cache or private model context; this is outside transport guarantee.

## Troubleshooting

V1 uses existing match snapshot, activity, result, and local session state. It does not add telemetry service.

`status` answers:

- Can client read session file?
- Can server authenticate session?
- Does match still exist?
- Is match active or terminal?
- Which seat/turn is active?
- What was last public lifecycle step?
- Who is system waiting on?
- What exact command should run next?

Match UI should render same derived state:

```text
Invitation issued -> session claimed -> turn delivered -> legal moves read
-> waiting for agent move -> move accepted -> waiting for opponent
```

Transport failure must render `Connection problem`; model deadline failure must render `Agent decision timeout`. Neither becomes chess loss unless product explicitly defines such result later.

## Security

- Temp directory mode `0700`; session file mode `0600`.
- Refuse symlink session files.
- Use atomic create/write/rename.
- Never print or log token.
- Never place durable token in URL.
- Match/seat scope limits token authority.
- Invitation remains single-use, short-lived bootstrap.
- Session cleanup occurs after terminal result; explicit local cleanup command may remove abandoned state.
- Public trace accepts bounded decision summary only.

## Tests

Minimum regression suite:

1. Join process claims invitation, writes `0600` state, prints no secret.
2. Separate process reads same session and receives initial turn plus legal moves.
3. Process exits; third process reads same session and submits move to same match/seat.
4. Lost move response followed by identical retry returns replayed acceptance without duplicate ply.
5. `status` reports correct `waitingOn`, `lastSuccessfulStep`, and `nextAction`.
6. Missing/corrupt/symlink session fails closed with stable recovery code.
7. Expired invitation requests new invitation for same match, never new match.
8. Terminal result removes local token and cached client.
9. Captured stdout/stderr contain neither invitation nor durable token.
10. Full direct-play prompt contains no move-selection fallback and keeps one model task.
11. Existing WebSocket, REST, MCP, server, match, UI, and privacy tests remain green.
12. Provider usage check shows prompt-cache behavior no worse than current one-task workflow.

## Acceptance

Feature ships when one copied prompt completes one agent-versus-computer exhibition through separate shell processes, survives forced process termination between turn and move, resumes same match without new invitation, keeps secrets out of captured output, reports actionable status, and passes existing test suite.
