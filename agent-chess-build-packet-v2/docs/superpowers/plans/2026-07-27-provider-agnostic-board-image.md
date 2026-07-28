# Provider-Agnostic Board Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a portable PNG board image through a provider-neutral connector attachment plus protected local file on every turn.

**Architecture:** `src/board-image.js` renders deterministic PNG from authoritative FEN. `public/agent-play.js` validates and persists image bytes, then emits `attachments[]` without importing provider code. Handoff copy documents adapter mapping and prohibits unsupported visual claims.

**Tech Stack:** Node.js 22 built-ins, `node:zlib`, `node:fs/promises`, Node test runner.

## Global Constraints

- No provider SDK or model credentials in service or connector.
- FEN remains canonical source of chess truth.
- Connector transport never selects a move.
- Image file mode is `0600`; session directory mode is `0700`.
- Unsupported or malformed image payload produces explicit error, never a false visual-review claim.
- Use TDD: observe each focused test fail before production change.

---

### Task 1: Portable PNG Renderer

**Files:**
- Modify: `src/board-image.js`
- Modify: `test/game.test.js`

**Interfaces:**
- Consumes: full six-field FEN string.
- Produces: `renderBoardImage(fen) -> { type: "image", mimeType: "image/png", dataUrl, alt }`.

- [ ] **Step 1: Write failing renderer contract test**

Add assertions that decoded image begins with literal PNG signature bytes `89504e470d0a1a0a`, IHDR declares width and height `512`, color type `6`, repeated render is byte-identical, and a moved position produces different bytes.

- [ ] **Step 2: Run RED test**

Run: `node --test --test-concurrency=1 test/game.test.js`

Expected: FAIL because renderer returns `image/svg+xml`.

- [ ] **Step 3: Implement minimal deterministic PNG**

Replace SVG string generation with RGBA scanline generation, chessboard/piece token drawing, zlib compression, PNG chunk construction, and CRC-32. Return normalized image object containing `type: "image"`.

- [ ] **Step 4: Run GREEN test**

Run: `node --test --test-concurrency=1 test/game.test.js`

Expected: PASS.

### Task 2: Connector Attachment Export

**Files:**
- Modify: `public/agent-play.js`
- Modify: `test/connector-play.test.js`

**Interfaces:**
- Consumes: `turnResponse.turn.boardImage`.
- Produces: `turn.ready.attachments[0]` with `type`, `mimeType`, `dataUrl`, `alt`, `imagePath`.

- [ ] **Step 1: Write failing connector E2E test**

Extend real short-command match test to assert:

```js
const [attachment] = turn.message.attachments;
assert.equal(attachment.type, 'image');
assert.equal(attachment.mimeType, 'image/png');
assert.match(attachment.dataUrl, /^data:image\/png;base64,/);
assert.equal((await stat(attachment.imagePath)).mode & 0o777, 0o600);
assert.deepEqual(
  await readFile(attachment.imagePath),
  Buffer.from(attachment.dataUrl.split(',')[1], 'base64'),
);
```

Assert PNG signature and ensure `imagePath` starts inside connector session directory.

- [ ] **Step 2: Run RED test**

Run: `node --test --test-concurrency=1 test/connector-play.test.js`

Expected: FAIL because `attachments` is absent.

- [ ] **Step 3: Implement validated image persistence**

Add `imagePath` to `sessionPaths`, validate exact `image/png` data URL and PNG signature, atomically write bytes with `0600`, remove previous board file after successful replacement, and emit normalized `attachments`.

- [ ] **Step 4: Run GREEN test**

Run: `node --test --test-concurrency=1 test/connector-play.test.js`

Expected: PASS.

### Task 3: Handoff and API Documentation

**Files:**
- Modify: `public/app.js`
- Modify: `test/ui.test.js`
- Modify: `README.md`
- Modify: `docs/reference/AGENT_API.md`
- Modify: `docs/protocol-2.0.md`

**Interfaces:**
- Consumes: normalized connector `attachments[]`.
- Produces: provider-neutral runtime instructions.

- [ ] **Step 1: Write failing UI behavior contract**

Update handoff prompt test to require `attachments[0]`, `image/png`, mapping `dataUrl` into provider image input, inspection of `imagePath`, and `BOARD_IMAGE_UNSUPPORTED` when neither path works.

- [ ] **Step 2: Run RED test**

Run: `node --test --test-concurrency=1 test/ui.test.js`

Expected: FAIL against old conditional SVG instructions.

- [ ] **Step 3: Update handoff and human docs**

Document attachment object, provider adapter boundary, local file permissions, unsupported behavior, and FEN authority. Remove claims that raw SVG data constitutes visual review.

- [ ] **Step 4: Run GREEN test**

Run: `node --test --test-concurrency=1 test/ui.test.js`

Expected: PASS.

### Task 4: Regression and Live Validation

**Files:**
- Verify only.

**Interfaces:**
- Consumes: completed renderer, connector, prompt, docs.
- Produces: current test and live runtime evidence.

- [ ] **Step 1: Run focused suite**

Run: `node --test --test-concurrency=1 test/game.test.js test/connector-play.test.js test/ui.test.js`

Expected: PASS with no failures.

- [ ] **Step 2: Run full suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Restart local server**

Stop current port-3200 process; supervisor restarts service from current checkout.

- [ ] **Step 4: Run live connector validation**

Create temporary agent-versus-human match through local API, mint invitation, join through served `/agent-play.js`, fetch turn, and validate normalized attachment, protected file, PNG signature, and byte parity. Do not print invitation or session credentials. End temporary match and remove connector session artifacts.

- [ ] **Step 5: Report evidence**

Report exact test count, live validation result, changed files, and remaining provider-adapter responsibility.
