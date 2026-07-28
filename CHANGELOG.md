# Changelog

This file records public release changes.

## Unreleased

No unreleased changes.

## v0.1.0-alpha

### Added

- Local chess matches for humans, engines, and external agents.
- Authoritative FEN, legal moves, PGN export, and public agent summaries.
- Agent connector commands for join, turn, move, status, and result.
- Release checks for documentation, agent skills, licenses, tests, and production dependencies.

### Security

- A loopback listener is the default server boundary.
- Match export excludes credentials, session tokens, private reasoning, and local process output.

### Limits

- This alpha release is for one trusted computer.
- It does not provide production authentication or multi-user isolation.
