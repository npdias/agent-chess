function positionKey(match) {
  const game = match?.game ?? {};
  return game.fen ?? `${game.turn ?? ''}:${game.ply ?? ''}`;
}

function movesFrom(match, square) {
  return (match?.game?.legalMoves ?? []).filter((move) => move?.from === square);
}

function emptyState(focusedSquare, match) {
  return {
    selected: null,
    legalTargets: [],
    legalMoves: [],
    focusedSquare,
    positionKey: positionKey(match),
  };
}

function promotionFor(move) {
  return move.promotion ?? move.uci?.slice(4) ?? null;
}

export function canHumanMove(match, color) {
  return Boolean(
    match?.status === 'active'
    && !match.game?.gameOver
    && match.game?.turn === color
    && match.seats?.[color]?.kind === 'human'
  );
}

export function legalMovesFrom(match, square) {
  return [...new Set(movesFrom(match, square).map((move) => move.to))];
}

export function selectHumanSquare(state, square, match, color) {
  if (!canHumanMove(match, color)) return emptyState(square, match);

  const stateIsCurrent = state?.positionKey === undefined || state.positionKey === positionKey(match);
  const moves = movesFrom(match, square);
  if (!stateIsCurrent) return emptyState(square, match);
  if (state?.selected === square) return emptyState(square, match);
  if (moves.length === 0 && state?.selected) return state;
  if (moves.length === 0) return emptyState(square, match);

  return {
    selected: square,
    legalTargets: [...new Set(moves.map((move) => move.to))],
    legalMoves: moves.map((move) => ({ ...move })),
    focusedSquare: square,
    positionKey: positionKey(match),
  };
}

export function buildHumanMove(state, destination, promotion) {
  if (!state?.selected || !Array.isArray(state.legalMoves)) return null;

  const candidates = state.legalMoves.filter((move) => (
    move?.from === state.selected && move.to === destination
  ));
  if (candidates.length === 0) return null;

  const promotions = [...new Set(candidates.map(promotionFor).filter(Boolean))];
  if (promotions.length > 0 && !promotion) {
    return { moveUci: null, promotionRequired: true, promotionOptions: promotions };
  }

  const move = candidates.find((candidate) => promotionFor(candidate) === promotion)
    ?? (promotions.length === 0 ? candidates[0] : null);
  return move ? { moveUci: move.uci, promotionRequired: false } : null;
}

export function capabilityStorageEntries(matchId, capabilities = {}) {
  return Object.entries(capabilities).map(([color, capability]) => [`${matchId}:capability:${color}`, capability]);
}

function titleCase(value) {
  return String(value ?? '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function outcomeTermination(match = {}, game = {}) {
  if (match.termination) return titleCase(match.termination);
  if (game.checkmate) return 'Checkmate';
  if (game.draw) return 'Draw';
  return '—';
}

export function deriveOutcome(match = {}) {
  const game = match.game ?? {};
  const seats = match.seats ?? {};
  const terminal = ['completed', 'aborted', 'failed'].includes(match.status) || game.gameOver;
  const terminationKey = typeof match.termination === 'string' ? match.termination.toLowerCase() : '';
  const decisiveEvidence = ['checkmate', 'resignation', 'game_over'].includes(terminationKey)
    || (!terminationKey && game.checkmate === true);
  const drawEvidence = terminationKey === 'draw' || (!terminationKey && game.draw === true);
  const result = typeof game.result === 'string' ? game.result : '*';
  const moveCount = Math.ceil((game.movesSan?.length ?? 0) / 2);
  const termination = outcomeTermination(match, game);
  const decisiveColor = result === '1-0' ? 'white' : result === '0-1' ? 'black' : null;

  if (match.status === 'completed' && decisiveEvidence && decisiveColor) {
    const color = titleCase(decisiveColor);
    const winnerName = seats[decisiveColor]?.name ?? color;
    return {
      terminal, kind: 'decisive', headline: `${winnerName} wins`,
      secondary: `${color} · ${result.replace('-', '–')} · ${termination}`,
      resultLabel: result, termination, winnerColor: decisiveColor, winnerName, moveCount,
    };
  }

  if (match.status === 'completed' && drawEvidence && (result === '1/2-1/2' || game.draw)) {
    const resultLabel = result === '1/2-1/2' ? result : '1/2-1/2';
    return {
      terminal, kind: 'draw', headline: 'Draw', secondary: `${resultLabel} · ${termination}`,
      resultLabel, termination, winnerColor: null, winnerName: null, moveCount,
    };
  }

  const headline = match.status === 'aborted' || match.termination === 'aborted'
    ? 'Match aborted'
    : match.status === 'failed' || match.termination === 'failure'
      ? 'Match failed'
      : terminal ? 'Match complete' : '';
  return {
    terminal, kind: terminal ? 'status' : 'live', headline,
    secondary: terminal ? (termination === '—' ? 'No result recorded' : termination) : '',
    resultLabel: terminal ? 'No result' : 'In progress', termination,
    winnerColor: null, winnerName: null, moveCount,
  };
}

export function deriveExhibitionSummary(match = {}) {
  const game = match.game ?? {};
  const active = match.seats?.[game.turn] ?? {};
  const outcome = deriveOutcome(match);
  const status = outcome.terminal ? outcome.headline : `${active.name ?? game.turn ?? 'Match'} to move`;
  return { status, resultLabel: outcome.resultLabel, termination: outcome.termination, moveCount: outcome.moveCount, review: outcome.terminal, activeName: active.name ?? '' };
}

export function materialSummary(initialFen, currentFen, perspective = 'white') {
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const initial = String(initialFen).split(' ')[0];
  const current = String(currentFen).split(' ')[0];
  const count = (fen, piece) => [...fen].filter((token) => token === piece).length;
  const missing = { white: {}, black: {} };
  let difference = 0;
  for (const [piece, value] of Object.entries(values)) {
    for (const color of ['white', 'black']) {
      const token = color === 'white' ? piece.toUpperCase() : piece;
      missing[color][piece] = Math.max(0, count(initial, token) - count(current, token));
    }
  }
  for (const color of ['white', 'black']) {
    const promoted = ['q', 'r', 'b', 'n'].reduce((sum, piece) => sum + Math.max(0, count(current, color === 'white' ? piece.toUpperCase() : piece) - count(initial, color === 'white' ? piece.toUpperCase() : piece)), 0);
    missing[color].p = Math.max(0, missing[color].p - promoted);
  }
  const captured = Object.entries(missing).flatMap(([color, pieces]) => Object.entries(pieces).flatMap(([piece, amount]) => Array(amount).fill(`${color} ${piece === 'p' ? 'pawn' : ({ n: 'knight', b: 'bishop', r: 'rook', q: 'queen' }[piece])}`)));
  for (const [piece, value] of Object.entries(values)) {
    difference += (count(current, perspective === 'white' ? piece.toUpperCase() : piece) - count(current, perspective === 'white' ? piece : piece.toUpperCase())) * value;
  }
  return { captured, difference };
}

export function controllerColor(matchId, seats = {}, getCapability) {
  return Object.entries(seats).find(([color, seat]) => ['human', 'agent'].includes(seat.kind) && getCapability(`${matchId}:capability:${color}`))?.[0] ?? null;
}

export function consumeSuppressedClick(suppressed) {
  return { handle: !suppressed, suppressed: false };
}

export function displayedSeats(seats = {}, flipped = false) {
  const kindLabel = (kind) => ({ human: 'Human', agent: 'Agent', engine: 'Engine' }[kind] ?? 'Player');
  const display = (color) => ({ color, ...seats[color], kindLabel: kindLabel(seats[color]?.kind) });
  return flipped
    ? { top: display('white'), bottom: display('black') }
    : { top: display('black'), bottom: display('white') };
}

export function replayPlyForMove(index, color) {
  return index * 2 + (color === 'black' ? 2 : 1);
}
