# Task 8 Integration Report

Status: PARTIAL — npm audit external-policy blocker

Validated code commit: `ecfa6b4cca56ea57a938f92f69bc4fe21fa80400`

## Task 8 outcome

Detailed evidence: `agent-chess-build-packet-v2/docs/validation/core-exhibition-validation.md`.

Completed: 161/161 full suite; White/Black human 3-turn smokes; generic public-agent 3-turn smoke; tracked deterministic matrix; abort/resign/export/observer/spectator matrix; desktop/mobile/spectator evidence; tracked grid-geometry artifact.

Blocked: `npm audit --audit-level=high` external DNS/approval boundary. Real browser-created Human-vs-agent proof is incomplete: after UI move `e2e4`, 64 controls disabled on agent turn, but sandbox blocks retrieving browser-held agent capability from clipboard/session storage to start supported local connector. Promotion remains deterministic fixture proof. Do not accept next plan yet.

Current validation replaces prior checkpoint claims. See detailed report for all commands, evidence, limitations, and exact match IDs.
