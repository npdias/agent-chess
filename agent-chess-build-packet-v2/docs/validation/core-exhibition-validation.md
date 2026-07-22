# Core exhibition validation

Status: **PARTIAL — no-go for clock/polish acceptance.**

Validation baseline: `93fd7dc8b9f515738d1b83939de2aad038f5eddf`.

## Environment

- Node `v22.23.1`; npm `10.9.8`.
- Server: `npm start` at `http://127.0.0.1:3000`; pre-browser probe returned `200`.
- `npm ci --registry=https://registry.npmjs.org` completed: `added 3 packages in 1s`.

## Automated checks

| Command | Result |
| --- | --- |
| `npm test` | PASS — 161 tests, 161 pass, 0 fail; 2132.081417 ms. Initial sandbox-only run had 143 pass/17 `listen EPERM`; elevated loopback run is authoritative. |
| `node --test test/stockfish.test.js` | PASS — 2 tests, 2 pass. Added regression covers two sequential real engine starts. |
| `npm audit --audit-level=high` | NOT RUN TO COMPLETION — sandbox DNS returned `getaddrinfo ENOTFOUND registry.npmjs.org`; elevated audit was rejected because it would send dependency metadata to registry. No vulnerability result is claimed. |

## Smoke matrix

All commands targeted one owned `npm start` process at `127.0.0.1:3000`.

| Command | Result |
| --- | --- |
| `npm run smoke:human -- --server http://127.0.0.1:3000 --color white --turns 3` | PASS — match `4d805214-5699-4ac2-ae6a-d36e1cced0bc`; 6 plies; active. |
| `npm run smoke:human -- --server http://127.0.0.1:3000 --color black --turns 3` | PASS — match `981b9fae-a428-49c3-9689-b6cc4fbc309f`; 7 plies; active. |
| `npm run smoke -- --server http://127.0.0.1:3000 --turns 3` | PASS — public generic agent match `bb9a3123-53a4-4296-afcb-b1362f56ca39`; 6 plies; `ok: true`. |

Smoke stdout was retained only as redacted fields above: match IDs, plies, result/status, public URL. No capability was recorded.

## Fix discovered during smoke

White smoke passed, then Black creation returned `HTTP_503`. Server stderr showed the `stockfish` generated WASM module aborting on a second initialization after a prior engine closed. `StockfishEngine.start` is sole shared real-engine path; cached generated module state was root cause. It now removes only `stockfish-18-lite-single.js` from Node's require cache before starting a fresh engine. Regression starts, searches, closes two engines in one process. Rerun matrix passed.

Browser initially logged one non-product `GET /favicon.ico` 404. Added explicit empty favicon link; reload had 0 console errors/warnings.

## Browser evidence

Playwright CLI used snapshots before refs, then local browser checks.

| Evidence | Viewport / dimensions | Findings |
| --- | --- | --- |
| [human-engine-desktop.png](screenshots/human-engine-desktop.png) | 1440x900 image; board 610x610; squares 76.25x76.25; rail 440x820; board-to-rail gap 16px | Square, seam-free board; human selected `e2`; authoritative legal targets `e3`, `e4`; phase `Observe`; activity visible. No board clipping or horizontal overflow. Page vertical scroll exists: 841px stage plus chrome exceeds viewport. |
| [human-engine-mobile.png](screenshots/human-engine-mobile.png) | 390x844 image; board 366x366; squares 45.75x45.75; rail 366px wide | Board square/untrimmed; no horizontal overflow; phase above board; activity directly below board in document flow. Vertical scrolling required to reach rail. |
| [human-agent-spectator.png](screenshots/human-agent-spectator.png) | 1440x900 image | Public generic-agent review shows structured connector/system activity and candidates. All 64 square buttons are disabled; URL has only `match`, no capability. |

After favicon fix, browser console: 0 errors, 0 warnings. Dynamic network requests observed only successful `GET /api/matches/:id` (200); match create POST was 201. Public snapshot and `/export` were checked for `capabilities`, `seatToken`, `ticket`, `authorization`, and `capability` fields: no matches.

## Plan comparison

- Step 1: install PASS; full tests PASS; audit BLOCKED externally.
- Step 2: PASS; both human colors and generic public agent reached required three accepted turns.
- Step 3: PARTIAL; White visual human input/legal selection proved. Black UI orientation, drag, touch target measurement, promotion fixture, abort/resign/export/PGN/observer complete-flow proof were not all run.
- Step 4: PARTIAL; generic public agent 6 plies plus spectator activity/authority proof passed. Required human-versus-agent ten-ply live proof was not run.
- Step 5: PARTIAL; required desktop/mobile screenshots pass board geometry checks. Desktop one-viewport fit fails due vertical page overflow; rail needs scrolling on mobile by design.
- Step 6: this report records exact evidence and gaps.
- Step 7: validation evidence is staged for commit after final full-suite rerun.

## Known limits / next decision

No-go for follow-on clock/polish acceptance until audit completes in an approved network context and missing manual proof matrix closes. Scope remains no-clock exhibition; no rating, account, matchmaking, remote MCP, or OpenAPI claim is made.
