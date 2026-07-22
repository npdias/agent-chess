# Core exhibition hardening validation

Status: **PASS — requested code-hardening contracts closed by current evidence.**

Validated hardening baseline: `57de8fcf67270dcedea87d739ae7860d46d327cd`.

Prior validation found two UI command/disclosure defects. Final bounded reviews additionally closed invalid connector source coercion, validation-order bypass, and stale terminal activity metadata; every finding has literal RED→GREEN coverage.

## Environment

- Node `v22.23.1`; npm `10.9.8`.
- Server: owned `npm start` process at `http://127.0.0.1:3000`.
- Browser: Playwright CLI controlled Chromium sessions at 1440x900 for final captures.

## Automated checks

| Command | Result |
| --- | --- |
| `npm test` at Hardening D baseline `57de8fc` | PASS — 189 tests, 189 pass, 0 fail; 2747.679667 ms. |
| Hardening D focused proof | PASS — 17/17; 483.600541 ms. Connector provenance 9/9; adapter status 1/1; UI disclosure/failure labels 2/2; terminal failure 5/5. |
| Focused server hardening group | PASS — 9/9; 603.477 ms. Covers engine metadata separation, private auth/events, guidance suppression, quoted connector, terminal delivery/reconnect/race, engine resign races. |
| Focused PGN group | PASS — 2/2; 144.42175 ms. Covers resignation/failure headers plus draw result/termination. |
| Focused UI group | PASS — 3/3; 85.139125 ms. Covers zsh path quoting, npm echo suppression, humanized disclosure labels. |
| `npm audit --audit-level=high` | Not rerun. Prior network/authorization boundary remains an external dependency-audit gap only; no vulnerability result is claimed. It is not evidence against code-hardening closure. |

Exact focused test names, counts, durations, browser summary: [task8-hardening-focused.json](evidence/task8-hardening-focused.json).

## Validation-discovered fixes

1. Exact copied command used `npm run connect`, causing npm to echo the one-use ticket path. RED: `suppresses npm script echo in copied ticket command` failed 0/1. Fix: copied command now uses `npm run --silent connect`. Functional `/bin/zsh -f -c` contract reached connector, produced terminal output, exited `0`, had no glob failure, printed neither capability nor ticket. Integration regression: `browser copied quoted --path command joins without printing its ticket`.
2. Public disclosure provenance rendered raw `agent_reported`. RED mapping test failed. Display labels now map `agent_reported` → `Agent reported`, `provider_summary` → `Provider summary`, `adapter_generated` → `Adapter generated`; raw model value remains unchanged.

## Hardening D proof

- Provenance: `agent_reported`, `provider_summary`, `adapter_generated` survive their intended connector/protocol paths; absent/null/empty command source defaults to `agent_reported`; explicit unsupported source fails locally with `INVALID_TRACE_SOURCE` before server/UI even when summary is absent/empty; demo moves plus precommit status use `adapter_generated`; provider summary reaches public snapshot unchanged.
- UI: committed `agent.decision` renders label `Decision` while disclosure provenance remains separate; real failed-match public activity persists `recoverable: false` and renders `Match failed`.
- Decision deadline failure: `error` precedes `game.end`; terminal payload reports `status: failed`, `termination: failure`, `failureCode: AGENT_FAILURE`; reference connector exits `1`; raw `Decision deadline exceeded` diagnostic is absent.
- Engine failure: `error` precedes `game.end`; terminal payload reports `status: failed`, `termination: failure`, `failureCode: ENGINE_FAILURE`; reference connector exits `1`; injected raw engine diagnostic is absent.
- Exact test names, grouped counts, assertions: [task8-hardening-focused.json](evidence/task8-hardening-focused.json).

## Core matrix

`node bin/validate-core-matrix.mjs http://127.0.0.1:3000` produced tracked [task8-core-matrix.json](evidence/task8-core-matrix.json).

- Public agent match `ee4a7f67-a98f-4652-b944-ba3c47123f6a`: 12 plies, 6 human moves, 6 agent moves, 33 observer states, accepted `agent_reported` decision, spectator submit `401`, PGN present, no capability value/name leak, no engine metadata.
- Private contract: unauthorized match GET `401`; bound-seat GET `200`; unauthorized export `401`; private `/events` rejected.
- Guidance sentinel: steering POST `202`; sentinel absent from snapshot, observer state, export; public active turn omitted steering; no capability leak.
- Quoted connector contract: silent npm command connected, resigned `202`, received terminal output, exited `0`; no zsh glob failure, stderr, capability value, ticket value.
- Lifecycle/export: abort `202`; resignation `202`; export `200`; PGN headers matched `Result` plus `Termination`; engine metadata present for engine match only.

## Terminal protocol proof

Focused server tests provide terminal-path proof without retained credentials:

- `sends protocol game.end once for natural completion, resignation, and decision deadline`
- `terminal agent reconnect receives one game.end without re-emitting match terminal events`
- `terminal emission sends one game.end when resignation races agent connection dispatch`
- `ignores rejected engine search after a human terminal action`
- `ignores stale engine results and failures after a human terminal action`

Result: one `game.end` per agent socket, terminal reconnect receives one terminal payload, observer receives final completed state, engine result/failure races do not append `ENGINE_FAILURE` after human terminal action.

## Browser evidence

Playwright CLI used fresh snapshots before refs. No capability/ticket value appears in retained evidence.

No screenshot refresh was required for Hardening D. Matrix and connector harnesses explicitly emit `agent_reported`; focused proof confirms it remains the committed decision source. Existing spectator screenshot's `Agent reported` disclosure therefore remains current. New `Decision` labeling is focused-test proof, not a refreshed screenshot claim.

Real UI setup: API created public Human-v-agent match `b81b4bae-bfe9-48c2-9000-930c7c083f63`. One-shot loopback injector placed human capability into controlled browser `sessionStorage`; value was never read back. External harness retained agent capability and ran supported connector. This is controlled API setup plus real browser move submission, not browser-created match setup.

| Evidence | Findings |
| --- | --- |
| [human-agent-spectator.png](screenshots/human-agent-spectator.png) | Clean 1440x900 spectator session after 10 plies: screenshot shows current candidate row, 10-ply history, `Agent reported` provenance, top Harness Agent / Black / Agent, bottom Browser Human / White / Human, 64 disabled / 0 enabled squares, GET `200`, console 0 errors/warnings, no horizontal overflow. DOM capture retained five candidate rows. |
| [human-agent-ui-disabled.png](screenshots/human-agent-ui-disabled.png) | Same match after connector stop plus sixth accepted browser move (11-ply state): first five browser POST statuses were captured as `202`; prior five agent moves were accepted; Harness Agent to move; 64 disabled / 0 enabled squares. DOM retained five candidate rows plus humanized `Agent reported`; raw `agent_reported` was hidden. |
| [human-engine-desktop.png](screenshots/human-engine-desktop.png) | Prior orientation proof remains current: 1440x900, 610x610 board, Computer / Black / Engine above, Human / White / Human below, `e2` selection with `e3`/`e4` legal targets. |
| [human-engine-mobile.png](screenshots/human-engine-mobile.png) | Prior mobile orientation proof remains current: 390x844 Human Black, 366x366 board, Computer / White / Engine above, Human / Black / Human below, Black home rank nearest, human move POST `202`, no clipping/horizontal overflow. |

Final 10-ply geometry: board 610x610, activity rail 440x820, viewport 1440x900, document height 903, horizontal overflow false. [task8-board-geometry.json](evidence/task8-board-geometry.json) remains unchanged because board-track values did not change.

## Export proof

- Resignation export: `[Result "0-1"]`, `[Termination "resignation"]`.
- Abort export: `[Result "*"]`, `[Termination "aborted"]`.
- Draw focused test: `[Result "1/2-1/2"]`, `[Termination "draw"]`, terminal movetext result.
- Engine export contains Stockfish reproducibility metadata; Human-v-agent snapshot/export omit engine field.

## Remaining gaps

- `npm audit` has no current result because external registry authorization was not granted. External evidence gap; not product defect.
- Native touch-device promotion remains deterministic fixture proof, not physical-device proof.
- Real provider/model strength was not evaluated; connector proof used deterministic demo agent.
- Clocks, ratings, accounts, matchmaking, remote MCP, OpenAPI remain outside no-clock exhibition scope.

No open product defect remains in requested privacy, connector, terminal, export, provenance, orientation, or browser-control contracts.
