# Agent Chess Core Exhibition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize match ownership to human, agent, and engine seats; ship no-clock human exhibition matches; preserve protocol 2.0 agent play; provide trustworthy spectator trace and match evidence.

**Architecture:** `MatchSession` remains transport-neutral and owns one `chess.js` game, two normalized seats, one active turn, lifecycle, and public activity. `server.js` authenticates seat capabilities and dispatches active turns to human, agent, or per-match engine controllers. Browser consumes generic public seats and submits human moves through an authenticated HTTP endpoint while observer transport stays read-only.

**Tech Stack:** Node.js 22+, ECMAScript modules, `chess.js@1.4.0`, `stockfish@18.0.8`, `ws@8.21.1`, vanilla HTML/CSS/JS, Node built-in test runner.

## Global Constraints

- Preserve `chess.js` as sole legality and game-over authority.
- Preserve protocol `2.0` compatibility for existing agent-versus-Stockfish clients.
- Preserve fixed 8x8 board geometry and responsive board/activity layout.
- Human-versus-agent and human-versus-engine are `Unrated exhibition` modes.
- Public agent matches require structured decision trace; private evaluations may be `move_only`.
- Never request, store, log, broadcast, or export model credentials, prompts, raw chain-of-thought, private memory, or local files.
- Never place human or agent seat capabilities in spectator URL, public snapshot, activity, PGN, or match export.
- Use explicit `clock.kind = "none"` in this plan; server-authoritative clocks belong to the next plan.
- Current Stockfish `Skill Level` remains internal compatibility data; UI must not label it Elo.
- Add no accounts, ratings, Texel calibration, matchmaking, persistence DB, premoves, themes, or deep analysis in this plan.

## File structure

- Create `src/seats.js`: normalize generic and legacy creation inputs; validate seat combinations; expose public seat metadata.
- Modify `src/match.js`: replace agent/opponent authority with generic seats, active turns, controller-neutral move submission, lifecycle, committed decisions, export.
- Modify `src/protocol.js`: normalize structured `publicTrace` on `move.submit`; preserve existing probe and trace messages.
- Modify `src/connector.js`: attach final agent trace to move submission while preserving live status publication.
- Modify `src/server.js`: per-match engine, capability maps, generic scheduler, human move/resign/export endpoints, safe public snapshots.
- Create `public/board-interaction.js`: pure human-selection and UCI construction helpers.
- Modify `public/app.js`: generic seat rendering, authenticated human submission, interactive board, lifecycle controls.
- Modify `public/index.html`: generic setup form, human controls, promotion dialog, disclosure labels.
- Modify `public/styles.css`: legal targets, selection, check, pending state, promotion, generic player strips; retain board sizing rules.
- Create `test/seats.test.js`: input normalization and mode validation.
- Modify `test/match.test.js`: generic seat turns, trace rules, lifecycle, export.
- Modify `test/protocol.test.js`: structured submission parser.
- Modify `test/connector.test.js`: attached trace request.
- Modify `test/server.test.js`: human/agent/engine scheduling, capability isolation, export, failures.
- Create `test/board-interaction.test.js`: pure selection, promotion, turn gating.
- Modify `test/ui.test.js`: generic copy, required controls, geometry regression.
- Modify `README.md` and `docs/protocol-2.0.md`: exact exhibition and compatibility contracts.
- Create `bin/smoke-human.js`: authenticated scripted human turns for White and Black.

---

### Task 1: Normalize generic seats and preserve legacy creation

**Files:**
- Create: `src/seats.js`
- Create: `test/seats.test.js`

**Interfaces:**
- Consumes: legacy `{ agentColor, agentName, skillLevel, movetimeMs, steeringMode }`, explicit generic `{ mode, visibility, seats, engine }`, or exhibition shorthand `{ human, opponent, color: "white" | "black" | "random" }`.
- Produces: `normalizeMatchConfig(body, options?)`, `activeSeatFor(gameTurn, seats)` returning seat plus `color`, `publicSeat(seat)`, `validateSeatCombination(config)`.

- [ ] **Step 1: Write RED seat normalization tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMatchConfig } from '../src/seats.js';

test('normalizes human versus engine exhibition', () => {
  const config = normalizeMatchConfig({
    mode: 'exhibition', visibility: 'public',
    seats: {
      white: { kind: 'human', name: 'Nicholas' },
      black: { kind: 'engine', name: 'Stockfish' },
    },
    engine: { provider: 'stockfish', skillLevel: 5, movetimeMs: 150 },
  });
  assert.equal(config.clock.kind, 'none');
  assert.equal(config.seats.white.kind, 'human');
  assert.equal(config.seats.black.kind, 'engine');
  assert.equal(config.rated, false);
});

test('maps legacy agent payload into generic seats', () => {
  const config = normalizeMatchConfig({ agentColor: 'black', agentName: 'Legacy Agent', skillLevel: 3 });
  assert.equal(config.seats.black.kind, 'agent');
  assert.equal(config.seats.white.kind, 'engine');
  assert.equal(config.compatibility.legacyAgentColor, 'black');
});

test('rejects unsupported public exhibition pair', () => {
  assert.throws(() => normalizeMatchConfig({
    mode: 'exhibition', visibility: 'public',
    seats: { white: { kind: 'engine' }, black: { kind: 'engine' } },
  }), /UNSUPPORTED_SEAT_COMBINATION/);
});

test('resolves random human color on server and records request', () => {
  const config = normalizeMatchConfig({
    mode: 'exhibition', human: { name: 'Human' },
    opponent: { kind: 'engine', name: 'Computer' }, color: 'random',
  }, { random: () => 0.75 });
  assert.equal(config.seats.black.kind, 'human');
  assert.equal(config.colorSelection.requested, 'random');
  assert.equal(config.colorSelection.resolved, 'black');
});
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `node --test test/seats.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/seats.js`.

- [ ] **Step 3: Implement minimal normalization module**

```js
const KINDS = new Set(['human', 'agent', 'engine']);

function cleanSeat(seat, fallbackName) {
  if (!seat || !KINDS.has(seat.kind)) throw new Error('INVALID_SEAT');
  return {
    kind: seat.kind,
    name: String(seat.name ?? fallbackName).trim().slice(0, 80),
    traceRequirement: seat.kind === 'agent'
      ? (seat.traceRequirement === 'structured_required' ? 'structured_required' : 'optional')
      : null,
  };
}

export function normalizeMatchConfig(body = {}, { random = Math.random } = {}) {
  const legacy = !body.seats;
  const agentColor = body.agentColor === 'black' ? 'black' : 'white';
  const seats = legacy ? {
    [agentColor]: cleanSeat({ kind: 'agent', name: body.agentName ?? 'Local Agent' }, 'Local Agent'),
    [agentColor === 'white' ? 'black' : 'white']: cleanSeat({ kind: 'engine', name: 'Stockfish' }, 'Stockfish'),
  } : {
    white: cleanSeat(body.seats.white, 'White'),
    black: cleanSeat(body.seats.black, 'Black'),
  };
  const config = {
    mode: body.mode === 'private_eval' ? 'private_eval' : 'exhibition',
    visibility: body.visibility === 'private' ? 'private' : 'public',
    rated: false,
    steeringMode: body.steeringMode === 'trainer' ? 'trainer' : 'locked',
    clock: { kind: 'none' },
    seats,
    engine: {
      provider: 'stockfish',
      skillLevel: Math.max(0, Math.min(20, Number(body.engine?.skillLevel ?? body.skillLevel ?? 5))),
      movetimeMs: Math.max(25, Math.min(5000, Number(body.engine?.movetimeMs ?? body.movetimeMs ?? 150))),
    },
    compatibility: legacy ? { legacyAgentColor: agentColor } : null,
  };
  validateSeatCombination(config);
  return config;
}
```

Implement `validateSeatCombination()` so public exhibition allows `human-engine`, `human-agent`, or `agent-engine`, contains exactly one human when any human exists, and marks every public agent seat `structured_required` unless config came through legacy compatibility. Implement `activeSeatFor(turn, seats)` and `publicSeat(seat)` as pure helpers.

When `body.human` and `body.opponent` are supplied, resolve `body.color` server-side. Use White for `white`, Black for `black`, and `random() < 0.5 ? 'white' : 'black'` for `random`. Record both requested and resolved color in `colorSelection`; never rely on browser randomization.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `node --test test/seats.test.js`

Expected: all seat tests PASS.

- [ ] **Step 5: Commit seat normalization**

```bash
git add src/seats.js test/seats.test.js
git commit -m "feat: normalize generic match seats"
```

---

### Task 2: Refactor MatchSession to controller-neutral turns

**Files:**
- Modify: `src/match.js`
- Modify: `src/game.js`
- Modify: `test/match.test.js`

**Interfaces:**
- Consumes: normalized `{ seats, mode, visibility, clock, steeringMode, engine, compatibility }` from Task 1.
- Produces: `activeSeat()`, `activeTurn()`, `isTerminal()`, `start()`, `createTurnPayload()`, `submitSeatMove({ color, turnId, moveUci, publicTrace })`, `resign(color)`, `abort(color)`, `fail(code, message)`, `snapshot()`, `exportRecord()`.
- Compatibility: preserve `isAgentTurn()`, `submitAgentMove()`, and `submitOpponentMove()` as wrappers until migration completes.

- [ ] **Step 1: Add RED generic-turn tests**

```js
test('creates active turn for human seat and rejects wrong color', () => {
  const match = new MatchSession({
    mode: 'exhibition', visibility: 'public', clock: { kind: 'none' },
    seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'engine', name: 'Engine' } },
  });
  const turn = match.createTurnPayload();
  assert.equal(turn.activeColor, 'white');
  assert.equal(turn.seatKind, 'human');
  assert.throws(() => match.submitSeatMove({ color: 'black', turnId: turn.turnId, moveUci: 'e2e4' }), /SEAT_NOT_ACTIVE/);
});

test('alternates human and agent seats through one authoritative path', () => {
  const match = new MatchSession({
    mode: 'exhibition', visibility: 'public', clock: { kind: 'none' },
    seats: {
      white: { kind: 'human', name: 'Human' },
      black: { kind: 'agent', name: 'Agent', traceRequirement: 'structured_required' },
    },
  });
  const white = match.createTurnPayload();
  match.submitSeatMove({ color: 'white', turnId: white.turnId, moveUci: 'e2e4' });
  const black = match.createTurnPayload();
  assert.equal(black.activeColor, 'black');
  assert.equal(black.seatKind, 'agent');
});
```

Add RED tests for stale turns, resign, abort-before-first-move, idempotent completion, public snapshots with generic seats, and export containing config/PGN/activity but no internal controller fields.

- [ ] **Step 2: Run MatchSession tests to verify RED**

Run: `node --test test/match.test.js`

Expected: FAIL on missing generic constructor fields and `submitSeatMove`.

- [ ] **Step 3: Implement generic authority while retaining wrappers**

Constructor stores normalized seats and lifecycle:

```js
this.mode = config.mode;
this.visibility = config.visibility;
this.seats = structuredClone(config.seats);
this.clock = { kind: 'none' };
this.status = 'waiting';
this.termination = null;
this.currentTurnId = null;
this.currentTurnPayload = null;
this.closedTurnIds = new Set();
this.game = new AgentChessGame({ white: this.seats.white.name, black: this.seats.black.name });
```

Constructor calls `normalizeMatchConfig()` when passed legacy fields so existing direct `MatchSession` tests and callers remain valid.

`start()` changes `waiting` to `active` exactly once. `createTurnPayload()` derives active color from `game.snapshot().turn`, returns existing payload for replay, records one `turn.start`, and adds `activeColor`, `seatKind`, `mode`, and `deadline: null` without removing protocol 2.0 compatibility fields. Every seat kind receives an internal turn ID; server exposes payload only to active human or agent controller.

`submitSeatMove()` checks lifecycle, color, turn ID, trace contract, then applies move once. Wrapper methods call it with derived colors.

`resign(color)` sets result override, termination `resignation`, status `completed`, closes active turn, and records system activity. `abort(color)` succeeds only before first ply and sets status `aborted`.

- [ ] **Step 4: Add FEN history for replay/export**

In `AgentChessGame`, store initial snapshot plus a FEN after every accepted move:

```js
this.positions = [this.chess.fen({ forceEnpassantSquare: true })];
// after move
this.positions.push(this.chess.fen({ forceEnpassantSquare: true }));
```

Expose `positions` as a copied array in `snapshot()`.

Add `inCheck` to game snapshot. UI derives checked king square from `game.turn`, `game.inCheck`, and current FEN; server remains authority for check state.

- [ ] **Step 5: Run domain suite to verify GREEN**

Run: `node --test test/game.test.js test/match.test.js`

Expected: all game and match tests PASS, including legacy wrappers.

- [ ] **Step 6: Commit generic match domain**

```bash
git add src/game.js src/match.js test/game.test.js test/match.test.js
git commit -m "feat: generalize match turn authority"
```

---

### Task 3: Commit structured decision trace with submitted move

**Files:**
- Modify: `src/protocol.js`
- Modify: `src/match.js`
- Modify: `src/connector.js`
- Modify: `bin/connect-agent.js`
- Modify: `test/protocol.test.js`
- Modify: `test/match.test.js`
- Modify: `test/connector.test.js`

**Interfaces:**
- Consumes: `move.submit` plus optional `publicTrace`.
- Produces: normalized trace `{ source, phase, summary, candidates, selectedMove }`; `createAgentRequest(turn, action)` attaches `action.trace` as `publicTrace` for move actions.

- [ ] **Step 1: Write RED protocol and legality tests**

```js
test('normalizes public trace attached to move submission', () => {
  const parsed = parseClientMessage(JSON.stringify({
    type: 'move.submit', turnId: 'turn-1', moveUci: 'e2e4',
    publicTrace: {
      source: 'agent_reported', phase: 'choose', summary: 'Claim center.',
      candidates: [{ uci: 'e2e4', note: 'Opens lines.' }], selectedMove: 'e2e4',
    },
  }));
  assert.equal(parsed.publicTrace.selectedMove, 'e2e4');
});

test('public agent move requires legal matching decision trace', () => {
  const match = publicAgentMatch();
  const turn = match.createTurnPayload();
  assert.throws(() => match.submitSeatMove({ color: 'white', turnId: turn.turnId, moveUci: 'e2e4' }), /TRACE_REQUIRED/);
  assert.throws(() => match.submitSeatMove({
    color: 'white', turnId: turn.turnId, moveUci: 'e2e4',
    publicTrace: { summary: 'Choose e4.', candidates: [{ uci: 'e2e5' }], selectedMove: 'e2e4' },
  }), /TRACE_CANDIDATE_NOT_LEGAL/);
});
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `node --test test/protocol.test.js test/match.test.js test/connector.test.js`

Expected: FAIL because `publicTrace` is discarded and connector request omits trace.

- [ ] **Step 3: Add one shared trace normalizer in protocol module**

Export `parsePublicTrace(value)` and call it from both `TRACE_PUBLISH` and `MOVE_SUBMIT`. Reject malformed UCI with `INVALID_MOVE_FORMAT`; cap summary, candidate count, and notes after parsing.

```js
if (message.type === MESSAGE_TYPES.MOVE_SUBMIT && message.publicTrace !== undefined) {
  parsed.publicTrace = parsePublicTrace(message.publicTrace);
}
```

- [ ] **Step 4: Enforce committed trace in MatchSession**

Before mutation:

```js
if (seat.kind === 'agent' && seat.traceRequirement === 'structured_required' && !publicTrace) {
  throw new Error('TRACE_REQUIRED');
}
for (const candidate of publicTrace?.candidates ?? []) {
  if (!this.game.validateCandidate(candidate.uci).legal) throw new Error('TRACE_CANDIDATE_NOT_LEGAL');
}
if (publicTrace?.selectedMove && publicTrace.selectedMove !== moveUci) {
  throw new Error('TRACE_SELECTED_MOVE_MISMATCH');
}
```

After move accepts, record one `agent.decision` activity containing committed trace. Existing `trace.publish` remains available for live status but cannot create committed decision activity.

- [ ] **Step 5: Attach adapter trace to move request**

Change connector request creation:

```js
if (action?.moveUci) return {
  type: 'move.submit',
  turnId: turn.turnId,
  moveUci: action.moveUci,
  ...(action.trace ? { publicTrace: { ...action.trace, selectedMove: action.moveUci } } : {}),
};
```

Ensure demo agent emits at least one legal candidate equal to selected move for public matches.

- [ ] **Step 6: Run focused tests to verify GREEN**

Run: `node --test test/protocol.test.js test/match.test.js test/connector.test.js`

Expected: all focused tests PASS.

- [ ] **Step 7: Commit structured submission trace**

```bash
git add src/protocol.js src/match.js src/connector.js bin/connect-agent.js test/protocol.test.js test/match.test.js test/connector.test.js
git commit -m "feat: commit agent decisions with moves"
```

---

### Task 4: Add generic server scheduler and capability-isolated human API

**Files:**
- Modify: `src/server.js`
- Modify: `bin/connect-agent.js`
- Modify: `test/server.test.js`
- Modify: `test/connector.test.js`

**Interfaces:**
- Consumes: normalized config, generic `MatchSession`, Stockfish factory.
- Produces: `POST /api/matches`, `POST /api/agent-sessions`, `POST /api/matches/:id/human-moves`, `POST /api/matches/:id/resign`, `POST /api/matches/:id/abort`, `GET /api/matches/:id`, `GET /api/matches/:id/export`, ticket-authenticated agent WebSocket, observer WebSocket.

- [ ] **Step 1: Add RED human scheduling integration tests**

Add helper that creates generic match and returns creator capabilities. Cover:

```js
test('human White move is authenticated and followed by engine move', async () => {
  const created = await createMatch(address, {
    mode: 'exhibition', visibility: 'public',
    seats: { white: { kind: 'human', name: 'Human' }, black: { kind: 'engine', name: 'Engine' } },
  });
  const state = await getMatch(address, created.matchId);
  const response = await fetch(`${address.httpUrl}/api/matches/${created.matchId}/human-moves`, {
    method: 'POST', headers: {
      authorization: `Bearer ${created.capabilities.human}`,
      'content-type': 'application/json',
    }, body: JSON.stringify({ turnId: state.activeTurn.turnId, moveUci: 'e2e4' }),
  });
  assert.equal(response.status, 202);
  await waitForPly(address, created.matchId, 2);
});
```

Add tests for human Black engine-first, wrong token, spectator without token, stale turn, illegal move, human-versus-agent handoff, no capability in public snapshot/export, short-lived agent ticket exchange, ticket single use/expiry, human reload/reconnect, agent reconnect replaying same turn ID, bounded decision deadline, and one engine instance per match.

- [ ] **Step 2: Run server tests to verify RED**

Run: `node --test test/server.test.js`

Expected: FAIL on generic creation and missing human route.

- [ ] **Step 3: Replace shared-engine singleton with record-owned engine**

On creation, start engine only when match contains engine seat. Store `record.engine`. Close it when match ends or server stops. Keep scheduler re-entry guarded by `record.advancing`.

- [ ] **Step 4: Issue private capabilities and safe creation response**

Use capability and ticket maps:

```js
const seatByToken = new Map();
const seatByTicket = new Map();
const matches = new Map();
```

For each human or agent seat, generate independent 24-byte base64url capability and store `{ record, color, kind }`. Generic creation response includes a one-time `capabilities` object only; legacy creation also returns existing `seatToken` alias for its agent capability during compatibility window. `publicSnapshot(record)` includes public seats, active turn, lifecycle, engine metadata, game, activity, and PGN, never capabilities.

- [ ] **Step 5: Exchange agent capability for short-lived connection ticket**

`POST /api/agent-sessions` accepts agent capability as bearer authorization and returns `{ ticket, wsPath, expiresAt }`. Ticket is random, single-use, expires after 60 seconds, and maps to bound match/color. Existing legacy `/agent?token=` remains accepted only for legacy match creation during compatibility window.

Update connector startup so `--seat CAPABILITY` calls `/api/agent-sessions`, receives `wsPath`, then connects. Never print capability or ticket. Add connector tests with a fake exchange response.

- [ ] **Step 6: Implement one scheduler by active seat kind**

```js
async function advance(record) {
  if (record.advancing || record.session.isTerminal()) return;
  const seat = record.session.activeSeat();
  if (seat.kind === 'human') return broadcastState(record);
  if (seat.kind === 'agent') return deliverAgentTurn(record, seat.color);
  record.advancing = true;
  try {
    const turn = record.session.createTurnPayload();
    const moveUci = await record.engine.bestMove(turn.fen, record.engineConfig);
    record.session.submitSeatMove({ color: seat.color, turnId: turn.turnId, moveUci });
    broadcastState(record);
  } catch (error) {
    record.session.fail('ENGINE_FAILURE', error.message);
    broadcastState(record);
  } finally {
    record.advancing = false;
  }
  return advance(record);
}
```

- [ ] **Step 7: Implement authenticated human move, resign, and abort routes**

Parse bearer token, confirm record/color/kind, pass body to `submitSeatMove`, return 202 plus accepted move, broadcast state, then call `advance(record)`. Map stable domain errors to 400/401/404/409 responses without stack or secret data.

- [ ] **Step 8: Route agent WebSocket by ticket-bound color**

Consume single-use `ticket` during WebSocket upgrade. Pass bound record/color into connection handler and reject protocol submissions whose active seat differs. On reconnect, caller exchanges capability for a fresh ticket; connection receives same active turn payload and turn ID.

- [ ] **Step 9: Implement bounded decision deadline and safe export route**

When match config includes `decisionDeadlineMs`, arm timer only for active agent seat. Expiry closes turn through explicit failed-eval or forfeit policy; timer clears on accepted move, disconnect does not reset it.

`GET /api/matches/:id/export` returns `session.exportRecord()` plus engine name/version/profile and protocol version. Public match export is read-only by match ID. Private evaluation export requires seat capability. Exclude tokens, sockets, engine object, controller IDs, internal error stacks, and private connector output.

- [ ] **Step 10: Run server tests to verify GREEN**

Run: `node --test test/server.test.js`

Expected: all server tests PASS with localhost permission.

- [ ] **Step 11: Commit server orchestration**

```bash
git add src/server.js bin/connect-agent.js test/server.test.js test/connector.test.js
git commit -m "feat: add human exhibition orchestration"
```

---

### Task 5: Add pure human board interaction state

**Files:**
- Create: `public/board-interaction.js`
- Create: `test/board-interaction.test.js`

**Interfaces:**
- Consumes: public game snapshot, authenticated human color, selected square, destination square.
- Produces: `canHumanMove(match, color)`, `legalMovesFrom(match, square)`, `selectHumanSquare(state, square, match, color)`, `buildHumanMove(state, destination, promotion)`.

- [ ] **Step 1: Write RED pure interaction tests**

```js
test('selects owned source and builds legal UCI destination', () => {
  const match = initialHumanMatch('white');
  const selected = selectHumanSquare({ selected: null }, 'e2', match, 'white');
  assert.deepEqual(selected.legalTargets, ['e3', 'e4']);
  assert.deepEqual(buildHumanMove(selected, 'e4'), { moveUci: 'e2e4', promotionRequired: false });
});

test('blocks selection outside authenticated human turn', () => {
  assert.equal(canHumanMove({ status: 'active', game: { turn: 'black' } }, 'white'), false);
});

test('requires promotion choice when legal moves contain promotion suffixes', () => {
  const result = buildHumanMove(promotionState(), 'e8');
  assert.equal(result.promotionRequired, true);
});
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `node --test test/board-interaction.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement immutable interaction helpers**

Helpers must never mutate match snapshot. Selection accepts only piece owned by active human color and derived legal move origins. Selecting another owned piece switches source. Selecting current source cancels. Invalid destination returns unchanged state. Promotion returns available suffixes from authoritative legal moves.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `node --test test/board-interaction.test.js`

Expected: all interaction tests PASS.

- [ ] **Step 5: Commit interaction module**

```bash
git add public/board-interaction.js test/board-interaction.test.js
git commit -m "feat: add human board interaction state"
```

---

### Task 6: Build generic setup and playable human board UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/ui.test.js`

**Interfaces:**
- Consumes: generic public match snapshot, creator-only capabilities, Task 5 interaction helpers.
- Produces: generic setup payload, human move requests, promotion selection, generic player/status/activity rendering, replay/focus/share/material controls.

- [ ] **Step 1: Add RED UI helper and markup tests**

Test generic seat labels instead of `agentColor`, connector visibility only for agent matches, human controls only for authenticated human view, promotion dialog presence, square button semantics, legal-target classes, captured material, history replay/return-live, focus mode, share control, no-clock copy, `Unrated exhibition`, and unchanged board geometry assertions.

- [ ] **Step 2: Run UI tests to verify RED**

Run: `node --test test/ui.test.js test/board-interaction.test.js`

Expected: FAIL on missing generic controls and helpers.

- [ ] **Step 3: Replace setup form with opponent/color choices**

Form fields:

```html
<select name="opponentKind">
  <option value="engine">Computer</option>
  <option value="agent">My agent</option>
</select>
<select name="humanColor">
  <option value="white">White</option>
  <option value="black">Black</option>
  <option value="random">Random</option>
</select>
```

JavaScript sends exhibition shorthand `{ human, opponent, color }`; server resolves Random and returns generic seats. Store `created.capabilities.human` and `created.capabilities.agent` in session storage under match-scoped keys. Never add them to URL. Connector command exchanges agent capability through `/api/agent-sessions` before opening WebSocket.

- [ ] **Step 4: Render generic players and state**

Replace hard-coded Agent/Stockfish summary logic with seat-derived names and kinds. Set board orientation toward authenticated human. Show `No clock`. Show agent connector card only when creator has agent capability. Spectator load receives no move controls.

- [ ] **Step 5: Render interactive squares without changing geometry**

Use `<button type="button" class="square">` for each square. Preserve `grid-template-columns` and `grid-template-rows`. Apply:

- `selected` to source;
- `legal-target` to quiet target;
- `legal-capture` to occupied target;
- `in-check` to checked king;
- `submission-pending` to board during request.

Support click/tap and keyboard Enter/Space. Use native pointer drag events only after click path passes; drag must call same pure selection helpers.

- [ ] **Step 6: Submit authenticated move and recover from rejection**

```js
await fetch(`/api/matches/${encodeURIComponent(matchId)}/human-moves`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${humanCapability}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ turnId: currentMatch.activeTurn.turnId, moveUci }),
});
```

Disable input while pending. On non-202, reload authoritative state, clear selection, show error toast, and restore input only when still human turn.

- [ ] **Step 7: Add explicit promotion chooser**

Promotion dialog offers Queen, Rook, Bishop, Knight. Choice appends `q`, `r`, `b`, or `n` only when that exact UCI appears in public legal moves. Escape cancels without submission.

- [ ] **Step 8: Add captured material, replay, focus, share, and lifecycle controls**

Derive captured pieces and material difference from initial versus current FEN. Move-row selection renders `game.positions[ply]` without changing live snapshot; Return to live restores current FEN. Focus toggles a root class that keeps board, player strips, lifecycle controls, and compact activity. Share copies spectator URL containing match ID only. Before ply 1 show Abort; afterward show Resign. Require confirmation. Download Match JSON calls export route. Existing PGN copy remains.

- [ ] **Step 9: Run UI tests to verify GREEN**

Run: `node --test test/ui.test.js test/board-interaction.test.js`

Expected: all UI tests PASS.

- [ ] **Step 10: Commit playable browser UI**

```bash
git add public/index.html public/app.js public/styles.css test/ui.test.js
git commit -m "feat: add playable human exhibition UI"
```

---

### Task 7: Add smoke harness and exact operator documentation

**Files:**
- Create: `bin/smoke-human.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/protocol-2.0.md`
- Modify: `test/server.test.js`
- Create: `test/smoke-human.test.js`

**Interfaces:**
- Consumes: generic match API and human capability.
- Produces: `npm run smoke:human -- --server URL --color white|black --turns 3`.

- [ ] **Step 1: Write failing smoke-contract integration test**

Test script argument parsing and exported `chooseHumanMove(snapshot)` against legal moves without starting server. Guard CLI execution with direct-module detection. Ensure script never logs capability.

- [ ] **Step 2: Run focused test to verify RED**

Run: `node --test test/smoke-human.test.js test/server.test.js`

Expected: FAIL on missing smoke helper.

- [ ] **Step 3: Implement scripted human smoke client**

Client creates human-versus-engine exhibition, keeps capability in memory, polls/observes until human turn, chooses preferred legal UCI, submits authenticated move, stops after requested human turns, prints only match ID, plies, result/status, and public export URL. Agent connector documentation shows capability-to-ticket exchange; raw capability never appears in WebSocket URL.

- [ ] **Step 4: Add package script**

```json
"smoke:human": "node bin/smoke-human.js"
```

- [ ] **Step 5: Document exact local flows and contracts**

README must show:

- human versus computer setup;
- human versus local agent setup;
- agent versus engine compatibility command;
- creator capability secrecy;
- spectator URL behavior;
- no-clock limitation;
- public structured trace versus private move-only rule;
- smoke commands.

Protocol doc must define generic seats, active turn fields, `publicTrace`, human move endpoint, lifecycle, stable errors, legacy payload conversion, and export shape.

- [ ] **Step 6: Run documentation-linked tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 7: Commit smoke and docs**

```bash
git add bin/smoke-human.js package.json README.md docs/protocol-2.0.md test/server.test.js test/smoke-human.test.js
git commit -m "docs: publish exhibition validation flow"
```

---

### Task 8: Complete end-to-end validation and capture evidence

**Files:**
- Create: `docs/validation/core-exhibition-validation.md`
- Create: `docs/validation/screenshots/human-engine-desktop.png`
- Create: `docs/validation/screenshots/human-engine-mobile.png`
- Create: `docs/validation/screenshots/human-agent-spectator.png`
- Modify only if failures require scoped fixes: files from Tasks 1-7 plus matching tests.

**Interfaces:**
- Consumes: complete core exhibition implementation.
- Produces: reproducible test/smoke/visual evidence and follow-on gap list for clock/polish plan.

- [ ] **Step 1: Run dependency and automated verification**

Run:

```bash
npm ci --registry=https://registry.npmjs.org
npm test
npm audit --audit-level=high
```

Expected: clean install, all tests PASS, zero high-or-critical vulnerabilities.

- [ ] **Step 2: Start server and run scripted smoke matrix**

Run:

```bash
npm start
npm run smoke:human -- --server http://127.0.0.1:3000 --color white --turns 3
npm run smoke:human -- --server http://127.0.0.1:3000 --color black --turns 3
npm run smoke -- --server http://127.0.0.1:3000 --turns 3
```

Expected: White and Black human smokes reach three accepted human turns; agent smoke reaches three accepted agent turns; no match leaks capability in output.

- [ ] **Step 3: Complete manual human-versus-engine proof**

Create one White and one Black no-clock exhibition. Verify click, drag, touch-size controls, legal highlights, orientation, promotion using a test FEN fixture if normal game does not promote, abort, resign, export, PGN, and observer join.

- [ ] **Step 4: Complete manual human-versus-agent proof**

Connect demo or Codex agent. Play at least ten plies. Verify agent status appears live; candidates and rationale appear only after accepted move; human move controls disable on agent turn; spectator URL cannot submit.

- [ ] **Step 5: Capture responsive screenshots**

Capture desktop at 1440x900 and mobile at 390x844. Compare against approved play-first target. Board must remain untrimmed, square, seam-free, and free of dark bars. Current turn, player names, lifecycle control, phase, and activity remain visible or directly reachable.

- [ ] **Step 6: Write validation report**

Record commit, Node/npm versions, commands, exact test counts, smoke match IDs, results, screenshot paths, known limitations, and explicit go/no-go for next clock/polish plan.

- [ ] **Step 7: Commit validation evidence**

```bash
git add docs/validation
git commit -m "test: record core exhibition validation"
```

## Follow-on plan boundaries

This plan stops after stable no-clock exhibition proof. Next plan adds server-authoritative Fischer clocks, audio feedback, final focus-mode polish, captured-piece presentation refinement, and broader accessibility/browser coverage. Third plan adds OpenAPI/JSON Schema publication, remote MCP, JavaScript/Python reference clients, `/llms.txt`, and conformance tooling. Ratings, Texel calibration, accounts, and matchmaking remain blocked until all three plans pass.
