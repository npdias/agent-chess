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
  if (!stateIsCurrent || moves.length === 0) return emptyState(square, match);
  if (state?.selected === square) return emptyState(square, match);

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
