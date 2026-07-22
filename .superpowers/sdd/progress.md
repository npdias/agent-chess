# Agent Chess POC v1 SDD Progress

Baseline: dc4a51a on codex/agent-chess-poc-v1; 24 tests passing.
Task 1: complete (commits dc4a51a..c9568c1, review clean).
Task 2: complete (commits c9568c1..379f14c, review clean).
Task 3: complete (commits 379f14c..28ef1c6, review approved; duplicate turn.start fixed at 5235e27).
Task 4: complete (commits 28ef1c6..2be3e54, review clean).
Task 5: complete (commits 2be3e54..3ebf50c, review clean).
Task 6: complete (commits 3ebf50c..9570b97, review clean).
Task 7: complete (commits 9570b97..7c202b8, review clean).
Task 8: complete (commits 7c202b8..4e88b96, automated review clean).
Visual acceptance: complete at 97b31e2; desktop board bands align, board-to-rail gap is 16px, outer margins are symmetric, rail/footer bottoms differ by 1px, and activity fills available rail height. Board sizes: 610x610 at 1440x900, 510x510 at 1280x800, 710x710 at 1440x1000, capped 820x820 on tall screens; mobile remains 366x366 without horizontal overflow.
Board rendering correction: complete at f04ac25; explicit eight-row tracks and zero square minimums prevent piece glyphs from expanding occupied rows. Screenshots at 1440x900, 1280x800, 1440x1200, and 390x844 show no dark seams, clipped ranks, clipped pieces, or horizontal overflow.
Final verification: 91/91 tests, audit clean, live six-ply smoke clean, viewport fit, row geometry, and spacing confirmed.
Final independent review: clean at f04ac25; no Critical, Important, or Minor findings.

## Core Exhibition Plan (2026-07-22)

Plan commit: bedec68 on codex/agent-chess-poc-v1.
Baseline: bedec68; 91 tests passing with localhost permission.
Core Exhibition Task 1: complete (commits bedec68..cc3a69c, review approved; public trace enforcement and seat projection fixed).
Core Exhibition Task 2: complete (commits cc3a69c..0ea01c6, review approved; terminal lifecycle and failure-message privacy fixed).
Core Exhibition Task 3: complete (commits 0ea01c6..45564e3, review approved; structured selected-move binding and atomic rejection covered).
Core Exhibition Task 4: complete (commits 45564e3..f586118, review approved; transport auth, capability isolation, deadline replay, error redaction, private-eval connector fixed).
Core Exhibition Task 5: complete (commits f586118..4f3bc15, review approved; pure human interaction state preserves invalid-target selection).
Core Exhibition Task 6: complete (commits 4f3bc15..dc65848, review approved; playable human UI, generic lifecycle, capability gating, XSS and promotion semantics fixed).
Core Exhibition Task 7: complete (commits dc65848..93fd7dc, review approved; ticket-safe agent smoke, exact human smoke, operator/protocol docs).
Core Exhibition Task 8: evidence review approved at d7478eb; 161 tests, human White/Black, 12-ply API/WS matrix, browser human-agent turn, privacy/layout artifacts. External npm audit authorization remains open.
Core Hardening A: complete at 36f300e (private auth, guidance redaction, atomic trace, provenance, private-eval visibility; review approved).
Core Hardening B: complete at 3216863 (exactly-once terminal delivery, engine race, quoted ticket connector; review approved).
Core Hardening C: complete at f469829 (engine metadata, PGN lifecycle consistency, exact-ply replay; review approved).
Final validation delta: complete at 094b4cc (180 tests, silent ticket-safe connector, 10-ply browser human-agent evidence, private matrix; review approved). npm audit remains externally authorization-blocked.
Core Hardening D: complete at 806694e (three-source provenance preservation/defaulting, adapter-generated demo/status traces, UI Decision label, stable failed terminal payloads, ordered error-before-game.end, nonzero connector exits, raw-diagnostic redaction).
Final Hardening D validation: 184/184 tests; focused proof 11/11; refreshed 12-ply core matrix retains privacy, guidance, connector, PGN, engine-metadata checks. Existing Agent reported screenshot remains current because matrix harness explicitly emits `agent_reported`. npm audit was not retried and remains an external authorization gap only.
