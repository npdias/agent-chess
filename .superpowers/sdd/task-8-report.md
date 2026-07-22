# Task 8 Integration Report

Status: DONE_WITH_CONCERNS

Commit: `5235e27 fix: deduplicate turn start activity`

## Root-cause trace

Observed RED: `NO_MOVABLE_PIECE` at `src/connector.js:30`, called from `bin/smoke-agent.js:57`.

`lsof -nP -iTCP:3000 -sTCP:LISTEN` identified PID `84880`, cwd `/Users/nicholasdias/Documents/Chess Bench/agent-chess-build-packet-v2`, not this Task 8 worktree. Its `turn.start` payload had legacy fields `legalMoves` and `deadlineMs`, omitted Protocol 2.0 `positionStatus.movablePieces`. Smoke targeted that unrelated process, then connector correctly had no movable square to probe. Isolated current-worktree server passed smoke without a connector change.

## Regression fix

RED test: `node --test --test-concurrency=1 test/match.test.js` failed `2 !== 1` for `records turn start activity once when recreating an active turn payload`.

GREEN: `MatchSession#createTurnPayload` now records `turn.start` only when it creates a new turn ID. Repeated payloads retain same ID, produce no duplicate activity.

## Verification

- `npm ci` → installed 3 packages, audited 4 packages, 0 vulnerabilities.
- Focused test → 17/17 pass.
- `npm test` → 75/75 pass, 0 failures.
- `npm audit --audit-level=high` → 0 vulnerabilities.
- One `PORT=3101 npm start` server → two `npm run smoke -- --server http://127.0.0.1:3101 --turns 3` runs passed: match IDs `e912de55-aedd-4eeb-8576-e915ecf083d1` and `bf418324-0f42-42ad-8155-e4e293a3d954`; each reported `ok: true`, `plies: 6`.
- Same server remained healthy: `server_health_http=200`.

## Concerns

- Browser visual verification intentionally not run; root owns desktop/mobile checks.
- Bare `:3000` is already occupied by unrelated legacy checkout in this environment. Integration commands need a known free port or explicit server ownership check.
