# Agent Chess POC v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship protocol `2.0` progressive turns plus a square board, persistent five-phase ribbon, and truthful agent activity rail in the existing playable Agent Chess prototype.

**Architecture:** Extend the existing `chess.js` domain and `MatchSession`; do not replace them. WebSocket service remains authoritative. Local connector requests only needed move data, publishes concise status/decision traces, and submits one validated move. Vanilla browser UI consumes public match state and activity events.

**Tech Stack:** Node.js 22, `chess.js` 1.4.0, `ws` 8.21.1, Stockfish.js 18.0.8 lite-single, Node test runner, vanilla HTML/CSS/JS.

## Global Constraints

- `chess.js` is the only legality source.
- Default `turn.start` omits full `legalMoves` and complete `movesUci` history.
- Every probe, validation, and submission is scoped to active `turnId`.
- Server independently validates every submitted move.
- Trace payloads contain concise presentation text, never raw chain-of-thought, prompts, credentials, memory, or local files.
- Keep existing dependencies; add no framework, DB, chessboard package, or test framework.
- Board must remain `1 / 1` at desktop and mobile widths.
- UI must not invent phase progress or candidate moves.
- Preserve locked/trainer steering, PGN, observer events, and real Stockfish play.

---

## File map

- `src/protocol.js`: protocol version, message types, request validation, stable error codes.
- `src/game.js`: authoritative compact chess views and candidate validation.
- `src/match.js`: active-turn probes, trace/activity state, stale-turn enforcement.
- `src/server.js`: HTTP/WebSocket routing and observer broadcast.
- `src/connector.js`: command output parsing, local candidate validation, probe cache helpers.
- `bin/connect-agent.js`: progressive request loop and deterministic phase publication.
- `bin/smoke-agent.js`: progressive smoke client.
- `examples/*.js`: progressive sample agents.
- `public/index.html`: phase ribbon and persistent activity structure.
- `public/app.js`: phase/activity derivation and rendering.
- `public/styles.css`: square board and responsive layout.
- `test/*.test.js`: focused RED/GREEN proof.
- `docs/protocol-2.0.md`, `README.md`: exact wire and run contracts.

---

### Task 1: Protocol contracts

**Files:**
- Modify: `src/protocol.js`
- Create: `test/protocol.test.js`

**Interfaces:**
- Produces: `PROTOCOL_VERSION`, `MESSAGE_TYPES`, `ERROR_CODES`, `parseClientMessage(raw)`.
- Consumes: raw WebSocket text or `Buffer`.

- [ ] **Step 1: Write RED protocol tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, parseClientMessage } from '../src/protocol.js';

test('uses protocol 2.0', () => assert.equal(PROTOCOL_VERSION, '2.0'));
test('requires turnId for probes', () => {
  assert.throws(() => parseClientMessage('{"type":"moves.list","square":"e2"}'), /STALE_TURN/);
});
test('rejects invalid probe squares', () => {
  assert.throws(() => parseClientMessage('{"type":"moves.list","turnId":"t","square":"z9"}'), /INVALID_SQUARE/);
});
test('accepts canonical piece probes', () => {
  assert.deepEqual(parseClientMessage('{"type":"moves.list","turnId":"t","square":"e2"}'), {
    type: 'moves.list', turnId: 't', square: 'e2',
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/protocol.test.js`  
Expected: FAIL because `PROTOCOL_VERSION` and probe validation do not exist.

- [ ] **Step 3: Add minimal constants and validators**

Required message types: `moves.list`, `moves.list.result`, `moves.list_all`, `moves.list_all.result`, `history.list`, `history.list.result`, `move.validate`, `move.validate.result`, existing move/trace/state types. Required errors: `STALE_TURN`, `INVALID_SQUARE`, `PIECE_NOT_MOVABLE`, `INVALID_MOVE_FORMAT`, `MOVE_NOT_LEGAL`, `UNSUPPORTED_MESSAGE`.

`parseClientMessage()` must parse JSON, require known request type, require non-empty `turnId` for turn-scoped requests, validate square with `/^[a-h][1-8]$/`, validate UCI with `/^[a-h][1-8][a-h][1-8][qrbn]?$/`, and return a normalized object without unrelated properties.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/protocol.test.js`  
Expected: all protocol tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protocol.js test/protocol.test.js
git commit -m "feat: define protocol 2.0 contracts"
```

---

### Task 2: Compact chess domain

**Files:**
- Modify: `src/game.js`
- Modify: `test/game.test.js`

**Interfaces:**
- Produces: `getRecentMoves(limitPlies)`, `getMovablePieces()`, `getMovesForSquare(square)`, `validateCandidate(moveUci)`, `buildTurnSnapshot(options)`.
- Consumes: existing `AgentChessGame.legalMoves()`, move history, canonical FEN.

- [ ] **Step 1: Write RED domain tests**

```js
test('groups starting moves into ten movable origins', () => {
  assert.deepEqual(game.getMovablePieces().map((p) => p.square),
    ['a2','b1','b2','c2','d2','e2','f2','g1','g2','h2']);
});
test('builds compact turn without full legal list', () => {
  const turn = game.buildTurnSnapshot({ gameId: 'g', turnId: 't', agentColor: 'white', steering: { mode: 'locked', guidance: null }, deadline: null });
  assert.equal(turn.protocolVersion, '2.0');
  assert.equal('legalMoves' in turn, false);
  assert.equal('movesUci' in turn, false);
  assert.equal(turn.positionStatus.inCheck, false);
});
test('piece probe returns only e2 moves', () => {
  assert.deepEqual(game.getMovesForSquare('e2').map((m) => m.uci).sort(), ['e2e3', 'e2e4']);
});
```

Add history-window and checked-position tests using fixed legal FENs.

- [ ] **Step 2: Verify RED**

Run: `node --test test/game.test.js`  
Expected: FAIL on missing methods.

- [ ] **Step 3: Implement minimal authoritative views**

Derive movable pieces by grouping `legalMoves()` by `from`; map `p/n/b/r/q/k` to `pawn/knight/bishop/rook/queen/king`; sort by square. Build recent moves from verbose `chess.history({ verbose: true })`, using `toUci(move)`. Candidate validation returns `{ moveUci, legal, san, reason }` without calling `chess.move()`.

`buildTurnSnapshot()` must emit `type`, `protocolVersion`, `gameId`, `turnId`, `variant`, `agentColor`, `sideToMove`, `fen`, `ply`, `recentMoves`, `positionStatus`, `steering`, and `deadline`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/game.test.js`  
Expected: all game tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game.js test/game.test.js
git commit -m "feat: build compact turn snapshots"
```

---

### Task 3: Match probes and truthful activity

**Files:**
- Modify: `src/match.js`
- Modify: `test/match.test.js`

**Interfaces:**
- Produces: `listMovesForPiece({turnId,square})`, `listAllMoves({turnId})`, `listHistory({turnId,beforePly,limit})`, `validateCandidate({turnId,moveUci})`, `publishTrace(trace)`, `activity` snapshot.
- Consumes: Task 2 domain methods.

- [ ] **Step 1: Write RED match tests**

Prove: compact `createTurnPayload()`, exact `e2` probe, `PIECE_NOT_MOVABLE` for `a1`, non-mutating validation, paginated history, stale probe after accepted move, trace limit of three candidates, no fabricated decision entries when trace is absent.

```js
const turn = match.createTurnPayload();
assert.deepEqual(match.listMovesForPiece({ turnId: turn.turnId, square: 'e2' }).moves.map((m) => m.uci).sort(), ['e2e3','e2e4']);
assert.equal(match.validateCandidate({ turnId: turn.turnId, moveUci: 'e2e4' }).legal, true);
assert.equal(match.game.snapshot().ply, 0);
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/match.test.js`  
Expected: FAIL on missing probe methods and protocol `1.0` payload.

- [ ] **Step 3: Implement turn guard and activity events**

Use one private `_assertActiveTurn(turnId)` path for all probes/submissions. Store sanitized activity entries shaped as `{ type, source, phase, at, turnId, summary, candidates, selectedMove }`. System events use `source: 'system'`; published decision text uses `source: 'agent'`. Truncate summary to 500, notes to 160, candidates to three.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/match.test.js`  
Expected: all match tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/match.js test/match.test.js
git commit -m "feat: add turn-scoped match probes"
```

---

### Task 4: Progressive local connector and sample agents

**Files:**
- Modify: `src/connector.js`
- Modify: `bin/connect-agent.js`
- Modify: `bin/smoke-agent.js`
- Modify: `examples/simple-agent.js`
- Modify: `examples/gpt-5.6-agent.js`
- Modify: `examples/stockfish-agent.js`
- Modify: `test/connector.test.js`
- Modify: `test/gpt-agent.test.js`
- Modify: `test/fixtures/legal-agent.js`

**Interfaces:**
- Produces: `parseAgentAction(stdout)`, `cacheProbe(turn, result)`, `validateLocalCandidate(turn, moveUci)`, progressive command actions `{probeSquare}` or `{moveUci,trace}`.
- Consumes: compact `turn.start`, `moves.list.result`, WebSocket send/receive.

- [ ] **Step 1: Write RED connector tests**

```js
assert.deepEqual(parseAgentAction('{"probeSquare":"e2"}'), { probeSquare: 'e2', trace: null });
assert.throws(() => validateLocalCandidate(turn, 'e2e5'), /MOVE_NOT_LEGAL/);
assert.equal(validateLocalCandidate(cacheProbe(turn, { square: 'e2', moves: [{ uci: 'e2e4', san: 'e4' }] }), 'e2e4').moveUci, 'e2e4');
```

Prove malformed UCI rejection before WebSocket submission and compact snapshot delivery to command adapter.

- [ ] **Step 2: Verify RED**

Run: `node --test test/connector.test.js test/gpt-agent.test.js`  
Expected: FAIL because progressive actions/cache do not exist.

- [ ] **Step 3: Implement smallest progressive loop**

Command adapter may first return `{"probeSquare":"e2"}`. Connector sends one `moves.list`, caches result under current `turnId`, reinvokes command with `probeResults`, then accepts a move present in cached results. Cap command rounds at four and reject repeated unknown probes. Demo/smoke agents choose a preferred movable origin, probe it, then submit one returned move. GPT adapter may request `moves.list_all` explicitly when it needs ranked cross-piece candidates; this must remain opt-in.

Publish `trace.publish` status before command execution (`evaluate`) and before submission (`choose`) plus optional agent decision trace.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/connector.test.js test/gpt-agent.test.js`  
Expected: all connector/GPT tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/connector.js bin/connect-agent.js bin/smoke-agent.js examples test/connector.test.js test/gpt-agent.test.js test/fixtures/legal-agent.js
git commit -m "feat: add progressive local agent loop"
```

---

### Task 5: WebSocket probes and activity transport

**Files:**
- Modify: `src/server.js`
- Modify: `test/server.test.js`

**Interfaces:**
- Produces: authenticated responses for Task 1 message types and public activity state.
- Consumes: Task 3 match operations.

- [ ] **Step 1: Write RED server tests**

Test first `turn.start` contains protocol `2.0`, movable pieces, no full legal list; `moves.list` returns `e2e3/e2e4`; stale probe returns `STALE_TURN`; trace candidates appear in observer state; legal submit still triggers opponent and next turn.

- [ ] **Step 2: Verify RED**

Run: `node --test test/server.test.js`  
Expected: FAIL on compact payload and unsupported probe messages.

- [ ] **Step 3: Add explicit handler switch**

Route `moves.list`, `moves.list_all`, `history.list`, `move.validate`, `trace.publish`, and `move.submit` to current token-bound record only. Respond with matching `*.result`, preserve `turnId`, use stable codes. Broadcast state after trace/probe/validation/submission events. Keep one queued shared Stockfish engine.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/server.test.js`  
Expected: all server tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: transport protocol 2.0 probes"
```

---

### Task 6: Square board, phase ribbon, activity rail

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/ui.test.js`

**Interfaces:**
- Produces: `deriveTurnPhase(match)`, `formatActivity(entry)`, fixed board layout, persistent live state.
- Consumes: public match snapshot with `activity`, game state, connection, agent color.

- [ ] **Step 1: Write RED UI tests**

```js
assert.equal(deriveTurnPhase({ activity: [{ phase: 'probe' }] }).key, 'probe');
assert.equal(deriveTurnPhase({ activity: [] }).label, 'Waiting for turn');
assert.deepEqual(formatActivity({ source: 'system', type: 'moves.list', square: 'e2', count: 2 }).meta, 'e2 · 2 legal moves');
```

Read `public/styles.css` and assert `.board` includes `aspect-ratio: 1` and `.square` includes `aspect-ratio: 1` or equivalent grid sizing.

- [ ] **Step 2: Verify RED**

Run: `node --test test/ui.test.js`  
Expected: FAIL on missing helpers and markup.

- [ ] **Step 3: Implement selected layout A**

Place five-step ribbon above board. Keep activity rail outside tabs and beside board on desktop. Render system events and agent decision traces with distinct labels. Show at most three candidates. Use truthful fallback `Agent working` when phase exists without summary. Preserve setup, steering, move history, PGN, post-match state.

CSS: board and square use fixed 1:1 geometry; main layout uses `minmax(0, 1fr)` and never stretches board by row height. At `max-width: 1020px`, activity follows board; at `max-width: 720px`, phase labels remain readable and current activity stays above secondary panels. Add reduced-motion rule.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/ui.test.js`  
Expected: all UI tests PASS.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/styles.css test/ui.test.js
git commit -m "feat: clarify live agent match state"
```

---

### Task 7: Portable install and documentation

**Files:**
- Modify: `package-lock.json`
- Modify: `README.md`
- Create: `docs/protocol-2.0.md`
- Modify: `docs/superpowers/specs/2026-07-21-agent-chess-progressive-agent-interface.md`

**Interfaces:**
- Produces: reproducible install and exact public protocol reference.

- [ ] **Step 1: Regenerate public lock metadata**

Run: `npm install --package-lock-only --registry=https://registry.npmjs.org`  
Verify: `rg 'packages\.applied-caas-gateway' package-lock.json` returns no matches.

- [ ] **Step 2: Prove clean install**

Run: `npm ci --registry=https://registry.npmjs.org`  
Expected: exit `0`, three pinned production dependencies installed.

- [ ] **Step 3: Document exact contracts**

Document every request/response example, stable error, progressive command adapter action, decision trace limits, privacy boundary, run command, and protocol `1.0` breaking changes. Mark progressive interface spec implemented only after Task 8 passes.

- [ ] **Step 4: Commit**

```bash
git add package-lock.json README.md docs/protocol-2.0.md docs/superpowers/specs/2026-07-21-agent-chess-progressive-agent-interface.md
git commit -m "docs: publish protocol 2.0 usage"
```

---

### Task 8: Full integration and visual verification

**Files:**
- Modify only files required by observed failures.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: completion evidence.

- [ ] **Step 1: Run full automated suite**

Run: `npm test`  
Expected: all tests PASS with zero failures.

- [ ] **Step 2: Audit dependencies**

Run: `npm audit --audit-level=high`  
Expected: zero high or critical vulnerabilities.

- [ ] **Step 3: Run one server and two real-engine smokes**

Run server: `npm start`  
Run twice: `npm run smoke -- --server http://127.0.0.1:3000 --turns 3`  
Expected each time: JSON `ok: true`, at least five plies, same server process remains healthy.

- [ ] **Step 4: Browser verification**

Check desktop `1440x900` and mobile `390x844`: board bounding box width equals height within one CSS pixel; phase ribbon is visible; current phase is labeled; activity rail contains system events; connector state and copy action work; no horizontal overflow.

- [ ] **Step 5: Independent review and final fix pass**

Reviewer compares diff to design, reports only concrete P0/P1/P2 findings. Fix validated findings test-first. Re-run Steps 1-4.

- [ ] **Step 6: Final commit**

```bash
git add -u
git commit -m "chore: verify Agent Chess POC v1"
```
