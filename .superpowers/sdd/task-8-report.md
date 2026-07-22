# Task 8 Integration Report

Status: PARTIAL — npm audit external-policy blocker

Validated code commit: `13414398a61883dcbd34dbc98e49a51f816bfb2e`

## Task 8 outcome

Detailed evidence: `agent-chess-build-packet-v2/docs/validation/core-exhibition-validation.md`.

Completed: 162/162 full suite; White/Black human 3-turn smokes; generic public-agent 3-turn smoke; tracked deterministic matrix; abort/resign/export/observer/spectator matrix; refreshed desktop/mobile/spectator evidence; tracked grid-geometry artifact. Orientation proof: Human Black mobile renders Computer/White/Engine above, Human/Black/Human below, Black home rank nearest; Human-v-agent turn renders Agent, not Engine, with 64 disabled controls.

Blocked: `npm audit --audit-level=high` external DNS/approval boundary. Real browser-created Human-vs-agent proof is incomplete: after UI move `e2e4`, 64 controls disabled on agent turn, but sandbox blocks retrieving browser-held agent capability from clipboard/session storage to start supported local connector. Promotion remains deterministic fixture proof. Do not accept next plan yet.

Current validation replaces prior checkpoint claims. See detailed report for all commands, evidence, limitations, and exact match IDs.
