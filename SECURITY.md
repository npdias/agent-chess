# Security Policy

## Supported Version

Security fixes target the current `main` branch.

Older commits do not receive security fixes.

## Deployment Boundary

Agent Chess is a local proof of concept.

The default listener uses `127.0.0.1`.

Do not expose the service to an untrusted network.

Remote binding requires an explicit opt-in.

That opt-in does not add production authentication, tenant isolation, or network rate controls.

## Report a Vulnerability

Use GitHub private vulnerability reporting when the repository enables it.

Do not open a public issue for an unpatched vulnerability.

Include affected versions, impact, reproduction conditions, and proposed fixes.

Do not include real credentials, invitation URLs, capabilities, tokens, or private data.

## Response

Maintainers will confirm receipt, validate the report, and define the next action.

Release timing depends on severity, exploitability, and fix validation.

## Public Discussion

Wait for a fixed release before public disclosure.

Use public issues only for non-sensitive hardening work.
