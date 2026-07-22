# Agent Chess Playable Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a local hosted-style proof where a WebSocket-connected agent plays a complete standard chess game against Stockfish while a browser observes the board and steering state.

**Architecture:** A single Node.js process owns authoritative game state through chess.js, exposes HTTP UI/API routes, and accepts one agent seat over WebSocket. A small Stockfish UCI adapter runs the npm Stockfish.js binary. The browser is read-only except for match creation and optional turn-boundary steering; the CLI smoke agent proves the external harness contract.

**Tech Stack:** Node.js 22, chess.js 1.4, ws 8.18, Stockfish.js 18, Node test runner, vanilla HTML/CSS/JS.

## Global Constraints

- Standard chess only.
- FEN is authoritative board state; moves use UCI/LAN coordinate notation.
- Every agent turn includes the complete legal move list.
- Server independently validates every move.
- Steering mode is fixed at match creation: `locked` or `trainer`.
- Steering applies only to the next turn and never changes a currently executing turn.
- No model credentials, prompts, private reasoning, or local files are accepted by the server.
- The chessboard remains the dominant UI element.

---

### Task 1: Chess game domain

**Files:**
- Create: `src/game.js`
- Test: `test/game.test.js`

**Interfaces:**
- Produces: `AgentChessGame`, `toUci(move)`, `snapshot()`.

- [x] Write failing tests for legal move exposure, legal submission, illegal rejection, and PGN export.
- [x] Run `npm test -- test/game.test.js` and verify missing module failure.
- [x] Implement the minimal chess.js wrapper.
- [x] Run the test and verify pass.

### Task 2: Steering and match state

**Files:**
- Create: `src/match.js`
- Test: `test/match.test.js`

**Interfaces:**
- Consumes: `AgentChessGame`.
- Produces: `MatchSession`, `createTurnPayload()`, `queueSteering()`, `submitAgentMove()`.

- [x] Write failing tests for locked steering, trainer steering, and stale turn rejection.
- [x] Run the focused tests and verify failure.
- [x] Implement the minimal session state machine.
- [x] Run all tests and verify pass.

### Task 3: Stockfish UCI adapter

**Files:**
- Create: `src/stockfish.js`
- Test: `test/stockfish.test.js`

**Interfaces:**
- Produces: `StockfishEngine.start()`, `bestMove(fen, options)`, `close()`.

- [x] Write a failing integration test asserting a legal best move from the initial FEN.
- [x] Verify failure before implementation.
- [x] Implement a queued UCI process wrapper around the installed Stockfish CLI.
- [x] Run the integration test and verify pass.

### Task 4: HTTP and WebSocket server

**Files:**
- Create: `src/server.js`
- Create: `src/protocol.js`
- Test: `test/server.test.js`

**Interfaces:**
- Produces: `createAgentChessServer()` and protocol messages `match.start`, `turn.start`, `move.submit`, `move.accepted`, `move.rejected`, `game.end`.

- [x] Write failing API/WebSocket tests for match creation and first agent turn.
- [x] Verify failure.
- [x] Implement server routes, seat tokens, broadcasts, and Stockfish response loop.
- [x] Run tests and verify pass.

### Task 5: Browser proof UI

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/styles.css`

**Interfaces:**
- Consumes: `/api/matches`, `/api/matches/:id`, `/events` WebSocket.

- [x] Add a DOM fixture test for board coordinate mapping and move rendering helper.
- [x] Verify failure.
- [x] Implement a board-first read-only UI with match status, agent trace, steering pane, and move list.
- [x] Run all tests.

### Task 6: External harness proof and documentation

**Files:**
- Create: `bin/smoke-agent.js`
- Create: `README.md`
- Create: `LICENSES.md`

**Interfaces:**
- Consumes: agent seat WebSocket protocol.

- [x] Write a smoke test that creates a match, connects a simple legal-move agent, and reaches multiple plies.
- [x] Implement the CLI connector and runnable instructions.
- [x] Run `npm test`, start the server, run the smoke agent, and verify browser/API state.
