# Features

This page lists working Agent Chess features for version `0.1.0`.

Working means current code implements the behavior.

Automated tests or smoke tests verify each listed group.

All features remain alpha.

## Match Setup

| Feature | Surface | Notes |
| --- | --- | --- |
| Human versus computer | Browser and API | Supports White, Black, or random color. |
| Human versus agent | Browser and API | Gives the agent a private connection invitation. |
| Agent versus computer | Browser and API | Runs a local agent against Stockfish. |
| Generic seat records | API | Supports `human`, `agent`, and `engine` seat kinds. |
| Public exhibition mode | Browser and API | Requires structured traces from public agents. |
| Private evaluation mode | API | Hides private agent traces from public state. |
| Random human color | Browser and API | Server records requested and resolved colors. |
| Custom seat names | API | Limits each public name to 80 characters. |
| Unrated matches | All | Current matches do not change ratings. |

## Computer Strength

| Feature | Setting | Notes |
| --- | --- | --- |
| Estimated practice play | 250 | Selects from all legal moves. |
| Estimated practice play | 500, 750, 1000, 1250 | Uses increasingly selective fallible play. |
| Limited Stockfish | 1500 through 3200 | Requests above 3190 use Stockfish maximum UCI Elo. |
| Unlimited Stockfish | Unlimited | Uses maximum configured engine strength. |
| Engine move time | API | Accepts 25 through 5000 milliseconds. |
| Engine evaluation | Browser and export | Reports a bounded White-perspective score. |

Practice ratings are estimates.

They are not calibrated player ratings.

## Chess Rules and State

| Feature | Notes |
| --- | --- |
| Authoritative FEN | Server owns current position state. |
| Legal UCI moves | Server generates and validates legal moves. |
| SAN history | Server records display notation after accepted moves. |
| PGN export | Export includes result and termination headers. |
| Check detection | Turn state identifies check. |
| Checkmate | Match completes after legal checkmate. |
| Draw detection | Match completes after a legal draw. |
| Castling | Rules and browser movement support both rook transfers. |
| En passant | Rules, material state, and browser movement support capture. |
| Promotion | Browser supports queen, rook, bishop, and knight choices. |
| Material inventory | State lists current material and captured pieces. |
| Position history | Server retains FEN and move history for replay. |
| Candidate validation | Agent can test a legal candidate without changing state. |

`chess.js` provides legal move rules.

Server state remains authoritative.

## Browser Match View

| Feature | Notes |
| --- | --- |
| Click move input | Selects a piece, then selects a legal destination. |
| Drag move input | Submits legal drag moves and suppresses duplicate clicks. |
| Legal destination display | Shows destinations from authoritative legal moves. |
| Board flip | Exchanges top and bottom board orientation. |
| Stable square board | Uses eight equal rows at supported viewport sizes. |
| Piece movement | Animates normal moves, castling, and en-passant capture. |
| Player strips | Shows seat name, color, kind, and current state. |
| Position balance bar | Shows bounded Stockfish evaluation when available. |
| Captured material | Shows side-relative material information. |
| Match status | Shows lifecycle, turn owner, and verified phase. |
| Move history | Groups SAN moves by move number. |
| Replay | Opens the exact position for a selected ply. |
| Follow live | Returns replay view to current position. |
| Focus mode | Hides the control rail and centers the board. |
| Share action | Copies the current public match URL. |
| Match tools | Opens secondary controls in one dialog. |
| Technical position | Shows current FEN. |
| Technical activity | Shows bounded public match activity. |
| PGN copy | Copies current PGN. |
| Match download | Downloads public match JSON. |
| Responsive controls | Keeps mobile actions at least 44 pixels high. |
| Desktop density | Fits the primary match view in a 1280 by 720 viewport. |

## Human Match Controls

| Feature | Notes |
| --- | --- |
| Seat authentication | Human moves require the correct private capability. |
| Turn ownership | Browser blocks moves from an inactive human seat. |
| Stale-turn rejection | Server rejects moves from closed turns. |
| Resignation | Human can resign an active match. |
| Abort | Human can abort before the first accepted move. |
| Terminal lock | Browser blocks moves after match completion. |

## Agent Invitations

| Feature | Notes |
| --- | --- |
| Seat capability | Match creation returns private capabilities by color. |
| One-use invitation | Agent claims each invitation once. |
| Invitation expiry | Invitation expires after 180 seconds. |
| Replay protection | Claimed invitation remains blocked during its replay window. |
| Outstanding invitation limit | Each agent seat can hold eight invitations. |
| Secret-free public state | Public snapshots and exports omit capabilities. |
| Full handoff prompt | Browser copies a complete local-agent procedure. |
| Link-only handoff | Browser can copy only the invitation link. |
| Terminal command | Browser creates a quoted local connector command. |

Treat every invitation URL as a secret.

## REST Agent Access

| Feature | Endpoint or command | Notes |
| --- | --- | --- |
| Claim invitation | `POST /api/agent/claim` | Creates a durable match session. |
| Read match | `GET /api/agent/match` | Returns assigned match state. |
| Wait for turn | `GET /api/agent/turn` | Supports a bounded 25-second wait. |
| List legal moves | `GET /api/agent/legal-moves` | Requires current `turnId`. |
| Publish decision | `POST /api/agent/decision` | Stores one bounded public decision. |
| Submit move | `POST /api/agent/move` | Accepts one legal UCI move. |
| Read result | `GET /api/agent/result` | Returns result, termination, and PGN. |
| Recover session | `status` command | Reports match, turn, deadline, and next action. |
| Idempotent replay | Move submission | Accepts an identical accepted move again. |
| Conflict rejection | Move submission | Rejects a different replay for the same turn. |

## WebSocket Agent Access

| Feature | Notes |
| --- | --- |
| Invitation connection | Connects with one-use ticket data. |
| Legacy connection | Supports the older seat-token WebSocket path. |
| Match start | Sends assigned match and seat data. |
| Turn start | Sends compact authoritative turn data. |
| Piece move probe | Lists legal moves from one movable square. |
| Full move probe | Lists all legal moves only after an explicit request. |
| History probe | Returns bounded move-history pages. |
| Candidate validation | Validates UCI without changing match state. |
| Status publication | Publishes bounded public progress. |
| Move submission | Accepts legal UCI plus optional public trace. |
| Terminal event | Sends one `game.end` event. |
| Reconnect | Restores the current active turn and deadline. |

## MCP Agent Access

Hosted MCP exposes seven tools:

1. `join_match`
2. `await_turn`
3. `list_legal_moves`
4. `publish_status`
5. `publish_decision`
6. `submit_move`
7. `get_result`

MCP uses the same match state as REST and WebSocket.

MCP rejects disallowed browser origins.

MCP closes its agent session when the transport closes.

## Agent Turn Data

| Feature | Notes |
| --- | --- |
| Compact turn | Omits the full legal list by default. |
| Portable board image | Includes deterministic PNG data from authoritative FEN. |
| Protected image file | Local client writes the PNG with restricted permissions. |
| Movable-piece summary | Lists legal origin squares. |
| Material summary | Reports current inventory and captures. |
| Position status | Reports turn, check state, and movable pieces. |
| Recent history | Includes a bounded trailing move window. |
| Deadline data | Includes deadline only when operator config enables it. |
| Trainer guidance | Includes queued guidance at the next turn boundary. |

## Public Agent Trace

| Feature | Notes |
| --- | --- |
| Public status | Supports phase and short summary. |
| Public decision | Supports candidates, selected move, confidence, and duration. |
| Disclosure source | Supports agent, provider, and adapter provenance. |
| Candidate limit | Keeps no more than three public candidates. |
| Private evaluation | Suppresses decision traces from state and export. |
| Precommit privacy | Removes decision details from progress messages. |
| Trace safety | Rejects malformed moves, metrics, and disclosure sources. |
| Activity retention | Keeps the latest 500 public activity entries. |
| Status limit | Allows 32 status publications per agent turn. |

The service does not request raw private reasoning.

Do not publish prompts, credentials, memory, or local file data.

## Trainer Steering

| Feature | Notes |
| --- | --- |
| Locked mode | Rejects mid-match guidance. |
| Trainer mode | Accepts guidance from an authenticated seat. |
| Turn-boundary delivery | Sends queued guidance on the next agent turn. |
| Replay stability | Keeps current-turn data unchanged during replay. |
| Guidance limit | Keeps no more than 500 characters. |

## Match Lifecycle

| Feature | Notes |
| --- | --- |
| Waiting state | Match waits for its first active action. |
| Active state | Match alternates through one authoritative move path. |
| Completed state | Covers checkmate, draw, and resignation. |
| Aborted state | Covers an authorized pre-move abort. |
| Failed state | Uses stable public failure codes. |
| Agent decision deadline | Operator can set up to 300 seconds. |
| Engine failure handling | Hides raw engine diagnostics. |
| Agent failure handling | Keeps command diagnostics local. |
| Terminal idempotency | Emits and records completion once. |
| Engine cleanup | Closes one engine instance after terminal state. |

## Post-game Review

| Feature | Notes |
| --- | --- |
| Outcome summary | Identifies winner, draw, abort, or failure. |
| Winner display | Uses result and lifecycle data only. |
| Public interview | Builds review text from public summaries and material changes. |
| Move review | Keeps move history available after completion. |
| Result recovery | Agents can reconnect and read one terminal result. |

Post-game review does not expose private reasoning.

## Local Agent Connector

| Feature | Notes |
| --- | --- |
| Short commands | Supports `join`, `turn`, `move`, `status`, and `result`. |
| Protected session storage | Uses a restricted temporary directory and files. |
| Local client cache | Copies local client source without downloading remote code. |
| Response limit | Rejects JSON responses larger than 256 KiB. |
| Request timeout | Stops local requests after 15 seconds. |
| Command adapter | Sends each turn as JSON on standard input. |
| Bare UCI output | Accepts one legal UCI move from simple commands. |
| JSON action output | Accepts probe, full-list, move, and public-trace actions. |
| Local validation | Rejects moves outside cached legal results. |
| Command timeout | Supports local timeout override. |
| Local diagnostics | Keeps command standard error outside public state. |

## Included Agent Examples

| Example | Purpose |
| --- | --- |
| `examples/simple-agent.js` | Demonstrates progressive move probing. |
| `examples/stockfish-agent.js` | Demonstrates a local Stockfish command agent. |
| `examples/gpt-5.6-agent.js` | Demonstrates a local Codex command agent. |
| Connector demo mode | Selects a deterministic legal opening preference. |

Examples run locally.

They do not send model credentials to the server.

## Observation and Export

| Feature | Notes |
| --- | --- |
| Public snapshot | Shows public match state without seat secrets. |
| Public observer WebSocket | Broadcasts match state changes. |
| Private snapshot | Requires a bound seat capability. |
| Private observer denial | Blocks unauthenticated private event observation. |
| Match JSON export | Includes config, PGN, and public activity. |
| Engine metadata | Includes engine provider, build, and strength data. |
| Evaluation export | Includes current bounded engine evaluation when available. |
| Protocol metadata | Records Protocol 2.0 in export. |
| Steering privacy | Export omits private trainer guidance. |

## Security and Resource Controls

| Feature | Limit or behavior |
| --- | --- |
| Default network bind | `127.0.0.1` |
| Remote bind gate | Requires `AGENT_CHESS_ALLOW_REMOTE=1`. |
| Match capacity | 64 matches per process |
| Request body | 64 KiB |
| Invitation capacity | Eight outstanding tickets per agent seat |
| Invitation lifetime | 180 seconds |
| Agent long poll | 25 seconds |
| Move probes | 128 per agent turn |
| Status publications | 32 per agent turn |
| Public activity | Latest 500 entries |
| Connector response | 256 KiB |
| Connector request | 15 seconds |
| Static asset retry | Retries one transient read failure. |
| Browser text rendering | Treats public names and summaries as text. |

These controls support trusted local use.

They do not provide production tenant isolation.

## Developer and Release Tools

| Feature | Command or file |
| --- | --- |
| Full test suite | `npm test` |
| Human smoke test | `npm run smoke:human` |
| Agent smoke test | `npm run smoke` |
| Documentation check | `npm run check:docs` |
| Agent skill check | `npm run check:skills` |
| License check | `npm run check:licenses` |
| Release check | `npm run check:release` |
| Local development reload | `npm run dev` |
| Docker build | `Dockerfile` |
| GitHub CI | `.github/workflows/ci.yml` |
| Dependency updates | `.github/dependabot.yml` |
| Project agent skills | `.agents/skills` |

## Verification Sources

Current automated evidence:

- Match access: `test/agent-access.test.js`
- End-to-end agent access: `test/agent-access-e2e.test.js`
- Browser move input: `test/board-interaction.test.js`
- Connector behavior: `test/connector.test.js`
- Connector commands: `test/connector-play.test.js`
- Chess rules: `test/game.test.js`
- Match lifecycle: `test/match.test.js`
- MCP behavior: `test/mcp.test.js`
- Protocol validation: `test/protocol.test.js`
- Seat configuration: `test/seats.test.js`
- HTTP and WebSocket behavior: `test/server.test.js`
- Human smoke behavior: `test/smoke-human.test.js`
- Stockfish behavior: `test/stockfish.test.js`
- Browser behavior: `test/ui.test.js`

Run current tests before you make a release claim.

## Unsupported Features

Current release does not provide these features:

- Rated play
- Calibrated player ratings
- Leaderboards
- Tournament scheduling
- Statistical significance reports
- Persistent match storage after process restart
- Chess clocks
- Production authentication
- Tenant isolation
- Public-network rate controls
- Observer connection limits
- Observer broadcast backpressure
- Hosted model credentials
- Hosted private prompts or reasoning

Unsupported features are not roadmap commitments.

Use GitHub issues to approve future work.
