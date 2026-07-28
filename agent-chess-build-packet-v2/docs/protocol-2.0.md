# Agent Chess Protocol 2.0

**Status:** Implemented and verified in POC v1.
**Transport:** JSON WebSocket messages. Agent seat: `ws://HOST/agent?ticket=ONE_USE_TICKET` after capability exchange.
**Rules authority:** `chess.js`; UCI is canonical move identifier.

## Generic exhibition API

Create an exhibition with generic seats. `kind` is `human`, `agent`, or `engine`; `mode` is `exhibition` or `private_eval`; `visibility` is `public` or `private`. Public exhibitions support human-versus-engine, human-versus-agent, agent-versus-engine. `rated` is always false; no ratings or Elo mapping exists. `clock.kind` is always `none`: no clocks.

```json
{
  "mode": "exhibition",
  "visibility": "public",
  "seats": {
    "white": { "kind": "human", "name": "Human" },
    "black": { "kind": "engine", "name": "Stockfish" }
  }
}
```

`POST /api/matches` returns `{ "matchId", "capabilities", "uiPath" }`. Capability is creator-owned secret, returned once; retain it only in caller memory or browser session storage. It authenticates human HTTP actions or agent ticket exchange. It never appears in public snapshot/export. Agent ticket exchange is `POST /api/agent-sessions` using `Authorization: Bearer CAPABILITY`; response is `{ "ticket", "wsPath", "joinPath", "expiresAt" }`, where `wsPath` and `joinPath` contain same one-use ticket and `expiresAt` is 180 seconds ahead. Raw capability never appears in WebSocket URL.

## Self-describing agent invitation

Agent harnesses need HTTP support; WebSocket is optional compatibility transport. Fetch `GET /agent/join?ticket=ONE_USE_TICKET` before connecting. Valid invitation returns `200`, `Cache-Control: no-store`, JSON contract fields `service`, `protocolVersion`, `match`, `seat`, `security`, `connection`, `instructions`, `messageFlow`, and `publicTrace`. `connection.rest.claimUrl` plus `connection.websocket.url` are absolute. GET never consumes ticket; first REST or WebSocket claim consumes it. Expired or unknown ticket returns `410` and cannot connect.

Invitation URL is transcript-exposed bootstrap credential in direct model flow. It expires after 180 seconds, is match/seat scoped, and is single-use for claim. Never include it in snapshots, exports, telemetry, or public trace. Durable REST session token stays only in protected local state. Local harness retains credentials, prompts, private memory, local files, and raw reasoning.

Legacy creation payloads without `seats` map to agent-versus-engine: `agentColor` maps to agent seat color, `agentName` to agent name, `skillLevel`/`movetimeMs` to engine config, `steeringMode` stays supported. Legacy response additionally has `seatToken` and `agentWsPath`; generic callers must use `capabilities` plus ticket exchange instead. Legacy compatibility trace is optional.

`GET /api/matches/MATCH_ID` is public snapshot for public exhibitions. Private matches require a bound seat capability. `activeTurn` explicitly projects `protocolVersion`, `gameId`, `turnId`, FEN, ply, position status, deadline fields, `activeColor`, `seatKind`, `mode`; it never includes steering guidance. Private matches do not expose observer WebSockets. A human submits `POST /api/matches/MATCH_ID/human-moves` using `Authorization: Bearer CAPABILITY` plus `{ "turnId", "moveUci" }`; accepted `202` response is `{ "accepted": true, "moveUci", "moveSan" }`. `POST .../resign` is allowed after start; `POST .../abort` is allowed only before ply one. Lifecycle statuses: `waiting`, `active`, `completed`, `aborted`, `failed`.

Maintained REST connector wraps every active turn as `turn.ready`. `attachments[0]` is provider-neutral `{ type: "image", mimeType: "image/png", dataUrl, alt, imagePath }`. `dataUrl` carries canonical FEN-derived PNG bytes for vision-adapter mapping. `imagePath` points to same validated bytes in connector's protected local session directory for file-capable runtimes. Unsupported runtimes report `BOARD_IMAGE_UNSUPPORTED`; raw image data alone is not evidence of visual review. FEN remains authoritative.

Generic public agent seats require `publicTrace`: structured `source`, `phase`, `summary`, up to three legal `candidates`, `selectedMove`. Disclosure `source` is exactly `agent_reported`, `provider_summary`, or `adapter_generated`; absent `publicTrace.source` and `trace.publish.source` default to `agent_reported`. Transport actor is recorded separately. `selectedMove` must match submitted `moveUci`; trace candidates must be legal. It becomes public activity/export only when `move.submit` accepts it. Service never receives caller credentials, prompts, secrets, private memory, local files, or private reasoning. `private_eval` requires `visibility: private`; it is move_only, `trace.publish` returns `TRACE_NOT_ALLOWED`, submitted `publicTrace` is suppressed.

`GET /api/matches/MATCH_ID/export` returns config, status, termination, result, PGN, public activity, positions, protocol version. Engine-seat matches additionally include engine name, exact package version, deterministic skill/movetime profile ID, host build identifier; non-engine matches omit engine metadata. Terminal PGN sets matching `Result` plus `Termination` headers. Public export needs no auth; private export requires human or agent capability. No persistence: restart clears every match.

## Server-to-agent messages

`match.start`:

```json
{ "type": "match.start", "matchId": "UUID", "steeringMode": "locked", "agentColor": "white" }
```

`turn.start` is compact. `recentMoves` contains at most 12 plies. `positionStatus.movablePieces` contains every friendly origin with at least one legal move. POC chess clocks are disabled. Public exhibitions may still enforce agent decision deadline: deadline starts when active turn first reaches agent transport, remains stable across reconnects, and ends match with `AGENT_FAILURE` when missed. Local command adapter separately uses `AGENT_COMMAND_TIMEOUT_MS`, then local `turn.deadlineMs`, then default `30000` milliseconds.

```json
{
  "type": "turn.start",
  "protocolVersion": "2.0",
  "gameId": "UUID",
  "turnId": "UUID",
  "variant": "standard",
  "agentColor": "white",
  "sideToMove": "white",
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "ply": 0,
  "recentMoves": [],
  "positionStatus": {
    "inCheck": false,
    "movablePieces": [
      { "square": "a2", "piece": "pawn" }, { "square": "b1", "piece": "knight" },
      { "square": "b2", "piece": "pawn" }, { "square": "c2", "piece": "pawn" },
      { "square": "d2", "piece": "pawn" }, { "square": "e2", "piece": "pawn" },
      { "square": "f2", "piece": "pawn" }, { "square": "g1", "piece": "knight" },
      { "square": "g2", "piece": "pawn" }, { "square": "h2", "piece": "pawn" }
    ]
  },
  "steering": { "mode": "locked", "guidance": null },
  "deadline": null
}
```

`legalMoves` plus `movesUci` are omitted. `gameId`, `turnId` are UUID strings. FEN has six fields. `agentColor` equals `sideToMove` for this message. `steering.guidance` is queued trainer text, consumed on turn creation.

`moves.list.result`:

```json
{
  "type": "moves.list.result",
  "turnId": "UUID",
  "square": "e2",
  "piece": "pawn",
  "moves": [{ "uci": "e2e3", "san": "e3", "from": "e2", "to": "e3", "promotion": null }]
}
```

`moves.list_all.result`:

```json
{ "type": "moves.list_all.result", "turnId": "UUID", "moves": [{ "uci": "e2e4", "san": "e4", "from": "e2", "to": "e4", "promotion": null }] }
```

`history.list.result`:

```json
{ "type": "history.list.result", "turnId": "UUID", "moves": [{ "ply": 1, "color": "white", "uci": "e2e4", "san": "e4" }], "hasMore": false }
```

`move.validate.result`:

```json
{ "type": "move.validate.result", "turnId": "UUID", "moveUci": "e2e4", "legal": true, "san": "e4", "reason": null }
```

For an illegal well-formed candidate: `{ "legal": false, "san": null, "reason": "MOVE_NOT_LEGAL" }`.

`move.accepted`:

```json
{ "type": "move.accepted", "matchId": "UUID", "turnId": "UUID", "moveUci": "e2e4", "moveSan": "e4" }
```

`opponent.move`: `{ "type": "opponent.move", "matchId": "UUID", "moveUci": "e7e5", "moveSan": "e5" }`. `game.end` contains `matchId`, `result`, `pgn`, stable `status`, `termination`; failed matches additionally contain stable `failureCode`. Completed and aborted terminals have no `failureCode`. A stable `error` is sent before failed terminal delivery; it contains no raw diagnostics. Reference connector exits nonzero for `status: "failed"`, zero for completed or aborted terminals. `match.state` contains observer snapshot.

## Agent-to-server messages

Every request below needs active `turnId`. State change after accepted move invalidates that ID.

```json
{ "type": "moves.list", "turnId": "UUID", "square": "e2" }
```

```json
{ "type": "moves.list_all", "turnId": "UUID" }
```

```json
{ "type": "history.list", "turnId": "UUID", "beforePly": 25, "limit": 12 }
```

`beforePly` plus `limit` optional integers. Default cursor is current ply plus one; default limit is 12. Returned moves have `ply < beforePly`, ordered ascending, restricted to final `limit` matches. `hasMore` means returned first ply exceeds 1.

```json
{ "type": "move.validate", "turnId": "UUID", "moveUci": "e2e4" }
```

```json
{ "type": "move.submit", "turnId": "UUID", "moveUci": "e2e4" }
```

```json
{
  "type": "trace.publish",
  "turnId": "UUID",
  "kind": "decision",
  "phase": "evaluate",
  "summary": "Prefer center.",
  "candidates": [{ "uci": "e2e4", "note": "Controls d5." }],
  "selectedMove": "e2e4"
}
```

`trace.publish` broadcasts no direct reply; observers receive it plus updated `match.state`. It carries status/progress `phase` plus `summary` only; supplied decision fields, candidates, selected move are stripped. Malformed supplied decision fields can be rejected during validation before valid fields are stripped. Accepted `move.submit` is sole path that emits `agent.decision`. Omitted `phase` becomes `thinking`. Empty or absent summary rejects. Service trims `phase` to 40 chars, `summary` to 500 chars.

## Stable rejections

Rejected agent requests use:

```json
{ "type": "move.rejected", "code": "STALE_TURN", "message": "STALE_TURN", "turnId": "UUID" }
```

Stable codes: `STALE_TURN`, `INVALID_SQUARE`, `PIECE_NOT_MOVABLE`, `INVALID_MOVE_FORMAT`, `MOVE_NOT_LEGAL`, `UNSUPPORTED_MESSAGE`. Other current implementation errors can surface as `INVALID_JSON`, `INVALID_MESSAGE`, `INVALID_HISTORY_CURSOR`, `INVALID_HISTORY_LIMIT`, `EMPTY_TRACE`, `NOT_AGENT_TURN`, `GAME_OVER`, or `ENGINE_FAILURE`.

## Progressive connector action contract

Connector invokes configured command using shell, sends compact active turn JSON through stdin, reads one stdout result. Actions: `{ "probeSquare": "e2" }`, `{ "requestAllMoves": true }`, `{ "moveUci": "e2e4" }`; optional `trace` has `phase` capped 40 chars, `summary` capped 1000 chars before transport. Absent, null, or empty command `trace.source` defaults to `agent_reported`; an explicit unsupported source fails locally with `INVALID_TRACE_SOURCE` before submission, including when summary is absent or empty. Bare UCI works. Connector emits public `trace.publish` events for `evaluate`, action trace, `choose`. During public active turns, connector failures publish only `Agent connector failed.` with `adapter_generated` provenance; pre-turn failures publish nothing, and `private_eval` suppresses trace publication. Raw child stderr, local paths, and detailed diagnostics remain local stderr only. Connector caches matching `moves.list.result` or `moves.list_all.result`; candidate must occur in cached results before `move.submit`. Max four command rounds. Repeated probe/full-list request fails locally.

## Privacy

Service never requests chain-of-thought, prompts, credentials, secrets, private memory, or local files. Explicit `trace.publish` text is stored in match activity and broadcast to observer clients through state/event broadcasts. Never publish secrets or private reasoning in trace fields.

## Breaking migration from 1.0

1. `turn.start` no longer contains `legalMoves` or `movesUci`.
2. Agents choose a movable origin then request `moves.list`; full expansion needs explicit `moves.list_all`.
3. Every probe, validation, trace, submission requires active `turnId`.
4. Local command output may request a probe/full list before move; connector reinvokes command after cache update.
5. Trace publication now requires `turnId`; only structured concise public text crosses boundary.

Protocol 1.0 clients relying on default `legalMoves` are incompatible. Update them to progressive actions.
