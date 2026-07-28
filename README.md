# Agent Chess

Agent Chess runs repeatable chess matches between humans, engines, and external agents.

It records position data, legal moves, public agent summaries, PGN, and engine metadata.

Use this project to inspect agent behavior, transport reliability, and match results in one workflow.

## Project Status

This release is an alpha proof of concept.

Run it on one trusted computer.

Do not expose it to an untrusted network.

## Requirements

- Node.js 22
- npm 10 or later

## Start

1. Install locked dependencies.

   ```sh
   npm ci
   ```

2. Run launch diagnostics.

   ```sh
   npm run doctor
   ```

   This command checks Node.js 22, npm 10 or later, installed dependencies, and port availability when host policy allows the probe.

3. Start the local server.

   ```sh
   npm start
   ```

4. Open `http://127.0.0.1:3000`.

## Launch an Agent

Start Agent Chess on your trusted local computer.

Create an agent match in the browser.

Select **Copy full prompt** to create a short-lived, one-use invitation link.

Give this prompt to a coding agent. Replace `INVITATION_URL` only with the browser-created link.

```text
You are an external Agent Chess player. Read docs/reference/AGENT_API.md. From this repository root, run: node public/agent-play.js join --join-url 'INVITATION_URL'. Follow returned commands until game.end. Use FEN and listed legal UCI moves as authoritative. Submit each move before commentary. Keep invitation URL, capabilities, tokens, and local session data private.
```

Create invitation links only in the browser.

Read [Agent API](docs/reference/AGENT_API.md) for the complete external-agent flow.

## Run in Docker

Build the local image.

```sh
docker build -t agent-chess:local .
```

Publish the container only on host loopback.

```sh
docker run --rm -p 127.0.0.1:3000:3000 agent-chess:local
```

## Run Tests

Run the complete test suite.

```sh
npm test
```

Run the production dependency audit.

```sh
npm audit --omit=dev
```

Run a three-turn human smoke test against the local server.

```sh
npm run smoke:human -- --server http://127.0.0.1:3000 --color white --turns 3
```

Run the agent smoke test.

```sh
npm run smoke -- --server http://127.0.0.1:3000
```

## Connect an External Agent

Create an agent match in the browser.

Use **Copy full prompt** or **Copy link only** to create a short-lived, one-use invitation link.

Give the full prompt or link to the external agent.

The connector stores session data in a protected temporary directory.

Keep invitation URLs, capabilities, and session tokens private.

## Agent Skills

Project-local skills are in `.agents/skills`.

- `evaluating-chess-positions` checks position state and move safety.
- `playing-chess-by-phase` selects phase plans after tactical checks.

Codex can discover these skills from the repository root.

Run `npm run check:skills` to validate skill metadata and links.

## Outputs

Each match can provide these outputs:

- Public match state
- Portable PNG board image
- Authoritative FEN
- Legal UCI moves
- Public agent status summaries
- PGN export
- Engine and build metadata

Read [Features](docs/features.md) for the complete working-feature catalog.

## Export a Match Record

Use Match tools and select **Download match** in the browser.

An agent can export its match through its protected local session:

```sh
npm run --silent export:match -- --match MATCH_ID > match.json
```

The export includes config, PGN, positions, material, public activity, and available engine data.

It excludes capabilities, session tokens, trainer guidance, private reasoning, and local process output.

Export the record before you run the terminal `result` command or restart the server.

The terminal `result` command removes the protected local session.

The server keeps matches in memory.

## Security Boundary

The server listens on `127.0.0.1` by default.

Remote binding requires `AGENT_CHESS_ALLOW_REMOTE=1`.

That opt-in does not add production authentication, tenant isolation, or network rate controls.

Read [SECURITY.md](SECURITY.md) before any remote test.

## Documentation

- [Documentation map](docs/README.md)
- [Features](docs/features.md)
- [Architecture](docs/architecture.md)
- [Protocol 2.0](docs/protocol-2.0.md)
- [Agent API](docs/reference/AGENT_API.md)
- [Release process](docs/releasing.md)
- [Security review](docs/security-review.md)
- [Writing style](docs/style-guide.md)

## Licensing

Project code uses the MIT License.

Dependencies keep their original licenses.

Stockfish uses GPL-3.0 and requires corresponding source during binary distribution.

Read [LICENSES.md](LICENSES.md) before you distribute a container or binary package.

## Limits

This project does not prove model quality from one match.

It does not provide tournament scheduling, statistical significance, or production multi-user hosting.

Use repeated matches and preserve complete result records.
