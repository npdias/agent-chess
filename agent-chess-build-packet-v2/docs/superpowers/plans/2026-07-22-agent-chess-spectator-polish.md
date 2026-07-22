# Agent Chess Spectator Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent onboarding self-describing, make live reasoning summaries easy to follow, keep desktop match UI inside one viewport, animate piece moves without exposing private chain-of-thought.

**Architecture:** Keep server authoritative. Extend short-lived agent ticket exchange with read-only self-describing join contract. Recompose existing vanilla HTML/CSS/JS around current-decision-first rail. Preserve board nodes across position updates, then animate piece movement through transforms without adding GPL dependencies.

**Tech Stack:** Node.js HTTP, `ws`, vanilla ES modules, CSS Grid, Node test runner, in-app Browser screenshots.

## Global Constraints

- Agent invitation URL is bearer material: single-use WebSocket claim, 60-second expiry, `Cache-Control: no-store`, no capability in public match state/export.
- Initial HTTP GET of agent invitation URL returns every instruction needed to connect and play protocol 2.0.
- Hosted service never receives caller model credentials, prompts, or private reasoning.
- Public UI shows structured decision summaries, candidates, selected move, disclosure source; never labels content raw chain-of-thought.
- Board remains fixed 1:1; entire board, player strips, current phase, primary rail fit 1280x720 without page clipping.
- System/debug events remain available but collapsed by default.
- Piece transitions use stable DOM nodes; `prefers-reduced-motion: reduce` disables motion.
- Preserve existing match modes, lifecycle actions, replay, steering, export, sharing, promotion flow, keyboard semantics.
- New behavior follows literal RED -> GREEN tests before production edits.

---

### Task 1: Self-describing agent invitation

**Files:**
- Modify: `src/server.js`
- Modify: `test/server.test.js`
- Modify: `docs/protocol-2.0.md`

**Interfaces:**
- Produces: `POST /api/agent-sessions` response containing `joinPath` beside existing `wsPath`.
- Produces: `GET /agent/join?ticket=...` JSON contract.
- Contract fields: `service`, `protocolVersion`, `match`, `seat`, `security`, `connection`, `instructions`, `messageFlow`, `publicTrace`.

- [ ] **Step 1: Write failing server tests**

Add tests proving session response includes `/agent/join?ticket=...`; invitation GET returns 200 plus protocol 2.0 contract, absolute WebSocket URL, match/seat data, no-store headers; expired/unknown ticket returns 410; GET does not consume ticket; first WebSocket claim works; second claim fails; public snapshot/export contain neither ticket nor join URL.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-concurrency=1 test/server.test.js`

Expected: FAIL because `joinPath` plus HTTP join contract do not exist.

- [ ] **Step 3: Implement minimal contract**

Store `matchId`, `color`, expiry in existing ticket binding. Return:

```js
{
  ticket,
  wsPath: `/agent?ticket=${encodeURIComponent(ticket)}`,
  joinPath: `/agent/join?ticket=${encodeURIComponent(ticket)}`,
  expiresAt: expiresAt.toISOString(),
}
```

Serve JSON contract only for currently valid ticket. Build `wsUrl` from request protocol/host, mapping `http:` -> `ws:` plus `https:` -> `wss:`. Include exact action order: open WebSocket, wait for `match.start` plus `turn.start`, optionally request probes, publish only sanitized status, submit legal UCI plus bounded `publicTrace`, handle accepted/rejected/end. State that URL is secret, expires, remains single-use for connection, raw reasoning must stay local.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test --test-concurrency=1 test/server.test.js`

Expected: PASS.

- [ ] **Step 5: Update protocol docs**

Document invitation URL, supported harness requirements (HTTP + WebSocket), one-use/expiry behavior, JSON contract, privacy boundary.

- [ ] **Step 6: Commit**

```bash
git add src/server.js test/server.test.js docs/protocol-2.0.md
git commit -m "feat: add self-describing agent invitation"
```

---

### Task 2: Spectator-first match hierarchy and onboarding

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/ui.test.js`

**Interfaces:**
- Consumes: Task 1 `joinPath`.
- Produces: `buildAgentInviteUrl(origin, joinPath)`.
- Produces: `selectDecisionBrief(match)` returning current/recent structured decision data without system noise.

- [ ] **Step 1: Write failing UI tests**

Add tests proving UI includes primary `Copy agent link`, native `details` terminal fallback, collapsed technical activity, current decision brief, compact status line, preserved lifecycle/export/share/focus/steering/moves controls. Add pure-function tests for absolute invite URL, decision selection, truthful empty/working/failed states, sanitized rendering. Add CSS contract asserting desktop 1280x720 fit formula, three-surface rail, connector collapse after connection, mobile stacking.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-concurrency=1 test/ui.test.js`

Expected: FAIL because new hierarchy plus invite helpers do not exist.

- [ ] **Step 3: Recompose match UI**

Replace duplicate status grid/ribbon/activity competition with:

1. Compact status bar: side to move + visible phase.
2. `Agent decision` card: intent/summary, 2-4 candidate rows, selected move, disclosure source. Current agent work uses truthful phase copy; no invented candidates.
3. Compact move history.
4. Native `details` for steering plus technical activity.
5. Match actions grouped in one footer/card.

On owned agent seat, onboarding card shows three short steps, connection state, primary `Copy agent link`, secondary terminal fallback. Mint ticket on button action, build absolute invite URL from `joinPath`, copy it, show expiry feedback. Terminal fallback mints fresh ticket on its own button; never render live secret until explicit user action. Once connected, collapse card to connected confirmation.

- [ ] **Step 4: Tighten responsive layout**

At desktop >=1021px use board size bounded by viewport after compact chrome. Keep whole board/player/footer visible at 1280x720. Rail aligns to board-stage content height and scrolls internally only when unavoidable. At <=1020px stack rail. At <=720px keep primary actions full-width plus touch targets >=44px.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test --test-concurrency=1 test/ui.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/styles.css test/ui.test.js
git commit -m "feat: streamline spectator and agent onboarding UI"
```

---

### Task 3: Stable board rendering and smooth move transitions

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/ui.test.js`

**Interfaces:**
- Produces: stable board initialization plus keyed piece reconciliation.
- Produces: move animation derived from previous/current FEN plus last accepted UCI.

- [ ] **Step 1: Write failing UI tests**

Add tests proving board render does not call `replaceChildren()` on every position update, creates 64 square nodes once, reconciles keyed piece nodes, uses transform transition class, clears animation state, keeps flip/replay/selection behavior, disables transitions under reduced motion.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-concurrency=1 test/ui.test.js`

Expected: FAIL because current renderer destroys all square/piece nodes.

- [ ] **Step 3: Implement stable board renderer**

Initialize 64 square buttons once per orientation. Update square state, labels, events, coordinates in place. Reconcile piece spans by square. For accepted live move, preserve moving node and animate translated offset to zero using two animation frames; fade captured node; skip animation during replay, initial render, board flip, pending human submission. Serialize a new board update until current <=220ms transition completes.

- [ ] **Step 4: Add motion CSS**

Use transform/opacity only. Default duration 190ms ease-out. Add `will-change` only during animation. Under `@media (prefers-reduced-motion: reduce)`, force board piece transitions/animations off.

- [ ] **Step 5: Run focused then full tests**

Run: `node --test --test-concurrency=1 test/ui.test.js`

Expected: PASS.

Run: `npm test`

Expected: 0 failures.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/styles.css test/ui.test.js
git commit -m "feat: animate stable chess piece transitions"
```

---

### Task 4: Browser behavior plus screenshot validation

**Files:**
- Create: `output/ux-validation/01-new-match.png`
- Create: `output/ux-validation/02-agent-invite.png`
- Create: `output/ux-validation/03-agent-contract.png`
- Create: `output/ux-validation/04-live-decision.png`
- Create: `output/ux-validation/05-focus-mode.png`
- Create: `output/ux-validation/06-mobile.png`
- Create: `docs/validation/spectator-polish-validation.md`

**Interfaces:**
- Consumes: Tasks 1-3 completed app.

- [ ] **Step 1: Start clean app server**

Run: `npm start` on available loopback port.

- [ ] **Step 2: Validate setup behavior in Browser**

Check all matchup choices, color labels, engine-skill visibility, keyboard labels, Create match. Capture 01.

- [ ] **Step 3: Validate agent invitation flow**

Create My agent vs Computer. Check invite card, copy agent link, open copied link, inspect complete JSON contract, verify terminal fallback, connected/expired states. Capture 02 plus 03.

- [ ] **Step 4: Validate live match flow**

Connect deterministic reference agent. Check phase/status, decision summary/candidates/choice, technical details collapsed/default, moves/replay, flip, share, PGN, focus mode, export, lifecycle confirmation/post-match state. Capture 04 plus 05.

- [ ] **Step 5: Validate geometry plus mobile**

At 1280x720 verify page has no vertical clipping, board square, rail hierarchy visible. At mobile viewport verify stacking, controls, modal fit. Capture 06.

- [ ] **Step 6: Record exact evidence**

Write viewport metrics, tested interactions, screenshot paths, limits, automated test count in validation doc.
