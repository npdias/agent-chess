---
name: playing-chess-by-phase
description: Choose side-neutral plans across game phases after candidates pass tactical checks. Use when agents need opening plans, conversion, defense, or practical match decisions.
---

# Playing Chess by Phase

## Core principle

Treat opening, middlegame, and endgame as **overlapping decision environments**, not move-number boxes. Pawn structure, king safety, piece activity, tactical contact,
and theoretical knowledge determine the plan.

**REQUIRED SUB-SKILL:** Load `evaluating-chess-positions` whenever any caller requires a concrete best move, variation, or evaluation.

## Neutral terminology

- **Controlled side / us:** side whose move the agent selects.
- **Opponent:** other side.
- Derive identity from side to move. Never assume us is White.
- Describe White/Black only when color itself matters.

## Mandatory safety handoff

Phase knowledge may propose plans and candidate roles. It may not approve a move.

Before any concrete move recommendation:

1. Run `evaluating-chess-positions` mandatory live-move gate.
2. Require `opponent_best_reply` and `our_response` for every candidate.
3. Reject mate, unresolved check, uncompensated material loss, and unverified sacrifice.
4. Apply phase strategy only among tactical survivors.

Opening knowledge, activity, initiative, space, conversion goals, clock pressure, and match need never override a concrete refutation.

## Phase gate

Classify the position as `opening`, `opening transition`, `middlegame`, `endgame transition`, `technical endgame`, or `mixed`. Queens may remain in an endgame,
and an early queen trade does not automatically end the opening.

## Game-phase workflow

1. **Establish position and context.** Obtain FEN/PGN, controlled side from side to move, time control, clocks if relevant, tournament or match
   objective, and available theory/database/engine/tablebase tools.
2. **Opening.** Verify the opening identity and move order before naming theory. Separate current theory, database popularity, engine preference, published repertoire,
   and inference. Explain the center, development, king safety, structural destination, ideal piece placement, thematic pawn breaks, tactical motifs, favorable exchanges,
   and the opponent’s main counterplan. Concrete tactics override generic principles.
3. **Opening-to-middlegame transition.** Identify the first unverified or novel move, resulting pawn structure, irreversible changes, development gaps, and the plan that replaces memorized moves.
4. **Middlegame.** Classify the center and pawn structure. Locate weaknesses, worst-placed pieces, open lines, color complexes, favorable exchanges, critical pawn breaks,
   attacking sectors, and prophylactic needs. Compare maintaining, releasing, or transforming tension. Build a plan that includes the opponent’s counterplay.
5. **Endgame and conversion.** Establish whether the position is theoretical or practical. Prioritize king and piece activity, passed-pawn creation or restraint,
   rook activity, reserve tempi, zugzwang, fortresses, perpetual checks, and draw rules. Simplify only into an ending whose result and technique
   have been checked.
6. **Practical layer.** Adjust candidate breadth and risk to the clock and match need only after objective soundness. In time trouble,
   reduce the candidate set, check forcing replies, and be cautious with irreversible moves.
7. **Training layer.** Recommend model games, structure-specific positions, calculation exercises, theoretical endings, and unaided postgame review followed by database/engine/tablebase verification.

## Output contract

Return, in order:

1. Phase and transition status
2. Opening or structure identification with source confidence
3. Position demands and critical imbalance
4. Primary plan for the side to move
5. Opponent’s counterplan and prophylaxis
6. Thematic moves, breaks, exchanges, and transformations
7. Concrete candidates surviving `evaluating-chess-positions`
8. Practical recommendation and transition test
9. Training takeaway and source basis

## Red flags

Correct any response that assumes controlled side is White, invents opening theory, treats principles as laws, ignores opponent’s forcing reply
or break, names an endgame solely by piece count, recommends automatic exchanges when ahead, confuses database frequency with objective quality,
gives match-strategy advice before soundness, or uses an engine line without explaining resulting plan.

Read [`REFERENCE.md`](REFERENCE.md) for phase classification, opening source discipline, structure playbooks, conversion and defense ladders, time management, worked examples, and literature
grounding. Use [`TESTS.md`](TESTS.md) before deployment.
