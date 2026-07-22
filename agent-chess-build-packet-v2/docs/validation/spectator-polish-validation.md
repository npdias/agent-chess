# Spectator polish validation

Validated commit: `e838ab2`

## Automated verification

- `npm test`: 218/218 passed, 0 failed.
- Task 1 focused server suite: passed.
- Task 2 focused UI suite: 52/52 passed.
- Independent Task 1, Task 2, and Task 3 reviews: clean after follow-up fixes.

## Desktop geometry

In-app Browser viewport: 1280 x 720.

- Document: 1280 x 720. No page-level horizontal or vertical scroll.
- Board: 470 x 470; bottom edge 626.5px.
- Board footer: 24px high; bottom edge 692.5px.
- Board squares: 64 stable nodes.
- Captured material: compact visible text (`Material -14`) with full captured-piece detail in accessible label and title.
- Primary rail: Agent decision, Move history, plus terminal Match breakdown. Technical tools remain outside default rail.

## Browser behavior exercised

- New Match setup: matchup selection, Agent vs Computer labels, engine-skill visibility, Create match.
- Agent invitation: one-use link copy feedback, complete self-describing HTTP contract, terminal fallback, connected-state collapse.
- Live spectator view: current structured decision, candidates, selected move, provenance, move history.
- Focus: pressed state plus board-only layout; document remains 720px high.
- Share: `Spectator link copied` feedback.
- Match tools: native dialog, agent instructions, technical sections, Copy PGN, Download Match JSON.
- Board: flip reverses first/last rendered squares; replay exposes Return to live; return restores current position.
- Motion: 64 square nodes remain stable; live piece transform observed during accepted move; reduced-motion CSS contract covered by tests.
- Post-match: checkmate status, result, termination, player, breakdown visible without page scroll.

## Screenshots

- `output/ux-validation/01-new-match.png` — New Match.
- `output/ux-validation/02-agent-invite-zero-scroll.png` — compact agent invitation and zero-scroll live shell.
- `output/ux-validation/03-match-tools.png` — Match tools dialog.
- `output/ux-validation/04-live-decision.png` — live structured agent decision.
- `output/ux-validation/05-piece-transition.png` — accepted-move transition frame.
- `output/ux-validation/06-live-final.png` — final 1280 x 720 match layout.
- `output/ux-validation/07-focus-mode.png` — board-first Focus mode.

## Agent invitation contract

`GET /agent/join?ticket=...` returns service/protocol metadata, match and seat data, absolute WebSocket URL, exact message order, public-trace rules, privacy boundary, and expiry. HTTP inspection does not consume ticket; first WebSocket claim consumes it. Ticket expiry is 60 seconds. Responses use `Cache-Control: no-store`. Ticket and join URL remain absent from public state and exports.

## Known validation limit

In-app Browser mobile viewport override did not change the existing browser window dimensions. Mobile behavior is covered by focused CSS contract tests and independent review: at widths <=720px, visible actions, summaries, New match, move replay, dialog, lifecycle, terminal, connector, and promotion controls receive a minimum 44px target. No mobile screenshot is claimed for this run.
