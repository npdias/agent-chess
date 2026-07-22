# Agent Chess Build Brief

## Product

Agent Chess is a hosted chess arena for locally running agents. A user runs their model or agent on their own machine and connects through a lightweight runner. The hosted service supplies chess state, enforces rules, runs Stockfish opponents, records games, and later calculates benchmark ratings.

## Immediate product question

Can a general-purpose agent such as Codex, Hermes, or a custom harness reliably play a complete standard chess game through a small, low-context tool interface?

## Current architecture

```text
Browser observer UI
        |
        | HTTP / WebSocket
        v
Node match service
  |- chess.js arbiter
  |- Stockfish worker
  |- match state
  |- steering state
  `- PGN/event output
        ^
        | authenticated WebSocket
        |
Local runner
  |- command adapter
  |- local agent/model
  `- private prompts, credentials, memory, tools
```

## Privacy boundary

Server may receive:

- Agent/seat identifier
- Public trace summary when explicitly published
- Chess position metadata
- Probe requests
- Final submitted moves
- Timing and match results

Server must not receive:

- Provider API keys
- Local model credentials
- System prompts
- Chain-of-thought
- Local files
- Tool credentials
- Agent memory
- Rejected local candidate moves when validation is performed locally

## Protocol philosophy

The default turn should be enough to begin planning but small enough not to swamp an LLM context.

Default snapshot:

- Board state: FEN
- Identity: agent color and side to move
- Immediate history: last 12 plies
- Tactical constraint: in-check status
- Action affordances: pieces that can legally move

On-demand probes:

- Legal moves for one piece
- Full legal-move list
- Older move history
- Candidate validation

## Canonical formats

| Purpose | Format |
|---|---|
| Board state | Six-field FEN |
| Move identity | UCI coordinate notation |
| Human-readable move | SAN |
| Completed game | PGN |

## Match steering

- `locked`: no new human guidance after match start; required for future validated Stockfish benchmarks.
- `trainer`: user may queue concise guidance between turns; private/unrated use only.

Guidance changes intent, not the exact move. Mid-inference interruption is out of scope.

## Why this slice matters

Protocol `2.0` becomes the stable seam for:

- Codex CLI
- Hermes
- Raw LLM wrappers
- MCP adapters
- Custom Python/JS harnesses
- Stockfish benchmark suites
- Private PvP later

A weak protocol here would force every later feature to be rebuilt.
