# Task 8 Integration Report

Status: PASS — code hardening closure

Validated hardening baseline: `f4698299eaba2f8f6920f31d40311b191581b1c5`

Detailed evidence: `agent-chess-build-packet-v2/docs/validation/core-exhibition-validation.md`.

Baseline suite passed 179/179. Validation found two product defects: copied npm command echoed one-use ticket; disclosure UI rendered raw provenance enum. Both received literal RED→GREEN fixes. Final suite passed 180/180.

Closure evidence: expanded public/private matrix; unauthorized private GET/export `401`; bound private GET `200`; private observer rejection; guidance sentinel absent from snapshot/WebSocket/export; exact quoted silent connector exits `0` without glob failure or secret output; terminal `game.end`/reconnect/race tests; no late `ENGINE_FAILURE`; PGN result/termination proof; engine metadata separation; real controlled-browser Human-v-agent match reached 10 plies, then 11th-ply agent-turn disabled proof; humanized provenance; refreshed screenshots.

Remaining evidence gaps: `npm audit` lacks external registry authorization; native touch promotion remains fixture-only; no real provider/model-strength evaluation. These are not open defects in requested hardening contracts.
