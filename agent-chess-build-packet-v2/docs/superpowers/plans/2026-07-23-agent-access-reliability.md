# Agent Access Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a remote agent claim one invitation, play an entire match through documented REST or hosted MCP tools, publish bounded public decision summaries, reconnect safely, and finish only on authoritative game termination.

**Architecture:** Existing `MatchSession` remains sole chess authority. Add a durable agent-access service around current seat bindings, expose it through REST first, then a thin official MCP SDK adapter. Existing WebSocket connector remains compatible. UI handoff advertises MCP first, REST second, WebSocket CLI third.

**Tech Stack:** Node.js 22, `node:http`, `chess.js`, `ws`, official `@modelcontextprotocol/sdk` v1, `zod`, Node test runner.

## Global Constraints

- Hosted service never receives caller model credentials, private prompts, local files, private memory, or raw chain-of-thought.
- Public activity contains only bounded structured summaries: position assessment, threats, up to three candidate moves, selected move, confidence, elapsed thinking time.
- `MatchSession` remains authoritative for turn identity, legality, lifecycle, PGN, and terminal result.
- Invitation claim window is exactly `180_000` milliseconds.
- Invitation URL is single-use. Successful claim returns an opaque durable session token usable until match termination.
- Move submission is idempotent for the same `turnId` plus `moveUci`; conflicting replay returns `409`.
- No random, preference-list, engine, or first-legal fallback may select moves in direct-model flow.
- Existing WebSocket protocol 2.0 and CLI connector behavior remain compatible.
- Page remains zero-scroll at `1280x720`; no new always-visible match rail card.
- Use official MCP TypeScript SDK Streamable HTTP transport. Do not hand-roll MCP JSON-RPC.

---

### Task 1: Durable REST Agent Access

**Files:**
- Create: `src/agent-access.js`
- Modify: `src/server.js`
- Modify: `src/protocol.js`
- Test: `test/agent-access.test.js`
- Test: `test/server.test.js`

**Interfaces:**
- Produces: `createAgentAccessService({ now, tokenFactory })`
- Produces service methods: `registerInvitation`, `describeInvitation`, `claimInvitation`, `authenticate`, `joinMatch`, `awaitTurn`, `listLegalMoves`, `publishDecision`, `submitMove`, `getResult`, `closeSession`.
- REST endpoints consume bearer session token after claim:
  - `POST /api/agent-connections`
  - `GET /api/agent/match`
  - `GET /api/agent/turn?after=<turnId>&waitMs=<0..25000>`
  - `GET /api/agent/legal-moves?turnId=<turnId>`
  - `POST /api/agent/decision`
  - `POST /api/agent/move`
  - `GET /api/agent/result`
- Existing invitation endpoint produces `connection.rest.claimUrl`, `connection.mcp.url`, `connection.websocket.url`, schemas, action order, retry semantics.

- [ ] **Step 1: Write failing service tests**

Test exact behaviors: 180-second expiry, one successful claim, second claim `INVITATION_ALREADY_CLAIMED`, durable session auth, terminal session read, idempotent same-move replay, conflicting replay, bounded long-poll timeout.

- [ ] **Step 2: Run RED tests**

Run: `node --test --test-concurrency=1 test/agent-access.test.js`

Expected: FAIL because `src/agent-access.js` does not exist.

- [ ] **Step 3: Implement minimal service**

Use in-memory Maps. Session token is opaque random base64url. Store binding, claimed timestamp, last accepted `{turnId, moveUci, result}`. Delegate chess actions to existing `MatchSession` methods.

- [ ] **Step 4: Write failing REST integration tests**

Create public agent-vs-fake-engine match, mint invite, fetch contract, claim invite, read turn, list legal moves, publish sanitized status, submit structured decision, replay same request, wait for next agent turn, read terminal result. Assert secrets absent from public snapshots and exports.

- [ ] **Step 5: Run RED integration tests**

Run: `node --test --test-concurrency=1 test/server.test.js`

Expected: FAIL on missing agent REST routes or old 60-second expiry.

- [ ] **Step 6: Add REST routes and shared server action hooks**

Route all actions through agent-access service. Keep existing WebSocket handlers using same underlying `MatchSession`. Reject missing/invalid bearer token with `401`; stale/conflicting turns with `409`; malformed body with `400`.

- [ ] **Step 7: Run GREEN tests**

Run: `node --test --test-concurrency=1 test/agent-access.test.js test/server.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/agent-access.js src/server.js src/protocol.js test/agent-access.test.js test/server.test.js
git commit -m "feat: add durable agent REST sessions"
```

### Task 2: Hosted MCP Tool Surface

**Files:**
- Create: `src/mcp.js`
- Modify: `src/server.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/mcp.test.js`

**Interfaces:**
- Consumes agent-access service from Task 1.
- Produces `createAgentChessMcpServer({ access, sessionToken })`.
- Exposes Streamable HTTP at `POST|GET|DELETE /mcp`.
- Exposes exactly seven tools:
  - `join_match`
  - `await_turn`
  - `list_legal_moves`
  - `publish_status`
  - `publish_decision`
  - `submit_move`
  - `get_result`

- [ ] **Step 1: Install official SDK**

Run: `npm install @modelcontextprotocol/sdk@^1 zod@^4`

Expected: package and lock files contain public npm registry dependencies.

- [ ] **Step 2: Write failing MCP tests**

Use official SDK client and `StreamableHTTPClientTransport`. Assert initialization against invite-scoped `/mcp?ticket=...`, deterministic tool list, join, turn read, legal moves, bounded public decision, move submission, result read, invalid/expired ticket rejection.

- [ ] **Step 3: Run RED tests**

Run: `node --test --test-concurrency=1 test/mcp.test.js`

Expected: FAIL because MCP endpoint and adapter do not exist.

- [ ] **Step 4: Implement minimal MCP adapter**

Use official `McpServer`, `StreamableHTTPServerTransport`, `zod`. Claim invitation once when initializing transport; bind durable agent session to MCP transport. Tool callbacks call Task 1 service only. Return `structuredContent` plus JSON text. Convert domain failures to MCP tool errors without secrets or stack traces.

- [ ] **Step 5: Add transport routing and cleanup**

Validate `Origin` when present. Allow configured public host plus localhost development origins. Route subsequent requests by `Mcp-Session-Id`. Close transport and durable access session on DELETE or server stop. Never place durable session token in tool output.

- [ ] **Step 6: Run GREEN tests**

Run: `node --test --test-concurrency=1 test/mcp.test.js test/server.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/mcp.js src/server.js package.json package-lock.json test/mcp.test.js test/server.test.js
git commit -m "feat: expose hosted Agent Chess MCP tools"
```

### Task 3: Agent Handoff, UI State, and Operator Docs

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `README.md`
- Create: `docs/reference/AGENT_API.md`
- Create: `llms.txt`
- Test: `test/ui.test.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes invitation contract from Task 1 and MCP URL from Task 2.
- Produces copy modes `Copy full prompt` and `Copy link only` without adding visible cards.
- Produces `/llms.txt` discovery map through existing static server.

- [ ] **Step 1: Write failing UI and docs tests**

Assert copied prompt orders agent to open link immediately, prefer hosted MCP, use REST fallback, keep transport automation separate from model move selection, publish bounded summaries, never choose random/first-legal fallback, retry invalid output through model, continue until `game.end`, report result. Assert copy toast says three minutes.

- [ ] **Step 2: Run RED tests**

Run: `node --test --test-concurrency=1 test/ui.test.js test/server.test.js`

Expected: FAIL on old prompt and 60-second copy.

- [ ] **Step 3: Update handoff prompt and invitation presentation**

Keep existing two copy buttons. No new card. Connected state stays collapsed. Status copy names exact turn owner. Use structured decision fields only; never display hidden reasoning.

- [ ] **Step 4: Add operator and machine discovery docs**

Document direct model play vs harness play, MCP config example, REST request sequence, WebSocket CLI fallback, token secrecy, reconnect behavior, idempotency, error codes, terminal condition.

- [ ] **Step 5: Run GREEN tests**

Run: `node --test --test-concurrency=1 test/ui.test.js test/server.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/index.html public/styles.css README.md docs/reference/AGENT_API.md llms.txt test/ui.test.js test/server.test.js
git commit -m "docs: make agent handoff self-contained"
```

### Task 4: End-to-End Reliability and Visual Validation

**Files:**
- Create: `test/agent-access-e2e.test.js`
- Modify: `docs/handoff/ACCEPTANCE_TESTS.md`
- Create: `output/ux-validation/agent-access-1280x720.png`

**Interfaces:**
- Consumes all earlier tasks.
- Produces executable proof for full match access paths and desktop layout.

- [ ] **Step 1: Write end-to-end test**

Run two fake-engine matches: REST agent as White and MCP agent as Black. Each survives more than one turn, publishes decisions, uses idempotent replay, receives terminal result, leaks no token to snapshot/export.

- [ ] **Step 2: Run focused E2E**

Run: `node --test --test-concurrency=1 test/agent-access-e2e.test.js`

Expected: PASS.

- [ ] **Step 3: Run full suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 4: Start app and capture browser proof**

Run app on loopback. At `1280x720`, create Agent vs Computer match, open copy flow, connect through REST or MCP, advance at least two plies, capture screenshot. Assert `document.documentElement.scrollHeight <= window.innerHeight`, square board, stable rail dimensions, collapsed connector, explicit turn owner.

- [ ] **Step 5: Update acceptance evidence and commit**

```bash
git add test/agent-access-e2e.test.js docs/handoff/ACCEPTANCE_TESTS.md output/ux-validation/agent-access-1280x720.png
git commit -m "test: prove hosted agent access flow"
```
