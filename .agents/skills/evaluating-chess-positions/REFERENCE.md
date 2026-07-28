# Professional Reference: Position Evaluation and Move Selection

## 0. Use side-neutral identity

Derive the controlled side from side to move for every position. Use `us` for the controlled side and `opponent` for
the other side. Color names describe board facts; they do not define agent identity. Re-derive identity after every new FEN
rather than carrying color assumptions between games.

## 1. Select the analysis mode

| Observable condition | Primary mode | First action |
|---|---|---|
| Side to move is in check | Forced | Enumerate legal evasions |
| Exposed king, hanging material, forcing contact | Tactical | Two-sided checks–captures–threats scan |
| No immediate forcing sequence | Strategic | Map weaknesses, pieces, prophylaxis, and pawn breaks |
| Reduced material with known theoretical families | Technical | Establish theoretical status; probe tablebase if eligible |
| Worse position or direct threat | Defensive | Identify the threat, minimum concession, exchanges, and counterplay |
| Recognizable opening position | Opening transition | Load `playing-chess-by-phase`, verify theory, then return here for move choice |

A checklist is a focusing device, not a ritual. Strong play depends on recognizing which information is decisive. Research following
de Groot supports the importance of pattern recognition and relevant candidate selection, while calculation literature emphasizes disciplined comparison of concrete
lines. [E1–E4]

## 2. Validate the board before evaluating it

Record:

- exact piece placement and side to move;
- controlled side and opponent;
- whether either king is in check;
- castling and en-passant rights;
- halfmove clock, repetition state, and move number when draw rules matter;
- variant and board orientation;
- whether the position is legal, merely syntactically valid, or reconstructed with uncertainty.

A diagram cannot establish historical rights. A move recommendation that depends on castling, en passant, repetition, or the fifty-move rule
must be conditional unless FEN or PGN supplies the state. FIDE’s rules define legal completion, checkmate, stalemate, dead positions, repetition,
and move recording; use a legal-move library rather than natural-language intuition for machine verification. [E6, E8]

## 3. Conduct the tactical emergency scan

Scan **both sides**, beginning with the side to move:

1. Checks, including discovered and double checks.
2. Captures, especially of kingside defenders, loose pieces, and overloaded defenders.
3. Direct threats: mate, promotion, skewers, forks, pins, trapped pieces, and decisive pawn breaks.
4. Intermediate moves and counterchecks.
5. Alignment motifs: files, ranks, diagonals, back rank, x-rays, batteries, and removal of the guard.
6. Escape squares and defensive resources.

Do not stop after finding an attractive move. Ask what the opponent would play if allowed to move twice, then
test whether the candidate prevents or outruns that idea.

Before planning, update a persistent tactical ledger:

- exact material change since prior turn;
- pieces still en prise;
- unresolved attacks and threats;
- lines opened or closed by the last move;
- newly available checks, captures, forks, promotions, and mating entries.

Never infer obligation from attack. An attacked opponent may ignore the attack for a stronger check, capture, or mate. Never
infer safety from defense, check, or promotion; rebuild the position and compare concrete exchanges.

## 4. Build an evaluation vector

The vector is not a fixed arithmetic formula. Identify the dominant feature and interactions among features.

### 4.1 Material and imbalances

Begin with a gross count, then qualify it:

- queen, rook, minor-piece, and pawn balance;
- exchange or multi-piece imbalances;
- bishop pair, opposite-colored bishops, rook versus minor pieces, queen versus pieces;
- number of pawns and pawns on one or both wings;
- quality of the remaining pieces and whether material can be mobilized;
- concrete compensation: initiative, king exposure, structure, domination, or perpetual-check resources.

Conventional piece values are accounting aids, not evaluations. A nominal material edge may be irrelevant if the king is being
mated, a piece is trapped, or the position is a fortress.

### 4.2 King safety

Evaluate:

- open or semi-open lines toward the king;
- pawn shield and dark-/light-square holes;
- number, quality, and arrival time of attackers and defenders;
- flight squares and back-rank vulnerability;
- queen presence, potential queen trades, and opposite-side castling;
- whether a pawn move creates permanent access squares;
- whether an apparent attack survives one accurate defensive move.

King safety is often the dominant factor in queen positions and can outweigh material or structure.

### 4.3 Pawn structure and breaks

Identify:

- passed, protected passed, connected, outside, and candidate passed pawns;
- isolated, backward, doubled, hanging, overextended, and fixed pawns;
- chains, bases, heads, levers, majorities, and space gains;
- weak squares created by pawn moves;
- available pawn breaks, their preparation, and who benefits from opening lines;
- favorable and unfavorable pawn endings after exchanges.

A weakness matters only if it can be attacked or restricts coordination. A nominally weak pawn may support activity; modern
strategy repeatedly accepts structural defects for dynamic play. [E5, E9]

### 4.4 Piece activity and coordination

For every piece ask what it attacks, defends, restricts, and can become:

- development and tempi;
- mobility with useful destinations, not empty-square counts;
- stable outposts and invasion squares;
- bishops’ diagonals and color-complex relevance;
- knights’ routes, blockades, and rim placements with concrete purpose;
- rooks on open files, active ranks, behind passed pawns, or cut off from play;
- queen activity versus exposure to tempo;
- overloaded defenders and pieces performing incompatible jobs;
- the worst-placed piece and the route to improve it.

### 4.5 Space, initiative, and time

Separate:

- **space:** durable control that restricts pieces;
- **initiative:** the ability to make threats that force replies;
- **development lead:** pieces ready sooner;
- **tempo:** one move in a concrete race;
- **zugzwang:** the obligation to move worsens the position.

Space without breaks or entry squares may become overextension. Initiative is perishable; calculate when it ends.

### 4.6 Endgame trajectory

Before exchanging, compare the resulting ending:

- king activity;
- pawn races and reserve tempi;
- passed-pawn creation and blockade;
- rook activity and checking distance;
- bishop color versus fixed pawns;
- knight outposts and pawns on both wings;
- fortresses, perpetual checks, stalemate tricks, and wrong-rook-pawn cases;
- tablebase status and fifty-move implications when applicable.

## 5. Generate candidates by role

A compact candidate set should cover distinct functions:

1. **Forced legality:** check evasions and moves preventing immediate loss.
2. **Forcing play:** checks, captures, direct threats, and tactical pawn breaks.
3. **Prophylaxis:** neutralize the opponent’s idea or improve a key defender.
4. **Transformation:** favorable exchange, sacrifice, liquidation, or transition.
5. **Structural play:** thematic break, fixing move, passed-pawn creation.
6. **Improvement:** activate the worst piece or seize an entry square.

Usually two to four candidates are enough. Expand only when the position genuinely branches. Kotov’s candidate-move discipline helps prevent wandering,
but do not imitate a rigid tree when transpositions, pattern knowledge, or a forced line make that inefficient. [E1–E4]

## 6. Calculate each candidate

For each candidate:

1. Make the move mentally or on a verified board.
2. Ask for the opponent’s strongest check, capture, threat, and intermediate move.
3. Identify the opponent’s best defensive concept, not merely the most natural move.
4. Continue until the line reaches a stable position, a forced result, or an unresolved horizon.
5. Re-evaluate the endpoint from scratch.
6. Note transpositions and eliminate inferior candidates only after the refutation is clear.

For live move choice, name `opponent_best_reply` and `our_response` explicitly. When runtime supports isolation, run refutation in a fresh context containing
resulting position and candidate move but not proposer rationale; this reduces anchoring on an attractive story. Calculate at least:

`our candidate → opponent best reply → our response`

Add one more opponent move for checks, sacrifices, queen attacks, exposed kings, or promotions. Reject mate in one, unresolved check,
uncompensated queen/rook/minor-piece loss, or any candidate lacking a concrete best-reply test before comparing strategic value.

Use these labels:

- `forced`: all materially relevant legal replies have been checked or a tool proves the line;
- `principal`: best-play line according to the stated analysis source;
- `illustrative`: demonstrates an idea but is not claimed as best play;
- `uncertain`: the horizon or verification is insufficient.

### Final blunder audit

Before committing to the recommendation, check:

- Is the move legal, and does it leave the mover’s king safe?
- What is the opponent’s strongest check, capture, or threat immediately afterward?
- Did the move leave a piece loose, overload a defender, or permit an intermediate move?
- Did an irreversible pawn move weaken a critical square?
- Does the proposed exchange enter a worse or drawn ending?
- Does the line accidentally allow repetition, stalemate, or a fifty-/seventy-five-move outcome?

### Confidence calibration

Separate state reconstruction, tactical safety, and strategic preference. Cap tactical safety at `0.60` without a named opponent reply and controlled-side
response. Exceed `0.80` only after all opponent checks and major captures are inspected. Reserve values above `0.90` for verified forced
lines or trivial verified recaptures.

## 7. Compare objective and practical evaluations

Keep two verdicts separate:

- **Objective:** best play from both sides.
- **Practical:** ease of play under the stated time control, clock state, and match need.

A sound but complex move may be objectively best and practically risky. A simpler move may be preferred only if
its objective cost and game context are stated. Do not use “practical” to disguise an unsound move.

Suggested human labels:

| Label | Meaning |
|---|---|
| Winning | A forced or technically established win with best play |
| Clearly better | Durable large advantage, but conversion still required |
| Slightly better | Real but limited advantage; counterplay remains |
| Equal | No demonstrable advantage with best play |
| Unclear / compensation | Imbalances resist a stable scalar verdict |
| Worse / lost | Mirror the corresponding favorable labels |

If using `+−`, `±`, `+=`, `=`, `∞`, `=+`, `∓`, or `−+`, state that symbols are from White’s perspective.

## 8. Use tools without surrendering explanation

### Legal-move and notation tools

Use them first to validate FEN, legal moves, SAN, checkmate, stalemate, repetition, and draw state. The current python-chess documentation supports
move generation and validation, SAN/FEN/PGN handling, engine communication, and Syzygy probing. [E8]

### Engines

Record engine name/version, nodes or time/depth, hardware-sensitive settings when relevant, and PV count. First obtain a strong single-PV result; use
MultiPV afterward to compare alternatives, noting that it divides search resources. Explain the strategic and tactical reason for the move.

Stockfish’s normalized evaluation is linked to win probability rather than literal pawn value; `+1.0` must not be paraphrased as “one
pawn better.” Prefer WDL probabilities when available, and preserve mate or tablebase results as distinct categories. [E7]

### Tablebases

When eligible, report win/draw/loss plus the available distance metric, and include the halfmove clock where DTZ and the fifty-move rule
matter. A tablebase result overrides heuristic evaluation for that exact legal state.

## 9. Worked process example

**Input FEN:** `1k1r4/pp1b1R2/3q2pp/4p3/2B5/4Q3/PPP2B2/2K5 b - - 0 1`

A disciplined analysis begins:

- **State:** Black to move; no castling or en-passant rights are encoded.
- **Forcing scan:** the white king on c1 and the black queen on d6 create an immediate checking candidate, `...Qd1+`, along the open d-file.
- **Mode:** tactical/forced. Pawn-structure commentary is secondary until the checks are resolved.
- **Candidate policy:** calculate `...Qd1+` first, then compare other legal checks or decisive captures; enumerate White’s strongest evasions and intermediate resources.
- **Verification:** this position is used in python-chess documentation as an EPD best-move example for `...Qd1+`. The agent should still generate
  legal SAN from the board and avoid inventing a continuation it has not checked. [E8]

This example demonstrates priority selection, not a license to stop after spotting the first check.

## 10. Common failure modes

| Failure | Correction |
|---|---|
| Material-only verdict | Rebuild the full vector and name the dominant factor |
| One-sided plan | State the opponent’s threat, counterplan, and best defense |
| Every check becomes a candidate | Keep forcing moves that survive an initial legality and refutation screen |
| Attacked piece assumed forced to retreat | Search opponent checks, captures, and mate first |
| Defended piece called safe | Compare exchange value and continuation after capture |
| Check or promotion called sound | Audit capture, block, interposition, countercheck, and destination control |
| Long rook or bishop ray omitted | Rebuild sliding attacks after every moved, vacated, or occupied square |
| Previous threat forgotten | Carry unresolved threats, loose pieces, and material ledger into next turn |
| Narrative confidence | Split confidence and cap tactical safety without concrete refutation |
| Endless calculation | Compare a small candidate set and stop at stable endpoints |
| Strategy before tactics | Run the emergency scan first |
| Engine line without explanation | Translate the PV into threats, transformations, and endpoint features |
| False certainty | State assumptions, horizon, tool limits, and confidence |
| “Trade when ahead” | Evaluate the exact resulting ending and counterplay |

## 11. Literature and source map

- **[E1]** A. D. de Groot, *Thought and Choice in Chess*, Mouton, 1965; second edition, 1978. Empirical foundation for chess thought
  processes and selection of relevant moves.
- **[E2]** M. H. Connors, B. D. Burns, and G. Campitelli, “Expertise in Complex Decision Making: The Role of Search in
  Chess 70 Years After de Groot,” *Cognitive Science* 35(8), 2011, 1567–1579, DOI: 10.1111/j.1551-6709.2011.01196.x. Modern replication supporting efficient search and pattern
  recognition.
- **[E3]** A. A. Kotov, *Think Like a Grandmaster*, Batsford edition, 2012, ISBN 9781849940535. Candidate moves and structured analysis.
- **[E4]** Jacob Aagaard, *Grandmaster Preparation: Calculation*, Quality Chess, 2012, ISBN 9781907982316. Candidate comparison, elimination, prophylaxis, intermediate moves, and calculation training.
- **[E5]** Jacob Aagaard, *Grandmaster Preparation: Positional Play*, Quality Chess, 2013, ISBN 9781907982262. Weaknesses, worst-placed piece, and prophylaxis as positional focusing questions.
- **[E6]** FIDE Rules Commission, *FIDE Laws of Chess*, current online text accessed July 23, 2026. Legality, checkmate, stalemate, dead positions,
  draw rules, and algebraic notation.
- **[E7]** Stockfish Developers, *Stockfish Documentation: Frequently Asked Questions*, current online documentation accessed July 23, 2026. Interpretation of normalized evaluation, WDL,
  tablebase scores, and MultiPV trade-offs.
- **[E8]** Niklas Fiekas et al., *python-chess 1.11.2 Documentation*, current documentation accessed July 23, 2026. Legal move generation, validation, SAN/FEN/PGN, engine communication, and tablebase probing.
- **[E9]** John Watson, *Secrets of Modern Chess Strategy: Advances Since Nimzowitsch*, Gambit, 1999, ISBN 9781901983074. Modern exceptions to rigid classical
  rules and dynamic compensation for structural concessions.
