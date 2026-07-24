# Agent Chess Resumable Shell Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace copied long-running stdin connector flow with durable REST-backed short commands that reconnect to same match and emit actionable diagnostics.

**Architecture:** Extend hosted `public/agent-play.js` with `join`, `turn`, `move`, `status`, and `result` commands while preserving existing WebSocket compatibility mode. Reuse current `agentAccess` REST session, move replay, match snapshot, and result endpoints; persist only scoped local session token plus cached client under protected OS temp directory.

**Tech Stack:** Node.js 22 standard library, existing HTTP/JSON REST API, `node:test`

## Global Constraints

- No new dependency, daemon, DB, model subprocess, or move-selection fallback.
- One Codex/Pi task owns full match and provider prompt cache.
- Invitation claims once; durable session reconnects same match/seat until terminal.
- Session directory mode `0700`; token file mode `0600`; refuse symlink state.
- Token never enters stdout, stderr, URL after claim, public trace, or diagnostics.
- Existing WebSocket, REST, MCP, match, server, privacy, and UI behavior remains green.
- Existing user changes in dirty worktree must remain intact.

---

### Task 1: Durable REST Shell Client

**Files:**
- Modify: `public/agent-play.js`
- Modify: `test/connector-play.test.js`

**Interfaces:**
- Consumes: invitation `connection.rest.claimUrl`; REST endpoints `/api/agent/turn`, `/api/agent/legal-moves`, `/api/agent/move`, `/api/agent/result`; public `/api/matches/:id`.
- Produces: CLI commands `join`, `turn`, `move`, `status`, `result`; JSON events `session.ready`, `turn.ready`, `turn.wait`, `move.accepted`, `session.status`, `game.end`, `connector.error`.

- [ ] **Step 1: Write failing cross-process reconnect test**

Add one integration test that:

```js
const joined = await runClient(['join', '--join-url', joinUrl], emptyCwd);
assert.equal(joined.message.type, 'session.ready');
assert.equal(joined.output.includes(ticket.ticket), false);

const turn = await runCached(joined.message.clientPath, ['turn', '--match', created.matchId], emptyCwd);
assert.equal(turn.message.type, 'turn.ready');
assert.ok(turn.message.legalMoves.some(({ uci }) => uci === 'e2e4'));

const moved = await runCached(joined.message.clientPath, [
  'move', '--match', created.matchId, '--json',
  JSON.stringify({
    turnId: turn.message.turn.turnId,
    moveUci: 'e2e4',
    publicTrace: {
      source: 'agent_reported',
      phase: 'choose',
      summary: 'Claims central space.',
      candidates: [{ uci: 'e2e4', note: 'Space and development.' }],
      selectedMove: 'e2e4',
    },
  }),
], emptyCwd);
assert.equal(moved.message.accepted, true);
assert.equal((await getMatch(address, created.matchId)).game.movesUci[0], 'e2e4');
```

Capture all stdout/stderr and assert neither invitation nor durable token appears. Assert session file mode is `0o600`.

- [ ] **Step 2: Run focused test to verify RED**

Run:

```bash
node --test test/connector-play.test.js
```

Expected: FAIL because hosted client lacks `join`, cached state, and short REST commands.

- [ ] **Step 3: Add protected session storage**

Add Node standard-library helpers to `public/agent-play.js`:

```js
const SESSION_VERSION = 1;
const SESSION_ROOT = join(tmpdir(), 'agent-chess');

function matchDirectory(matchId) {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(matchId)) throw coded('SESSION_INVALID', 'load_session');
  return join(SESSION_ROOT, matchId);
}

async function writeSession(session, clientSource) {
  const directory = matchDirectory(session.matchId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await assertRegularOrMissing(join(directory, 'session.json'));
  await atomicWrite(join(directory, 'session.json'), `${JSON.stringify(session)}\n`, 0o600);
  await atomicWrite(join(directory, 'agent-play.mjs'), clientSource, 0o600);
  return { directory, sessionPath: join(directory, 'session.json'), clientPath: join(directory, 'agent-play.mjs') };
}
```

`assertRegularOrMissing` must reject symbolic links. `atomicWrite` must create same-directory temporary file with `flag: 'wx'`, rename it, then enforce requested mode.

- [ ] **Step 4: Add REST command dispatcher**

Keep current no-command `--join-url` path as WebSocket compatibility. Dispatch explicit first arg:

```js
const command = process.argv.find((value) => ['join', 'turn', 'move', 'status', 'result'].includes(value));
if (command === 'join') await runJoin(args);
else if (command === 'turn') await runTurn(args);
else if (command === 'move') await runMove(args);
else if (command === 'status') await runStatus(args);
else if (command === 'result') await runResult(args);
else await runWebSocket(args);
```

`join` fetches invitation contract, POSTs `connection.rest.claimUrl`, fetches `/agent-play.js` from same origin, stores:

```js
{
  version: 1,
  serverUrl: new URL(joinUrl).origin,
  matchId: claimed.matchId,
  color: claimed.color,
  sessionToken: claimed.sessionToken,
  lastSuccessfulStep: 'session_claimed',
  lastTurnId: null,
}
```

Output `session.ready` with `matchId`, `seat`, `clientPath`, and exact next command—never token.

- [ ] **Step 5: Implement `turn`, `move`, `status`, `result`**

Use one request helper:

```js
async function requestJson(url, { token, method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status, value.error);
  return value;
}
```

`turn` calls bounded wait endpoint, then legal-move endpoint, saves `legal_moves_received`, emits one combined object.

`move` parses `--json`, submits exact body, saves `move_accepted` only after accepted response, and preserves idempotent `replayed`.

`status` authenticates through result endpoint, reads public match snapshot, derives:

```js
{
  session: 'valid',
  match: snapshot.status,
  turnId: snapshot.activeTurn?.turnId ?? null,
  waitingOn: snapshot.status !== 'active' ? 'none'
    : snapshot.activeTurn?.seatKind === 'agent' ? 'agent' : 'server',
  lastSuccessfulStep: session.lastSuccessfulStep,
  nextAction: snapshot.status !== 'active' ? 'read_result'
    : snapshot.activeTurn?.seatKind === 'agent' ? 'submit_or_fetch_turn' : 'retry_turn',
}
```

`result` emits status/result/PGN; terminal result removes match directory after output is written.

- [ ] **Step 6: Add stable local error mapping**

Every command failure emits:

```js
{
  type: 'connector.error',
  code,
  phase,
  recoverable,
  matchId,
  turnId,
  nextAction,
}
```

Map `INVITATION_EXPIRED`, `INVITATION_ALREADY_CLAIMED`, `SESSION_NOT_FOUND`, `SESSION_INVALID`, `UNAUTHORIZED`, `SERVER_UNREACHABLE`, `STALE_TURN`, `MOVE_NOT_LEGAL`, `CONFLICTING_REPLAY`, and `MATCH_TERMINAL`. Keep raw stack plus local paths out of stdout.

- [ ] **Step 7: Run focused tests to verify GREEN**

Run:

```bash
node --test test/connector-play.test.js
```

Expected: all connector-play tests PASS.

---

### Task 2: REST Invitation and Copied Full-Match Prompt

**Files:**
- Modify: `src/server.js`
- Modify: `public/app.js`
- Modify: `test/server.test.js`
- Modify: `test/ui.test.js`

**Interfaces:**
- Consumes: existing invitation ticket plus `agentAccess.claimInvitation`.
- Produces: `connection.rest.claimUrl` in self-describing invitation; copied `join` command; autonomous short-command loop instructions.

- [ ] **Step 1: Write failing invitation-contract test**

Replace WebSocket-only assertion with:

```js
assert.deepEqual(Object.keys(contract.connection).sort(), ['rest', 'websocket']);
assert.equal(
  contract.connection.rest.claimUrl,
  `${address.httpUrl}/api/agent/claim?ticket=${encodeURIComponent(ticket.ticket)}`,
);
assert.equal(contract.connection.websocket.url, `${address.wsUrl}${ticket.wsPath}`);
```

Assert GET invitation remains non-consuming; REST claim consumes ticket; second REST/WebSocket claim fails.

- [ ] **Step 2: Write failing prompt tests**

Require:

```js
assert.match(command, / -- join --join-url /);
assert.match(prompt, /Run returned turn command/);
assert.match(prompt, /Run status after any command failure/);
assert.match(prompt, /same match and seat/);
assert.match(prompt, /Continue until game\.end/);
assert.doesNotMatch(prompt, /Keep connector process running/);
assert.match(prompt, /Never use random, preference-list, engine, or first-legal fallback/);
```

Keep existing assertions for no checkout/install, direct model move ownership, bounded trace, confidence, elapsed time, and no private reasoning.

- [ ] **Step 3: Run server/UI tests to verify RED**

Run:

```bash
node --test test/server.test.js test/ui.test.js
```

Expected: invitation REST contract and new copied prompt assertions FAIL.

- [ ] **Step 4: Expose REST claim in invitation contract**

In `invitationContract`, derive HTTP origin from request and add:

```js
connection: {
  rest: {
    claimUrl: `${request.socket.encrypted ? 'https:' : 'http:'}//${host}/api/agent/claim?ticket=${encodeURIComponent(ticket)}`,
  },
  websocket: { url: `${protocol}//${host}/agent?ticket=${encodeURIComponent(ticket)}` },
},
```

Keep ticket absent from snapshots, exports, public activity, and error bodies.

- [ ] **Step 5: Switch copied command to `join`**

Change `buildAgentPlayCommand` return:

```js
return `node --input-type=module --eval ${shellQuote(bootstrap)} -- join --join-url ${shellQuote(joinUrl)}`;
```

Rewrite handoff steps:

```text
1. Run join command immediately.
2. Run returned turn command.
3. Evaluate turn.ready plus authoritative legal moves.
4. Run returned client with move --match ... --json ...
5. On any command/process failure, run status for same match and follow nextAction.
6. Repeat turn/choose/move until game.end; never create another match for transport reconnect.
```

Describe invitation honestly as transcript-exposed, one-use, match/seat-scoped bootstrap credential.

- [ ] **Step 6: Run server/UI tests to verify GREEN**

Run:

```bash
node --test test/server.test.js test/ui.test.js
```

Expected: all server and UI tests PASS.

---

### Task 3: Docs, Full Verification, and Cache Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/protocol-2.0.md`
- Modify: `docs/reference/AGENT_API.md`
- Modify: `test/connector-play.test.js`
- Modify: `test/ui.test.js`

**Interfaces:**
- Consumes: final command/error contracts from Tasks 1–2.
- Produces: operator docs and full regression evidence.

- [ ] **Step 1: Update operator docs**

Document exact `join`, `turn`, `move`, `status`, `result` flow. Remove requirement to keep copied connector process alive. State:

```text
Invitation is one-use bootstrap. Durable REST session remains valid for same match and seat across client-process exits. Start fresh invitation only when local session is missing/invalid or server rejects token; never create fresh match for transport recovery.
```

Correct protocol drift: invitation expires after 180 seconds; public exhibition decision deadline is server-enforced after REST turn delivery.

- [ ] **Step 2: Add prompt-cache contract test**

Assert copied prompt:

```js
assert.match(prompt, /same agent task/);
assert.match(prompt, /Do not launch another model process/);
assert.match(prompt, /compact turn/);
assert.doesNotMatch(prompt, /--command|simple-agent/i);
assert.match(prompt, /Never use random, preference-list, engine, or first-legal fallback/);
```

This protects architecture. Provider cache-hit metrics remain manual acceptance evidence because connector does not own provider API.

- [ ] **Step 3: Run focused suites**

Run:

```bash
node --test test/connector-play.test.js test/server.test.js test/ui.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 4: Run full suite**

Run:

```bash
npm test
```

Expected: zero failures.

- [ ] **Step 5: Run static and privacy checks**

Run:

```bash
git diff --check
rg -n "sessionToken|ticket" public/agent-play.js public/app.js src/server.js
```

Inspect every output path; confirm token/ticket values appear only in request construction or protected session serialization, never `emit`, `console`, public activity, snapshot, export, or trace.

- [ ] **Step 6: Record worktree boundary**

Report exact implementation files, test counts, HEAD, branch, plus pre-existing dirty files. Do not stage or commit unrelated user changes.
