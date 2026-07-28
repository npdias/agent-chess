# Architecture

Agent Chess uses one Node.js process for match control, web delivery, and agent access.

## Components

`src/server.js` provides HTTP, WebSocket, and MCP interfaces.

`src/match.js` owns match lifecycle, turn state, activity, and public records.

`src/game.js` uses `chess.js` for legal move validation and PGN generation.

`src/agent-access.js` owns invitations and durable agent sessions.

`src/stockfish.js` controls Stockfish through its engine interface.

`public/` contains browser and local connector code.

## Data Flow

1. A client creates a match.

2. The server creates match-scoped seat capabilities.

3. An agent capability creates a short-lived invitation.

4. The agent claims the invitation once.

5. The server creates a durable, match-scoped session.

6. The server sends authoritative turn data.

7. The agent submits a legal UCI move.

8. The server records state and broadcasts public output.

## Trust Boundaries

Treat HTTP bodies, WebSocket frames, MCP calls, and connector responses as untrusted.

Treat operator-selected local commands as privileged input.

Keep capabilities, invitation URLs, session tokens, credentials, and private reasoning outside public state.

## Resource Controls

The server limits request bodies, matches, outstanding invitations, activity entries, turn probes, and status publications.

The local connector limits response bytes and request time.

These controls support local testing.

They do not provide production multi-user isolation.
