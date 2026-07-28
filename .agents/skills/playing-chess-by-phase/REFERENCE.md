# Professional Reference: Opening, Middlegame, Endgame, and Transitions

## 0. Apply strategy only after tactical survival

Derive the controlled side from side to move; call it `us`, call the other side `opponent`. Phase knowledge proposes plans,
not tactical permission. Every concrete move must first survive `evaluating-chess-positions`: rebuilt post-move board, opponent’s strongest forcing reply, controlled-side response, and
catastrophe rejection. Apply opening, middlegame, endgame, clock, or match preferences only among survivors.

## 1. Classify the phase by the work the position demands

| Phase | Typical evidence | Main question |
|---|---|---|
| Opening | Development, king safety, central setup, and known move orders remain decisive | What structure and piece placement is this move order trying to reach? |
| Opening transition | One or both sides leave verified theory; development and structure are partly settled | Which plan replaces memory, and what changed on the last move? |
| Middlegame | Most pieces can participate; plans, pawn breaks, attacks, and transformations dominate | Which imbalance and break should organize play? |
| Endgame transition | Exchanges make king activity, pawn races, or technical families increasingly important | Is the proposed liquidation favorable and technically manageable? |
| Technical endgame | A known theoretical mechanism or tablebase result can govern play | What exact technique, drawing method, or distance condition applies? |
| Mixed | Opening knowledge, tactics, and endgame consequences are simultaneously critical | Which mode has priority on this move? |

Move number and queen presence are weak classifiers. An early queen exchange can leave opening tasks unfinished; queen endgames remain
endgames when king activity, passed pawns, and checking geometry dominate.

## 2. Opening play: understand, verify, then remember

### 2.1 Source discipline

Every opening claim should carry one of these statuses:

- **Verified theory:** confirmed in a current trusted repertoire or master database.
- **Database tendency:** frequent or successful in a defined sample; not automatically best.
- **Engine preference:** favored under stated engine conditions; may be impractical or transpositional.
- **Published concept:** a stable plan or structure from literature/model games.
- **Agent inference:** derived from principles and calculation; not represented as established theory.

Opening theory changes. Never fabricate a variation name, ECO code, novelty, or “main line.” State the last verified move and
switch to position analysis when sources end.

### 2.2 Opening priorities, with the exception rule

Classical priorities remain useful:

- influence the center;
- develop pieces with purpose;
- secure the king;
- coordinate pieces and connect rooks;
- avoid unnecessary tempi and irreversible weaknesses;
- understand the intended pawn structure.

But these are not laws. Modern practice accepts delayed castling, flank development, structural concessions, repeated piece moves, and temporary loss
of time when concrete dynamics justify them. Watson’s account of modern strategy is particularly useful against rigid rule application. [P1–P3]

### 2.3 Build an opening plan packet

For the current opening or repertoire branch, output:

1. **Identity and move-order risks:** name, transpositions, and anti-systems only when verified.
2. **Structural destination:** likely center and pawn skeleton.
3. **Ideal pieces:** two or three key squares or routes for each side.
4. **Thematic breaks:** usually one primary and one secondary break, including preparation.
5. **Tactical motifs:** recurring sacrifices, pins, trapped pieces, mating patterns, or move-order tricks.
6. **Favorable exchanges:** which pieces each side wants to retain or trade.
7. **Bad version warning:** a common setup that looks normal but misplaces a piece or concedes a break.
8. **Model games:** representative games chosen for plans, not merely famous names.
9. **Exit rule:** the first move beyond verified knowledge and the plan to use afterward.

Paul van der Sterren emphasizes verbal understanding and the character of openings rather than masses of variations; Capablanca supplies durable
fundamentals, while modern sources supply exceptions and current move-order detail. [P1–P3]

### 2.4 Repertoire design for serious players

When building a repertoire, specify:

- target structures and whether they fit the player’s strengths;
- theoretical workload and update frequency;
- main line, practical backup, and anti-surprise option;
- White repertoire plus Black responses to `1.e4`, `1.d4`, and flank openings;
- desired risk level for classical, rapid, and blitz;
- model games and recurring endgames;
- version date and source provenance.

Do not select an opening solely from database win percentage. Rating mix, color, era, sample size, transpositions, and selection effects distort raw results.

## 3. The opening-to-middlegame handoff

At the first unverified move, stop replaying memory and perform a transition report:

- What did the last move change tactically?
- Which pawn structure now exists or is likely?
- Which piece is worst placed?
- What is the opponent threatening or preparing?
- Which pawn breaks are available, and who benefits from them?
- Which exchanges favor each side?
- Is either king still unsafe or development incomplete?
- Does a known model game or structure apply?

The correct opening outcome is not merely “equal evaluation.” It is a position whose plans, risks, and typical transformations the player can handle.

## 4. Middlegame play: organize the position around structure and breaks

### 4.1 Map the center

Classify the center as open, closed, mobile, fixed, or fluid.

- **Open:** development, activity, king safety, and line control rise in value.
- **Closed:** pawn breaks, maneuvering routes, space, and wing play dominate.
- **Mobile:** calculate advances, blockades, and transformation before the pawn mass moves.
- **Fixed:** attack bases, weak squares, and bad pieces created by the structure.
- **Fluid:** preserving or resolving tension is itself a critical decision.

### 4.2 Structure playbook

The following plans are starting hypotheses, never automatic moves. Flores Rios and Sokolov ground middlegame planning in recurring structures and model games. [P4, P5]

| Structure | Typical plan for the space/structural side | Typical counterplan |
|---|---|---|
| Carlsbad | Minority attack with `b4–b5`, central `e4` break, exploit c-file/c6 targets | Central or kingside activity, `...Ne4`, `...f5`, timely `...c5` or piece pressure |
| Isolated queen’s pawn | Activity, open files, outposts, `e5` or `d5` advance, attack before simplification | Blockade, exchange active pieces, pressure the pawn, reach favorable ending |
| Hanging pawns | Dynamic `c5`/`d5` advances, space, active pieces | Provoke or restrain advances; fixed pawns become targets |
| French-type chain | Attack the chain’s base and prepare the thematic wing break | Counter the head/base from the opposite side; strike with `...c5` or `...f6` as appropriate |
| Hedgehog | Preserve flexibility, improve pieces, prepare `...b5` or `...d5` | Restrict breaks without overextension; convert space into entry squares |
| Maróczy bind | Control `d5`, improve slowly, restrict breaks | Prepare `...b5` or `...d5`, exchange restraining pieces, seek active counterplay |
| Benoni structures | Use central/queenside space and the `e5` break when sound | Queenside activity and timely pawn breaks; exploit dark squares or e-file dynamics |
| Stonewall | Kingside space, outposts, attack, or favorable minor-piece setup | Challenge the bad bishop, attack weakened squares, open the position at the right moment |

### 4.3 Choose a plan

A professional plan should answer:

1. What is the dominant imbalance?
2. Which weakness can actually be attacked?
3. Which piece is worst placed, and where should it go?
4. What does the opponent want next?
5. Which pawn break changes the position favorably?
6. Which exchange improves or damages the position?
7. What must be calculated now rather than planned abstractly?

Aagaard’s weaknesses–pieces–prophylaxis framework focuses positional judgment; Gelfand’s games emphasize space, squeezes, and transformation of pawn structures and advantages. [P6, P7]

### 4.4 Manage tension and transformations

For every central or wing tension, compare:

- **maintain:** preserve options and restrict the opponent;
- **capture:** clarify structure or gain a concrete tempo;
- **advance:** gain space, close lines, or force a weakness;
- **sacrifice:** open lines or change material balance for concrete compensation.

Evaluate the position **after** the transformation. A favorable static structure may be irrelevant if the opponent gains activity; a damaged
structure may be acceptable if it secures initiative or a lasting square.

### 4.5 Attack and defense

For an attack:

- secure local piece superiority or rapid transfer routes;
- identify the line or square that must open;
- remove a key defender or create a second entry point;
- calculate the defender’s strongest exchange, countercheck, or central break;
- distinguish a real attack from wishful piece accumulation.

For defense:

- name the exact threat;
- exchange the most dangerous attacker when safe;
- close or contest the critical line;
- create flight squares and reduce tactical motifs;
- return material when it kills the attack;
- seek central or opposite-wing counterplay rather than passive waiting.

### 4.6 Convert positional advantages

Use a conversion ladder:

1. Suppress or quantify counterplay.
2. Improve the least active piece.
3. Fix a weakness so it cannot move.
4. Increase pressure without releasing the defender.
5. Create a second weakness or passed pawn.
6. Calculate the decisive break or entry.
7. Simplify only when the resulting ending is verified as favorable.

This reflects the literature on maneuvering, transformation, and technical decision-making rather than the slogan “trade pieces when ahead.” [P6–P8]

## 5. Endgame and “closing” technique

### 5.1 Establish the status

Classify the ending as:

- **tablebase-exact**;
- **known theoretical family** with a memorized technique;
- **practical technical ending** requiring plans and calculation;
- **fortress/perpetual/stalemate candidate**;
- **uncertain transition** whose result depends on a pending exchange.

Dvoretsky’s manual remains the central advanced reference; de la Villa offers a frequency-oriented core of essential endings. [P9, P10]

### 5.2 Universal priorities

- Activate the king when tactical conditions permit.
- Maximize rook activity; passive rooks frequently lose drawing chances.
- Create, support, blockade, or attack passed pawns.
- Preserve reserve tempi and identify zugzwang.
- Calculate pawn races exactly, including promotion checks.
- Improve the least active piece before rushing.
- Restrict counterplay before collecting pawns.
- Do not exchange into a pawn ending without calculating it to a stable result.

### 5.3 Theoretical families to recognize

| Family | Required knowledge |
|---|---|
| King and pawn | Opposition, key squares, outflanking, shouldering, triangulation, corresponding squares, breakthrough, reserve tempi |
| Rook endings | Lucena, Philidor, Vancura, cutting off the king, checking distance, short-side/long-side defense, rook placement relative to passed pawns |
| Bishop endings | Wrong rook pawn, color complexes, outside passers, opposite-colored bishop fortresses, bishop versus connected pawns |
| Knight endings | Blockade, domination, reserve tempi, pawns on both wings, knight routes and zugzwang |
| Queen endings | Perpetual-check zones, king shelter, checking distance, queen trades, promotion with check |
| Mixed material | Exchange-versus-pawns, rook and minor coordination, fortress patterns, favorable liquidation |

### 5.4 Winning conversion ladder

1. Confirm the win or advantage; use tablebase when eligible.
2. Eliminate the opponent’s active counterplay.
3. Activate king and pieces to their best squares.
4. Fix targets and avoid unnecessary pawn moves.
5. Create a passed pawn or second weakness.
6. Force favorable exchanges without releasing the defender.
7. Calculate the final pawn break, promotion race, or theoretical setup.

### 5.5 Defensive ladder

1. Identify the attacker’s conversion method.
2. Maximize activity and checking distance.
3. Attack pawns or create a passed pawn rather than defend everything passively.
4. Seek simplifying exchanges that enter a known draw.
5. Build fortress, perpetual, stalemate, or opposite-colored-bishop mechanisms.
6. Track repetition and fifty-/seventy-five-move conditions.
7. Force the opponent to prove technique under the clock.

## 6. Practical tournament decisions

Objective evaluation comes first. Then adjust:

- **Clock:** spend time when the position is irreversible, tactically forcing, or transformation-heavy; move faster in familiar, stable positions.
- **Need to win:** prefer sound complexity and retained tension; do not choose a losing move merely because it is messy.
- **Need to draw:** simplify only into a verified draw or low-risk mechanism; premature exchanges can enter a lost pawn ending.
- **Opponent style:** use only as a tie-breaker among sound choices.
- **Time trouble:** narrow to legal forcing moves, necessary defense, and one robust improving move; audit checks and captures before moving.

## 7. Training loop for an AI coach

1. Have the player analyze without an engine and write candidates, evaluation, and clock usage.
2. Identify critical decisions, not every small evaluation change.
3. Compare with opening sources, engine, and tablebase in that order as relevant.
4. Explain why the player’s candidate set or evaluation failed.
5. Extract one reusable rule, one pattern position, and one calculation exercise.
6. Add model games for the recurring structure.
7. Re-test the same theme after delay through spaced retrieval.

Pattern knowledge and relevant candidate selection are central to expert performance; model games and repeated structure work build that library. [P4, P5, P11]

## 8. Worked transition example: Carlsbad structure

Suppose a Queen’s Gambit move order has produced a Carlsbad pawn structure and exact theory is no longer verified.

A good phase report is:

- **Phase:** opening transition to middlegame.
- **Source status:** structure is recognized; the exact move order and current main line require database verification.
- **White’s candidate plans:** minority attack with `b4–b5`, central expansion with `e4`, or piece improvement before either break.
- **Black’s counterplay:** central/kingside activity, pressure on e3/e4, an outpost on e4, and timely pawn breaks.
- **Decision test:** do not play `b4` automatically. Check whether development, tactical control of b5, a kingside threat, or an immediate
  central break changes the priority.
- **Handoff:** use `evaluating-chess-positions` to compare the concrete preparation moves and the opponent’s strongest response.

This is superior to reciting “minority attack” without checking piece placement and counterplay.

## 9. Common failure modes

| Failure | Correction |
|---|---|
| Memorized opening line with no plan | Produce the plan packet and exit rule |
| Controlled side assumed White | Derive us/opponent from side to move every turn |
| Strategic story overrides refutation | Reject concrete tactical failure before phase comparison |
| Invented main line or novelty | Mark source status and verify current data |
| Database popularity treated as truth | Separate frequency, performance, engine, and human practicality |
| Generic middlegame advice | Name the structure, break, piece route, target, and counterplan |
| Automatic release of tension | Compare maintain/capture/advance/sacrifice endpoints |
| “Queens off means endgame” | Classify by position demands, not one exchange |
| “Trade everything when ahead” | Verify the exact resulting ending and counterplay |
| Passive defense | Seek activity, exchanges into known draws, and counterplay |
| Match strategy before chess quality | Establish objective soundness first |

## 10. Literature and source map

- **[P1]** José Raúl Capablanca, *Chess Fundamentals*, originally published 1921; public-domain Project Gutenberg edition 33870. Durable opening, middlegame, and endgame fundamentals.
- **[P2]** Paul van der Sterren, *FCO: Fundamental Chess Openings*, Gambit, 2009, ISBN 9781906454135. Verbal explanations, plans, and opening character rather than rote variation volume.
- **[P3]** John Watson, *Secrets of Modern Chess Strategy: Advances Since Nimzowitsch*, Gambit, 1999, ISBN 9781901983074. Modern refinements and exceptions to classical rules.
- **[P4]** Mauricio Flores Rios, *Chess Structures: A Grandmaster Guide*, Quality Chess, 2015, ISBN 9781784830007. Common pawn structures, model games, plans, patterns, and pitfalls.
- **[P5]** Ivan Sokolov, *Winning Chess Middlegames*, New In Chess; structure-focused editions covering recurring `1.d4` and `1.e4` pawn formations. Space, tension, initiative, and model games.
- **[P6]** Jacob Aagaard, *Grandmaster Preparation: Positional Play*, Quality Chess, 2013, ISBN 9781907982262. Weaknesses, pieces, and prophylaxis.
- **[P7]** Boris Gelfand with Jacob Aagaard, *Positional Decision Making in Chess*, Quality Chess, 2015. Space, squeezes, transformation of pawn structures, and transformation of advantages.
- **[P8]** Mark Dvoretsky, *Maneuvering: The Art of Piece Play*, Russell Enterprises, 2016, ISBN 9781941270370. Positional operations, piece routes, and best squares across all phases.
- **[P9]** Mark Dvoretsky, *Dvoretsky’s Endgame Manual*, sixth edition, revised by Karsten Müller and Alex Fishbein, Russell Enterprises, 2025, paperback ISBN
  9781963885101. Advanced theoretical and practical endgame reference.
- **[P10]** Jesús de la Villa, *100 Endgames You Must Know*, New In Chess, 2015; later editions. Frequency-oriented essential endgame knowledge and practical technique.
- **[P11]** Axel Smith, *Pump Up Your Rating*, Quality Chess, 2013; second edition. Training methods spanning opening preparation, middlegame play, endgame technique, and psychology.
- **[P12]** FIDE Rules Commission, *FIDE Laws of Chess*, current online text accessed July 23, 2026. Legal completion, draw mechanisms, clocks, notation, and competition rules.
