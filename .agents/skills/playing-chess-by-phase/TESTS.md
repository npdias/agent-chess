# Acceptance Tests: Playing Chess by Phase

## Baseline failures this skill is designed to prevent

- hallucinating an opening name, main line, or novelty;
- giving opening principles without move-order or structural context;
- treating a database’s most popular move as objectively best;
- assigning phases by move number or queen presence alone;
- assuming the controlled side is White;
- naming a middlegame plan without the opponent’s break;
- resolving pawn tension automatically;
- exchanging pieces automatically when ahead or seeking a draw;
- giving endgame slogans without theoretical status or exact technique;
- recommending unsound play because a match situation “requires” it.

## Test 1 — Unknown opening branch

**Prompt:** Give a rare move order and ask, “What is the current main line?” without database access.

**Pass criteria:**

- The response does not invent theory.
- It states the last verified point or that current verification is unavailable.
- It identifies the likely structure and gives source-labeled plans or inference.

## Test 2 — Early queen exchange

**Prompt:** Provide a position on move 8 with queens exchanged but several undeveloped pieces.

**Pass criteria:**

- It classifies the position as opening transition or mixed, not automatically as a technical endgame.
- It prioritizes development, king safety, and structure before endgame slogans.

## Test 3 — Recognized Carlsbad structure

**Prompt:** Ask for a plan in a quiet Carlsbad middlegame.

**Pass criteria:**

- It mentions candidate plans such as the minority attack and central break.
- It states Black’s central/kingside counterplay.
- It checks piece placement and tactics before recommending an automatic pawn advance.

## Test 4 — Fluid central tension

**Prompt:** Give a position where either side can capture, advance, or maintain the central tension.

**Pass criteria:**

- It compares at least the materially relevant transformations.
- It evaluates resulting structures and activity, not only the immediate pawn count.
- It hands concrete move choice to `evaluating-chess-positions`.

## Test 5 — Winning endgame transition

**Prompt:** “I am an exchange up. Should I trade all the pieces?”

**Pass criteria:**

- It rejects automatic simplification.
- It compares the exact resulting ending, pawns, activity, fortresses, and counterplay.
- It recommends exchanges only when the technical outcome remains favorable.

## Test 6 — Drawing requirement

**Prompt:** “A draw wins the match, so should I exchange queens?”

**Pass criteria:**

- It establishes objective soundness first.
- It checks whether the queen trade reaches a verified draw or a dangerous pawn/minor-piece ending.
- It does not use match strategy to justify a losing move.

## Test 7 — Tablebase-eligible ending

**Prompt:** Ask for the winning method in an eligible reduced-material ending.

**Pass criteria:**

- It probes or recommends probing a tablebase.
- It distinguishes exact result from human technique.
- It includes draw-rule state when relevant.

## Test 8 — Time trouble

**Prompt:** Give a complex middlegame with 20 seconds remaining.

**Pass criteria:**

- It narrows the candidate set.
- It checks the opponent’s forcing reply and immediate threat.
- It avoids an irreversible pawn move unless tactically justified.
- It keeps objective and practical recommendations separate.

## Test 9 — Training recommendation

**Prompt:** Ask how to improve after repeatedly mishandling an isolated queen’s pawn.

**Pass criteria:**

- It recommends model games, structure-specific positions, candidate-move analysis, and relevant endgames.
- It uses an unaided postgame review before engine verification.
- It extracts reusable patterns rather than prescribing only more opening memorization.

## Test 10 — Strategy cannot bypass tactical gate

**Prompt:** Give a strategically attractive pawn break that allows mate or loses the queen on the opponent’s next move.

**Pass criteria:**

- It invokes `evaluating-chess-positions` before recommending the phase plan.
- It rejects the strategic move after concrete refutation.
- It does not use activity, initiative, space, opening theory, or phase principles as compensation without a forcing line.

## Test 11 — Black phase planning

**Prompt:** Give a Black-to-move opening-transition or middlegame FEN and ask the agent playing Black for a plan.

**Pass criteria:**

- It derives the controlled side from side to move.
- It describes `our` plan and `opponent` counterplay without assuming White identity.
- It applies the same tactical safety gate and strategic standards used when the controlled side is White.
