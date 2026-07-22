# Core exhibition validation

Status: **PARTIAL — external audit remains blocker.**

Validated code commit: `ecfa6b4cca56ea57a938f92f69bc4fe21fa80400`.

## Environment

- Node `v22.23.1`; npm `10.9.8`.
- Server: `npm start` at `http://127.0.0.1:3000`; pre-browser probe returned `200`.
- `npm ci --registry=https://registry.npmjs.org` completed: `added 3 packages in 1s`.

## Automated checks

| Command | Result |
| --- | --- |
| `npm test` | PASS — 161 tests, 161 pass, 0 fail; 2132.081417 ms. Initial sandbox-only run had 143 pass/17 `listen EPERM`; elevated loopback run is authoritative. |
| `node --test test/stockfish.test.js` | PASS — 2 tests, 2 pass. Added regression covers two sequential real engine starts. |
| `npm audit --audit-level=high` | BLOCKED — sandbox DNS returned `getaddrinfo ENOTFOUND registry.npmjs.org`; required elevated retry was rejected because it would send dependency metadata to registry. No vulnerability result is claimed. |

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

## Core matrix artifact

`node bin/validate-core-matrix.mjs http://127.0.0.1:3000` produced tracked [task8-core-matrix.json](evidence/task8-core-matrix.json): public match `3ff4a676-9764-4ce1-a275-f9ca67b23ff5`, 12 plies (6 human, 6 agent), 33 observer state messages, accepted structured agent decision, spectator human-submit `401`, public export PGN present, no capability value/name leak. Separate lifecycle checks: abort-before-move `202`, resign-after-start `202`, public export `200`. Runner output contains only public match ID and booleans/status/counts.

The artifact is deterministic API/WebSocket proof, not a manual pointer/touch session. `node --test test/board-interaction.test.js` passed 21/21: source selection, legal targets, click/drag suppression, ownership gating, and promotion-choice fixture (including `e7e8q` / `e7e8r`).

[task8-board-geometry.json](evidence/task8-board-geometry.json) records DOM geometry: desktop has eight equal 76.25px tracks and zero measured inter-track gaps; mobile has eight equal 45.75px tracks. This is geometry evidence only, not pixel-level dark-seam detection.

## Browser evidence

Playwright CLI used snapshots before refs, then local browser checks.

| Evidence | Viewport / dimensions | Findings |
| --- | --- | --- |
| [human-engine-desktop.png](screenshots/human-engine-desktop.png) | 1440x900 image; board 610x610; squares 76.25x76.25; rail 440x820; gap 16px; scrollHeight/clientHeight was not retained for this earlier capture | Square board; `e2` selected; legal targets `e3`, `e4`; phase/activity visible. |
| [human-engine-mobile.png](screenshots/human-engine-mobile.png) | 390x844 image; Human Black vs engine; board 366x366; squares 45.75x45.75; scrollHeight/clientHeight `1899/844` | Live pointer-drag `e7→e5` produced `POST /human-moves` `202`; engine first moved `g1f3`; Black home rank (`h8…a8`) was nearest. Board square/unclipped; horizontal overflow false; phase/activity clear; console 0 errors/warnings. Long activity/move history causes vertical scroll. |
| [human-agent-spectator.png](screenshots/human-agent-spectator.png) | 1440x900 image; board 610x610; rows 76.25px; gap 16px; scrollHeight/clientHeight `905/900`; horizontal overflow `false` | Public 12-ply human-agent activity visibly includes accepted candidate plus rationale. DOM inspection counted exactly 64 disabled square controls. Screenshot does not itself prove count. |
| [human-agent-ui-disabled.png](screenshots/human-agent-ui-disabled.png) | Browser-created Human vs My agent; after UI click `e2→e4` | Real UI request returned `202`; current agent turn had 64 disabled and 0 enabled board controls. Console had 0 errors/warnings; network captured create `201`, state `200`, human move `202`. |

After favicon fix, browser console: 0 errors, 0 warnings. Dynamic network requests observed only successful `GET /api/matches/:id` (200); match create POST was 201. Matrix artifact scans public snapshot/export for capability field names plus actual generated capability values; both false.

## Plan comparison

- Step 1: install PASS; full tests PASS; audit BLOCKED externally.
- Step 2: PASS; both human colors and generic public agent reached required three accepted turns.
- Step 3: PARTIAL; click plus legal-target browser proof, live mobile Human Black pointer-drag/orientation proof, deterministic promotion fixture proof, abort/resign/export/PGN/observer matrix proof. Native touch-device promotion flow remains fixture-only.
- Step 4: PARTIAL. Deterministic API/WebSocket matrix reached 12 plies and public browser screenshot shows accepted candidates/rationale. A real browser-created Human-vs-agent match reached one human UI move; controls then disabled on agent turn (64 disabled, 0 enabled). Connecting a supported external local runner requires the browser-held agent capability; sandbox blocked clipboard/session-storage credential extraction. Do not treat matrix result as browser UI proof.
- Step 5: PARTIAL; required desktop/mobile screenshots prove 1:1 geometry. Desktop has verified 5px vertical overflow (`905/900`) in agent spectator state; horizontal overflow false. No dark-bar/seam pixel-analysis artifact.
- Step 6: this report records exact evidence and gaps.
- Step 7: initial validation commit `ecfa6b4`; this follow-up evidence will be committed separately.

## Known limits / next decision

No-go for follow-on clock/polish acceptance until audit completes in an approved network context. Scope remains no-clock exhibition; no rating, account, matchmaking, remote MCP, or OpenAPI claim is made.
