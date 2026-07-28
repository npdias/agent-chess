---
name: evaluating-chess-positions
description: Analyze chess positions with side-neutral state checks, candidate refutation, and tactical gates. Use when agents select moves from FEN, PGN, diagrams, or move history.
---

# Evaluating Chess Positions

## Core principle

Treat every candidate as a hypothesis the opponent must try to defeat. Tactical facts and legal constraints override strategic narrative.

## Neutral terminology

- **Controlled side / us:** side whose move the agent selects, normally side to move.
- **Opponent:** other side.
- Derive identity from position state every turn. Never assume the controlled side is White.
- Use `White` and `Black` only for board facts, notation, or evaluation perspective.

## Authoritative state

Prefer FEN or PGN as source of truth. Treat board image as secondary sanity check. From image alone, mark side
to move, castling, en passant, repetition, and halfmove state unknown unless supplied. Never invent rights or missing state.

## Mandatory live-move gate

Apply both policies before phase strategy, opening knowledge, or stylistic preference.

### Policy 1 — Audit before planning

1. Validate side to move, kings, legality, check status, castling, en passant, and draw state when relevant.
2. Update persistent ledger:
   - exact material;
   - loose or currently en prise pieces for both sides;
   - unresolved threats carried from previous turn;
   - king locations and exposed lines.
3. Compute last-move delta:
   - what opponent attacked;
   - which line opened or closed;
   - which defender moved or became overloaded;
   - which check, capture, fork, promotion, or mate threat became possible.
4. Enumerate opponent’s current checks, captures, direct threats, intermediate moves, and mating geometry. If us is in check, consider legal evasions only.

### Policy 2 — Refute before submitting

1. Generate no more than three role-distinct candidates:
   - necessary defense or prophylaxis;
   - strongest forcing move;
   - robust strategic improvement.
2. Run a fresh refuter pass or fresh context when runtime supports isolation. Give refuter resulting position and candidate move, not proposer’s persuasive rationale.
3. Rebuild board after each candidate. Recalculate pawn attacks, knight attacks, king attacks, and every bishop, rook, and queen ray changed
   by vacated or occupied squares.
4. For every candidate, record:
   - `opponent_best_reply`: strongest legal check, capture, mate threat, or tactical refutation;
   - `our_response`: best available answer;
   - resulting material and king safety.
5. Use at least 2½ ply:
   `our candidate → opponent best reply → our response`.
   Extend one more opponent move for checks, sacrifices, queen attacks, exposed kings, or promotions.
6. Reject candidate before strategic comparison when it:
   - fails to resolve check;
   - allows mate on opponent’s next move;
   - loses queen, rook, or minor piece without verified forced compensation;
   - leaves no adequate answer to opponent’s strongest forcing reply;
   - relies on attack, defense, check, or promotion as proof of safety;
   - lacks a concrete `opponent_best_reply`.
7. Let selector compare concrete lines only among survivors. Persuasive proposer rationale has no veto over refutation.

## Tactical misconception guards

- **Attacking a piece does not force it to move.** Opponent may have stronger check, capture, or mate.
- **Defended does not mean safe.** Defense permits recapture; compare exchange value and continuation.
- **Checking does not make a move sound.** Opponent may capture checker, block, interpose, countercheck, or answer while winning material.
- **Promotion does not make destination safe.** Audit control of promotion square after promoted piece appears.
- **Narrative does not verify geometry.** Trace complete files, ranks, and diagonals after every candidate.

## Strategic comparison

After tactical survivors exist:

1. Build position map: material, king safety, pawn structure and breaks, activity, coordination, weaknesses, space, initiative, development, and endgame trajectory.
2. Name position type and dominant factor: `forced`, `tactical`, `strategic`, `technical`, or `defensive`.
3. Compare endpoints, counterplay, transition risk, and practical difficulty.
4. Run final blunder audit on chosen move using Policy 2 again.

## Confidence

Report three values when confidence matters:

- `state_confidence`
- `tactical_safety_confidence`
- `strategic_preference_confidence`

Caps:

- Tactical safety ≤ `0.60` without named opponent reply plus our response.
- Tactical safety > `0.80` requires all opponent checks and major captures inspected.
- Tactical safety > `0.90` only for tool-verified forced sequences or trivial verified recaptures.
- Fluent explanation never increases tactical confidence.

## Tool boundary

Use rules-only board tooling first when available:

- legal moves and check state;
- material inventory;
- position after candidate;
- attackers of destination;
- opponent checks and captures;
- loose pieces.

Rules-only verification may reject impossible or tactically broken moves. It must not choose move, assign centipawn evaluation, or supply principal
variation. Engine/tablebase use is separate; record tool, version, limits, and MultiPV when used.

## Output contract

For live play, return compact structured result:

1. Controlled side, check status, material, last-move delta, unresolved threats
2. Opponent checks, captures, and mate threats
3. Candidates with `opponent_best_reply` and `our_response`
4. Rejected candidates plus concrete refutation
5. Selected surviving move
6. Three confidence values and verification status

For analysis or coaching, add static/dynamic evaluation, dominant factor, endpoint comparison, practical assessment, and human label. If using symbolic evaluation, state White perspective explicitly.

## Red flags

Stop and restart gate if analysis:

- assumes controlled side is White;
- ignores check, last-move delta, unresolved threat, or material change;
- calls destination safe without rebuilt attack map;
- describes attack, defense, check, or promotion as proof;
- gives strategy before concrete opponent refutation;
- calls illustrative line forced;
- claims mate without exhausting legal defenses;
- presents engine precision without search conditions.

Read [`REFERENCE.md`](REFERENCE.md) for full evaluation vector, calculation protocol, tool policy, worked examples, and literature grounding. Run [`TESTS.md`](TESTS.md) before deployment; Tests
10–17 are mandatory regression gates derived from observed live-play failures.
