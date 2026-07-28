# Acceptance Tests: Evaluating Chess Positions

These are behavior tests for an agent with the skill loaded. A response fails if any critical condition is missed,
even when the final move happens to be good.

## Baseline failures this skill is designed to prevent

- giving a material-only evaluation;
- overlooking that the side to move is in check;
- inventing castling or en-passant rights from a diagram;
- recommending the first attractive check without testing defenses;
- assuming the controlled side is White;
- analyzing only one side’s ideas;
- assuming an attacked opponent must respond to the attack;
- assuming a defended piece or checking move is tactically safe;
- forgetting a threat, loose piece, or material change from the previous turn;
- presenting an engine score as literal pawn value;
- claiming forced mate or tablebase certainty without verification;
- using “practical” as a synonym for unsound.

## Test 1 — In-check gate

**Prompt:** Provide a legal FEN in which the side to move is checked and ask for a strategic plan.

**Pass criteria:**

- The response first states that the side is in check.
- It considers legal evasions only before discussing longer-term plans.
- It does not recommend a quiet move that fails to answer check.

## Test 2 — Diagram with missing history

**Prompt:** Give only a board image in which castling appears geometrically possible and ask whether castling is best.

**Pass criteria:**

- The response says castling rights cannot be established from piece placement alone.
- It requests or conditions the answer on FEN/PGN.
- It does not assume en passant, repetition, or halfmove state.

## Test 3 — Sharp tactical position

**Prompt:** Ask for the best move in a position with multiple checks and a hanging queen.

**Pass criteria:**

- It performs a two-sided forcing scan.
- It compares at least two materially relevant candidates unless one move is legally forced.
- It calculates the opponent’s strongest countercheck or intermediate move.
- It labels lines as forced, principal, illustrative, or uncertain.

## Test 4 — Quiet strategic position

**Prompt:** Give a balanced middlegame with no immediate tactic.

**Pass criteria:**

- It identifies weaknesses, worst-placed pieces, the opponent’s idea, and pawn breaks.
- It names a dominant factor rather than listing features without priority.
- It creates a compact role-diverse candidate set.

## Test 5 — Engine score interpretation

**Prompt:** “Stockfish says +1.0. Does that mean White is exactly a pawn up?”

**Pass criteria:**

- It answers no.
- It explains that current Stockfish evaluation is normalized toward winning probability, not literal material.
- It asks for or states engine version, search conditions, perspective, and WDL when available.

## Test 6 — Technical ending

**Prompt:** Give a tablebase-eligible position with a nonzero halfmove clock and ask whether it is won.

**Pass criteria:**

- It prioritizes tablebase verification when available.
- It reports WDL and the relevant distance metric.
- It considers the halfmove clock and draw rules.

## Test 7 — No tool access

**Prompt:** Ask for a forced 12-move line while denying engine or board tools.

**Pass criteria:**

- It does not fabricate verification.
- It separates human analysis from proven fact.
- It gives a confidence level and horizon limitation.

## Test 8 — Final output shape

**Prompt:** Any nontrivial FEN with a request for a move and explanation.

**Pass criteria:** The response contains, in order, position status, tactical facts, static/dynamic evaluation, opponent idea, candidates, critical lines, recommendation, evaluation
label, practical assessment, confidence, and verification status.

## Test 9 — Post-move recapture gate

**Prompt:** Present a capture that looks winning on the current board, but whose destination becomes capturable after a vacated square
opens a bishop or rook line. Include one case where an h-file rook can recapture on h6 after `...Rh8`.

**Pass criteria:**

- The analysis rebuilds the board after the proposed move rather than using only the current attack map.
- It explicitly checks pawn, knight, bishop, rook, queen, and king recaptures of the destination.
- It rejects the capture when the recapture loses material without verified compensation.
- It never labels the capture or its destination safe before this audit passes.

## Test 10 — Black-to-move neutrality

**Prompt:** FEN `r4rk1/pbpn1pp1/1n1pp2p/pN2P1q1/5P2/1B6/PPP3PP/R2Q1RK1 b - - 0 16`. Ask the agent playing Black to move.

**Pass criteria:**

- It derives that the controlled side is Black from side to move.
- It finds `...Qxg2#`.
- It does not use White-centric labels such as “our White pieces.”
- It treats color as position data, not agent identity.

## Test 11 — Attacking does not force a response

**Prompt:** Use the Test 10 position and ask whether Black must move the attacked queen after `f4`.

**Pass criteria:**

- It explicitly states that an attacked piece need not retreat when a stronger check, capture, or mate exists.
- It scans Black’s forcing moves before considering queen retreats.
- It identifies `...Qxg2#` as overriding the pawn attack.

## Test 12 — Destination-square ray audit

**Prompt:** FEN `r5k1/1pp1Qpp1/pn3n1p/3P1q2/3P3B/P1P2P2/2P2P1P/R3R1K1 w - - 3 19`. Ask whether `Qd8+` is safe.

**Pass criteria:**

- It rebuilds the position after `Qd8+`.
- It traces the rook ray `a8-b8-c8-d8`.
- It rejects `Qd8+` because `...Rxd8` loses the queen.
- It does not treat check as proof of soundness.

## Test 13 — Defended does not mean safe

**Prompt:** FEN `r1b1kbnr/pp5p/6p1/q1p1N1BQ/1nPP4/8/PP3PPP/RN2KB1R w KQ - 0 11`. Ask whether `Qg4` is safe because the knight on e5 protects g4.

**Pass criteria:**

- It states that defense permits a recapture; it does not make an exchange favorable.
- It finds the bishop ray `c8-d7-e6-f5-g4`.
- It rejects `Qg4` because `...Bxg4` trades a bishop for the queen, and it also checks forcing alternatives for Black.

## Test 14 — Promotion and check bias

**Prompt:** FEN `r3k2r/ppP1b2p/5np1/4q3/3p2b1/3K4/PP3PPP/RN3B1R w - - 3 20`. Ask whether `c8=Q+` is sound.

**Pass criteria:**

- It audits control of the promotion square after promotion.
- It finds `...Rxc8`.
- It rejects the move despite promotion with check.

## Test 15 — Persistent state and last-move delta

**Prompt:** Give two consecutive turns where the opponent’s first move attacks a piece and the controlled side’s first response does
not resolve it. On the next turn, ask for a plan.

**Pass criteria:**

- It preserves unresolved threats and currently en prise pieces across turns.
- It records material changes before generating new plans.
- It states what the opponent’s last move attacked, opened, closed, or threatened.
- It does not reset to generic strategic evaluation.

## Test 16 — Candidate refutation contract

**Prompt:** Any tactical FEN with at least three plausible legal candidates, one allowing mate, one hanging a queen or rook,
and one tactically viable move.

**Pass criteria:**

- It generates no more than three role-distinct candidates.
- For every candidate it names `opponent_best_reply` and `our_response`.
- It rejects mate and uncompensated major-piece loss before strategic comparison.
- It selects only among surviving candidates.

## Test 17 — Confidence calibration

**Prompt:** Ask for confidence on a tactically sharp move without supplying a verified opponent reply.

**Pass criteria:**

- It separates `state_confidence`, `tactical_safety_confidence`, and `strategic_preference_confidence`.
- Tactical safety does not exceed `0.60` without a concrete opponent reply and response.
- Confidence above `0.80` requires inspection of all opponent checks and major captures.
- It never uses fluent explanation as evidence of tactical safety.

## Test 18 — Refuter independence

**Prompt:** Supply three candidates where one has a persuasive strategic rationale but loses immediately.

**Pass criteria:**

- Refutation runs as a fresh pass or fresh context when runtime supports isolation.
- Refuter receives resulting position and candidate, not proposer’s persuasive rationale.
- Selector receives concrete lines and survivor status, not narrative popularity.
- Persuasive but refuted candidate is rejected.
