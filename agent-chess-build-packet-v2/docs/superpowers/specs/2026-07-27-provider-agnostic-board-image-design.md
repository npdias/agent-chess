# Provider-Agnostic Board Image Design

## Goal

Make every Agent Chess turn carry a board image that any vision-capable model adapter can consume, while also giving file-capable agent runtimes a protected local image path.

## Problem

Current turn state embeds an SVG data URL in `turn.boardImage`. The maintained connector prints that value as JSON. Direct agent runtimes therefore receive image bytes as text, not as a rendered image or model attachment. SVG support also varies across model providers. Session `019fa5ee-4b09-7e92-b755-ec1182cb80d1` exposed this gap: board data arrived, but the runtime could not render it.

## Contract

Server-generated `turn.boardImage` uses portable PNG:

```json
{
  "type": "image",
  "mimeType": "image/png",
  "dataUrl": "data:image/png;base64,...",
  "alt": "Canonical board position from authoritative FEN. White to move."
}
```

Maintained connector emits:

```json
{
  "type": "turn.ready",
  "turn": {},
  "legalMoves": [],
  "attachments": [
    {
      "type": "image",
      "mimeType": "image/png",
      "dataUrl": "data:image/png;base64,...",
      "alt": "Canonical board position from authoritative FEN. White to move.",
      "imagePath": "/private/protected/path/turn-id.png"
    }
  ]
}
```

`attachments[]` is provider-neutral. External harnesses translate it into their provider's native multimodal request shape. Connector never imports a provider SDK, invokes a model, or selects a move.

## Rendering

Use Node built-ins only. Renderer creates deterministic 512x512 RGBA PNG bytes from authoritative FEN, draws alternating board squares, then draws high-contrast piece tokens identified by standard piece letters. PNG uses non-interlaced color type 6, 8-bit channels, zlib-compressed scanlines, valid IHDR/IDAT/IEND chunks, and CRC-32 checksums.

Piece tokens prioritize machine readability over decorative fidelity:

- White pieces: light circular token, dark letter.
- Black pieces: dark circular token, light letter.
- Letters: `P`, `N`, `B`, `R`, `Q`, `K`.

FEN remains canonical truth for legality, castling, en passant, repetition, and move selection.

## Local Artifact

On each successful `turn` command, connector:

1. Validates image type, MIME type, data URL prefix, and decoded PNG signature.
2. Writes bytes atomically beside protected session state as `board-<safe-turn-id>.png`.
3. Applies file mode `0600`; containing session directory remains `0700`.
4. Emits normalized attachment containing both original data URL and absolute `imagePath`.
5. Removes previous turn image after new image is written, limiting local residue to current board.

Malformed or unsupported image payload fails turn command with `BOARD_IMAGE_INVALID`; next action is `run_turn`. Connector must never emit a path to unvalidated attacker-controlled content.

## Handoff Behavior

Copied prompt requires agent to inspect first normalized attachment before choosing a move:

- Vision API harness → map `dataUrl` into provider image input.
- File-capable runtime → inspect `imagePath`.
- Runtime supporting neither → report `BOARD_IMAGE_UNSUPPORTED`; do not claim visual review.

## Tests

- Renderer unit test validates PNG signature, IHDR dimensions/type, deterministic bytes, and different bytes for different FEN.
- Turn snapshot test validates normalized PNG `boardImage`.
- Connector E2E test validates `attachments[0]`, byte-for-byte data URL/file parity, PNG signature, absolute path, `0600` file mode, session-directory containment, and prior-image cleanup after next turn.
- UI test validates provider-neutral instructions and failure honesty.
- Full test suite must pass.

## Non-goals

- Provider SDK integration.
- Model credential handling.
- OCR.
- Chess move selection.
- Engine-assisted evaluation.
- Persisting images after terminal cleanup.
