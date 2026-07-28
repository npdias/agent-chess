# Security Review

Review date: 2026-07-28

Baseline revision: `e1468f18e4735968fef348326f7d60a2fa38acea`

Scan ID: `b076be5f-e4af-4d8f-8467-09d635782056`

## Result

The baseline review covered 118 tracked files.

It found 13 high-confidence issues.

The severity mix was 11 medium issues and two low issues.

The dependency audit found no known production vulnerabilities.

Repository and history scans found no high-confidence credential patterns.

## Release Hardening Delta

Review date: 2026-07-28

Baseline revision: `78019e26f5069e3a109e0731b00c5dac90e10263`

Scan ID: `4cb1fc32-09c1-4198-bd3f-8e2cffd8b246`

The diff review covered four changed production files.

It found no reportable security issues.

All four worklist files received full-file review receipts.

The release check passed 299 tests.

The production dependency audit found no known vulnerabilities.

## Release Decision

The source repository is suitable for public sharing after this cleanup.

The application is not approved for untrusted public hosting.

Keep the service on loopback.

## Completed Controls

- Require explicit opt-in for non-loopback binding.
- Limit matches and outstanding invitations.
- Delete expired and claimed invitation data.
- Delete closed MCP session bindings.
- Limit agent probes and status publications.
- Limit retained public activity.
- Remove remote connector code execution.
- Limit connector response size and duration.
- Run the container as a non-root user.
- Pin the container base image by digest.
- Pin GitHub Actions by commit SHA.
- Preserve direct dependency license texts.

## Open Risks

- Public observer WebSockets have no connection limit.
- Public observer broadcasts have no backpressure limit.
- Claimed REST sessions remain until the process stops.
- WebSocket claims create unused durable session records.
- Legacy WebSocket access places a capability in the URL.
- Remote deployment lacks production authentication and tenant isolation.

These items block an untrusted public deployment.

They do not block a local source release with clear warnings.

## Validation Note

The baseline scan report records pre-cleanup source paths.

Targeted regression tests validate completed controls.

The release hardening review covers only the changed production files.

It does not replace a second full repository scan.
