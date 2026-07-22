import { canHumanMove, selectHumanSquare, buildHumanMove, capabilityStorageEntries, deriveExhibitionSummary, materialSummary, replayPlyForMove, controllerColor, consumeSuppressedClick, displayedSeats } from './board-interaction.js';

const PIECES = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

export function fenToBoard(fen) {
  const placement = fen.split(' ')[0];
  const squares = [];
  for (const rank of placement.split('/')) {
    for (const token of rank) {
      if (/\d/.test(token)) {
        for (let i = 0; i < Number(token); i += 1) squares.push(null);
      } else {
        squares.push(token);
      }
    }
  }
  if (squares.length !== 64) throw new Error('INVALID_FEN');
  return squares;
}

export function squareName(index) {
  const file = String.fromCharCode(97 + (index % 8));
  const rank = 8 - Math.floor(index / 8);
  return `${file}${rank}`;
}

export function groupMoves(movesSan = []) {
  const rows = [];
  for (let i = 0; i < movesSan.length; i += 2) {
    rows.push({ number: Math.floor(i / 2) + 1, white: movesSan[i] ?? '', black: movesSan[i + 1] ?? '' });
  }
  return rows;
}

const TURN_PHASES = [
  { key: 'observe', label: 'Observe' },
  { key: 'probe', label: 'Probe' },
  { key: 'evaluate', label: 'Evaluate' },
  { key: 'choose', label: 'Choose' },
  { key: 'submit', label: 'Submit' },
];

const PHASE_ALIASES = {
  selection: 'choose',
  thinking: 'evaluate',
  demo: 'evaluate',
};

const DISCLOSURE_LABELS = {
  agent_reported: 'Agent reported',
  provider_summary: 'Provider summary',
  adapter_generated: 'Adapter generated',
};

export function deriveTurnPhase(match = {}) {
  if (match.game?.gameOver || ['completed', 'aborted', 'failed'].includes(match.status)) return { key: 'complete', label: 'Match complete' };
  const entries = activeTurnActivity(match);
  const entry = [...entries].reverse().find((item) => TURN_PHASES.some((phase) => (
    phase.key === (PHASE_ALIASES[item?.phase] ?? item?.phase)
  )));
  const key = PHASE_ALIASES[entry?.phase] ?? entry?.phase;
  const phase = TURN_PHASES.find((item) => item.key === key);
  return phase ?? { key: 'waiting', label: 'Waiting for turn' };
}

function activeTurnActivity(match = {}) {
  const activity = match.activity ?? [];
  const turnId = [...activity].reverse().find((item) => item?.type === 'turn.start')?.turnId;
  return turnId ? activity.filter((item) => item?.turnId === turnId) : activity;
}

export function derivePhaseEvidence(match = {}) {
  return new Set(activeTurnActivity(match)
    .map((item) => PHASE_ALIASES[item?.phase] ?? item?.phase)
    .filter((key) => TURN_PHASES.some((phase) => phase.key === key)));
}

export function formatActivity(entry = {}) {
  const source = ['agent', 'connector', 'system'].includes(entry.actor ?? entry.source) ? (entry.actor ?? entry.source) : 'system';
  const agent = source === 'agent';
  const typeLabels = {
    'turn.start': 'Position received',
    'moves.list': 'Piece moves checked',
    'moves.list_all': 'Legal moves checked',
    'history.list': 'History checked',
    'move.validate': 'Candidate checked',
    'move.submit': 'Move submitted',
    'opponent.move': 'Opponent moved',
    'steering.queued': 'Steering queued',
    error: entry.recoverable === false || entry.status === 'failed' ? 'Match failed' : 'Match paused',
  };
  const count = Number.isFinite(entry.count) ? `${entry.count} legal move${entry.count === 1 ? '' : 's'}` : '';
  const meta = entry.type === 'moves.list' && entry.square && count ? `${entry.square} · ${count}` : entry.selectedMove ?? '';
  const fallback = agent && entry.phase ? 'Agent working' : source === 'connector' ? 'Connector status' : 'Verified system event';
  const tracePhase = TURN_PHASES.find((phase) => phase.key === (PHASE_ALIASES[entry.phase] ?? entry.phase));
  const traceLabel = tracePhase?.label ?? (entry.kind === 'decision' ? 'Decision' : source === 'connector' ? 'Connector status' : 'Status');
  return {
    label: entry.type === 'agent.decision' ? 'Decision' : entry.type === 'agent.trace' ? traceLabel : (typeLabels[entry.type] ?? 'System event'),
    meta,
    detail: entry.summary?.trim() || entry.message?.trim() || fallback,
    source,
    ...(DISCLOSURE_LABELS[entry.source] ? { disclosureSource: entry.source, disclosureLabel: DISCLOSURE_LABELS[entry.source] } : {}),
    candidates: Array.isArray(entry.candidates) ? entry.candidates.slice(0, 3) : [],
  };
}

export function buildAgentInviteUrl(origin, joinPath) {
  return new URL(joinPath, origin).toString();
}

export function selectDecisionBrief(match = {}) {
  const decision = [...(match.activity ?? [])].reverse().find((entry) => (
    entry?.type === 'agent.decision'
    && entry?.actor === 'agent'
    && DISCLOSURE_LABELS[entry?.source]
  ));
  if (decision) return {
    state: 'decision',
    intent: decision.summary?.trim() || 'Agent published a structured decision.',
    candidates: Array.isArray(decision.candidates) ? decision.candidates.slice(0, 4).map(({ uci, note }) => ({ uci, note })) : [],
    selectedMove: decision.selectedMove ?? '',
    disclosure: DISCLOSURE_LABELS[decision.source],
  };
  if (match.status === 'failed') return { state: 'failed', intent: 'Match failed before an agent decision was published.', candidates: [], selectedMove: '', disclosure: 'System status' };
  const phase = deriveTurnPhase(match);
  const phaseCopy = { observe: 'observing', probe: 'probing', evaluate: 'evaluating', choose: 'choosing', submit: 'submitting' };
  if (phase.key !== 'waiting' && phase.key !== 'complete') return { state: 'working', intent: `Agent is ${phaseCopy[phase.key] ?? 'working on'} current position.`, candidates: [], selectedMove: '', disclosure: 'Phase status' };
  return { state: 'empty', intent: 'No public agent decision yet.', candidates: [], selectedMove: '', disclosure: 'No disclosure' };
}

export function selectActivityEntries(match = {}) {
  const seen = new Set();
  const activity = match.activity ?? [];
  const trace = activity.length ? (match.trace ?? []).filter((entry) => entry.type === 'steering.queued') : match.trace ?? [];
  return [...activity, ...trace]
    .filter((entry) => {
      const key = [entry.type, entry.source, entry.at, entry.phase, entry.summary, entry.message, entry.uci, entry.san].join('\u0000');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => String(right.at ?? '').localeCompare(String(left.at ?? '')));
}

export function buildActivityEntry(doc, item) {
  const formatted = formatActivity(item);
  const entry = doc.createElement('article');
  entry.className = `trace-entry ${formatted.source}`;
  const title = doc.createElement('strong');
  title.textContent = `${formatted.disclosureLabel ?? `${formatted.source[0].toUpperCase()}${formatted.source.slice(1)}`} · ${formatted.label}`;
  entry.append(title);
  if (item.at) {
    const time = doc.createElement('small');
    time.textContent = new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.append(time);
  }
  if (formatted.meta) {
    const meta = doc.createElement('span');
    meta.className = 'activity-meta';
    meta.textContent = formatted.meta;
    entry.append(meta);
  }
  const detail = doc.createElement('p');
  detail.textContent = formatted.detail;
  entry.append(detail);
  if (formatted.candidates.length) {
    const candidates = doc.createElement('ul');
    candidates.className = 'candidate-list';
    for (const candidate of formatted.candidates) {
      const candidateItem = doc.createElement('li');
      const move = doc.createElement('code');
      move.textContent = candidate.uci;
      candidateItem.append(move);
      if (candidate.note) {
        const note = doc.createElement('span');
        note.textContent = ` ${candidate.note}`;
        candidateItem.append(note);
      }
      candidates.append(candidateItem);
    }
    entry.append(candidates);
  }
  return entry;
}

export function deriveMatchSummary(match) {
  return deriveExhibitionSummary(match);
}

export function buildExhibitionPayload({ matchup, color, skillLevel }) {
  const agent = matchup === 'agent-engine';
  return {
    controller: { kind: agent ? 'agent' : 'human', name: agent ? 'My agent' : 'Human' },
    opponent: { kind: matchup === 'human-agent' ? 'agent' : 'engine', name: matchup === 'human-agent' ? 'My agent' : 'Computer' },
    color,
    skillLevel: Number(skillLevel),
    movetimeMs: 150,
  };
}

export function materialPerspective(ownedControllerColor, humanColor) {
  return ownedControllerColor ?? humanColor ?? 'white';
}

export function buildReviewItem(doc, label, value) {
  const row = doc.createElement('div'); row.className = 'review-item';
  const name = doc.createElement('span'); name.textContent = label;
  const detail = doc.createElement('strong'); detail.textContent = value;
  row.append(name, detail);
  return row;
}

function qs(id) { return document.getElementById(id); }
let boardFlipped = false;
let currentMatch = null;
let eventSocket;
let toastTimer;
let humanCapability = null;
let humanColor = null;
let ownedControllerColor = null;
let selection = { selected: null, legalTargets: [], legalMoves: [] };
let replayPly = null;
let pendingMove = false;
let dragFrom = null;
let suppressClick = false;
let previousLiveFen = null;
let boardAnimationTimer = null;
let boardAnimationActive = false;
let queuedBoardMatch = null;

function toast(message) {
  const node = qs('toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 1800);
}

async function copyText(text, success = 'Copied') {
  await navigator.clipboard.writeText(text);
  toast(success);
}

function makePiece(piece, name) {
  const token = document.createElement('span');
  token.className = `piece ${piece === piece.toUpperCase() ? 'white-piece' : 'black-piece'}`;
  token.dataset.piece = piece;
  token.textContent = PIECES[piece];
  token.setAttribute('aria-label', `${piece === piece.toUpperCase() ? 'white' : 'black'} piece on ${name}`);
  return token;
}

function initializeBoard(board) {
  if (board.dataset.initialized === 'true') return;
  const indexes = Array.from({ length: 64 }, (_, index) => index);
  for (const index of indexes) {
    const name = squareName(index);
    const row = Math.floor(index / 8);
    const col = index % 8;
    const square = document.createElement('button');
    square.type = 'button';
    square.className = `square ${(row + col) % 2 ? 'dark' : 'light'}`;
    square.dataset.square = name;
    square.addEventListener('click', () => { const click = consumeSuppressedClick(suppressClick); suppressClick = click.suppressed; if (click.handle) handleSquare(name); });
    square.addEventListener('pointerdown', () => { dragFrom = name; });
    square.addEventListener('pointerup', () => { if (dragFrom && dragFrom !== name) { suppressClick = true; selection = selectHumanSquare(selection, dragFrom, currentMatch, humanColor); handleSquare(name); } dragFrom = null; });
    const rank = document.createElement('small');
    rank.className = 'rank-label';
    const file = document.createElement('small');
    file.className = 'file-label';
    square.append(rank, file);
    board.append(square);
  }
  board.dataset.initialized = 'true';
}

function clearBoardAnimation() {
  clearTimeout(boardAnimationTimer);
  boardAnimationTimer = null;
  boardAnimationActive = false;
  qs('board')?.querySelectorAll('.move-animation, .capture-animation').forEach((piece) => {
    piece.classList.remove('move-animation', 'capture-animation');
    piece.style.transform = '';
  });
  if (queuedBoardMatch) {
    const next = queuedBoardMatch;
    queuedBoardMatch = null;
    renderBoard(next);
  }
}

export function deriveBoardTransitions(previous, current, lastMove) {
  const from = lastMove.slice(0, 2);
  const to = lastMove.slice(2, 4);
  const fromIndex = previous.findIndex((_, index) => squareName(index) === from);
  const toIndex = current.findIndex((_, index) => squareName(index) === to);
  const moving = previous[fromIndex];
  if (!moving || !current[toIndex]) return { transfers: [], captureSquares: [] };
  const transfers = [{ from, to, piece: current[toIndex] }];
  if (moving.toLowerCase() === 'k' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {
    const rank = from[1];
    const rookFrom = to[0] === 'g' ? `h${rank}` : `a${rank}`;
    const rookTo = to[0] === 'g' ? `f${rank}` : `d${rank}`;
    const rookIndex = previous.findIndex((_, index) => squareName(index) === rookFrom);
    const rookToIndex = current.findIndex((_, index) => squareName(index) === rookTo);
    if (previous[rookIndex]?.toLowerCase() === 'r' && current[rookToIndex] === previous[rookIndex]) {
      transfers.push({ from: rookFrom, to: rookTo, piece: current[rookToIndex] });
    }
  }
  const removedOpponent = previous
    .map((piece, index) => ({ piece, index }))
    .filter(({ piece, index }) => piece && piece !== moving && (piece === piece.toUpperCase()) !== (moving === moving.toUpperCase()) && !current[index])
    .map(({ index }) => squareName(index));
  const captureSquares = [previous[toIndex] && (previous[toIndex] === previous[toIndex].toUpperCase()) !== (moving === moving.toUpperCase()) ? to : null, ...removedOpponent].filter(Boolean);
  return { transfers, captureSquares };
}

function reconcileBoardPieces(board, pieces, animation) {
  const byName = new Map([...board.children].map((square) => [square.dataset.square, square]));
  if (animation) {
    for (const captureSquare of animation.captureSquares) {
      const capturedSquare = byName.get(captureSquare);
      const captured = capturedSquare.querySelector('.piece');
      if (captured) {
        captured.classList.add('capture-animation');
        setTimeout(() => captured.remove(), 190);
      }
    }
    for (const transfer of animation.transfers) {
      const fromSquare = byName.get(transfer.from);
      const toSquare = byName.get(transfer.to);
      const moving = fromSquare.querySelector('.piece');
      if (!moving) continue;
      moving.dataset.piece = transfer.piece;
      moving.textContent = PIECES[transfer.piece];
      moving.setAttribute('aria-label', `${transfer.piece === transfer.piece.toUpperCase() ? 'white' : 'black'} piece on ${transfer.to}`);
      toSquare.append(moving);
      const fromRect = fromSquare.getBoundingClientRect();
      const toRect = toSquare.getBoundingClientRect();
      moving.style.transform = `translate(${fromRect.left - toRect.left}px, ${fromRect.top - toRect.top}px)`;
      moving.classList.add('move-animation');
      requestAnimationFrame(() => requestAnimationFrame(() => { moving.style.transform = ''; }));
    }
  }
  for (const [name, square] of byName) {
    const piece = pieces.find((_, index) => squareName(index) === name);
    const tokens = [...square.querySelectorAll('.piece')];
    const retained = tokens.find((token) => token.dataset.piece === piece);
    tokens.filter((token) => token !== retained && !token.classList.contains('capture-animation')).forEach((token) => token.remove());
    if (piece && !retained) square.append(makePiece(piece, name));
  }
}

function renderBoard(match) {
  if (boardAnimationActive) { queuedBoardMatch = match; return; }
  const board = qs('board');
  initializeBoard(board);
  const displayFen = replayPly === null ? match.game.fen : (match.game.positions?.[replayPly] ?? match.game.fen);
  const pieces = fenToBoard(displayFen);
  const lastMove = match.game.movesUci.at(-1) ?? '';
  const from = lastMove.slice(0, 2);
  const to = lastMove.slice(2, 4);
  const orientationChanged = board.dataset.orientation && board.dataset.orientation !== String(boardFlipped);
  board.dataset.orientation = String(boardFlipped);
  const indexes = Array.from({ length: 64 }, (_, index) => index);
  if (boardFlipped) indexes.reverse();
  indexes.forEach((index) => board.append([...board.children].find((square) => square.dataset.square === squareName(index))));

  const previous = previousLiveFen && fenToBoard(previousLiveFen);
  const fromIndex = previous?.findIndex((_, index) => squareName(index) === from);
  const toIndex = pieces.findIndex((_, index) => squareName(index) === to);
  const shouldAnimate = replayPly === null && !pendingMove && !orientationChanged && previous && fromIndex >= 0 && toIndex >= 0 && previous[fromIndex] && pieces[toIndex] && (pieces[toIndex] === previous[fromIndex] || lastMove.length === 5);
  const byName = new Map([...board.children].map((square) => [square.dataset.square, square]));
  const transitions = previous && deriveBoardTransitions(previous, pieces, lastMove);
  const animation = shouldAnimate ? transitions : null;
  reconcileBoardPieces(board, pieces, animation);

  for (const index of indexes) {
    const piece = pieces[index];
    const name = squareName(index);
    const row = Math.floor(index / 8);
    const col = index % 8;
    const visualRow = boardFlipped ? 7 - row : row;
    const visualCol = boardFlipped ? 7 - col : col;
    const square = byName.get(name);
    square.setAttribute('aria-label', `${name}${piece ? ` ${piece}` : ''}`);
    square.classList.toggle('last-move', name === from || name === to);
    square.classList.toggle('selected', selection.selected === name);
    square.classList.toggle('legal-capture', selection.legalTargets.includes(name) && Boolean(piece));
    square.classList.toggle('legal-target', selection.legalTargets.includes(name) && !piece);
    square.classList.toggle('in-check', Boolean(match.game.inCheck && piece?.toLowerCase() === 'k' && (piece === piece.toUpperCase()) === (match.game.turn === 'white')));
    square.classList.toggle('submission-pending', pendingMove);
    square.disabled = !humanCapability || !canHumanMove(match, humanColor) || replayPly !== null || pendingMove;
    square.querySelector('.rank-label').textContent = visualCol === 0 ? name[1] : '';
    square.querySelector('.file-label').textContent = visualRow === 7 ? name[0] : '';
  }
  if (replayPly === null) previousLiveFen = match.game.fen;
  if (animation) {
    boardAnimationActive = true;
    boardAnimationTimer = setTimeout(clearBoardAnimation, 220);
  }
}

function renderMoves(match) {
  const list = qs('moves');
  const rows = groupMoves(match.game.movesSan);
  list.replaceChildren();
  if (!rows.length) {
    list.innerHTML = '<div class="trace-empty">Moves will appear after the agent connects.</div>';
    return;
  }
  rows.forEach((move, index) => {
    const row = document.createElement('div');
    row.className = `move-row ${index === rows.length - 1 ? 'current' : ''}`;
    row.classList.add('move-row');
    const number = document.createElement('span');
    number.textContent = move.number + '.';
    row.append(number);
    for (const [color, san] of [['white', move.white], ['black', move.black]]) {
      if (!san) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = san;
      button.addEventListener('click', () => { replayPly = replayPlyForMove(index, color); qs('return-live').hidden = false; renderBoard(match); });
      row.append(button);
    }
    list.append(row);
  });
  list.scrollTop = list.scrollHeight;
}

function renderTrace(match) {
  const trace = qs('activity');
  const activity = selectActivityEntries(match);
  trace.replaceChildren();
  if (!activity.length) {
    trace.innerHTML = '<div class="trace-empty"><strong>Waiting for activity</strong><p>Verified system events plus optional agent summaries appear after connector starts.</p></div>';
    return;
  }
  for (const item of activity) trace.append(buildActivityEntry(document, item));
}

function renderDecisionBrief(match) {
  const brief = selectDecisionBrief(match);
  qs('decision-intent').textContent = brief.intent;
  qs('decision-disclosure').textContent = brief.disclosure;
  const candidates = qs('decision-candidates');
  candidates.replaceChildren();
  brief.candidates.forEach((candidate) => {
    const row = document.createElement('div');
    const move = document.createElement('code'); move.textContent = candidate.uci;
    row.append(move);
    if (candidate.note) { const note = document.createElement('span'); note.textContent = candidate.note; row.append(note); }
    candidates.append(row);
  });
  const selected = qs('decision-selected');
  selected.hidden = !brief.selectedMove;
  selected.textContent = brief.selectedMove ? `Selected move: ${brief.selectedMove}` : '';
}

function renderStatusLine(match) {
  const current = deriveTurnPhase(match);
  qs('phase-current').textContent = current.label;
}

function renderReview(match, summary) {
  const panel = qs('post-match');
  panel.hidden = !summary.review;
  if (!summary.review) return;
  qs('review-headline').textContent = summary.status;
  qs('review-copy').textContent = `Completed after ${summary.moveCount} full moves.`;
  const items = [
    ['Final result', match.game.result],
    ['Termination', summary.termination],
    ['White', match.seats.white.name],
    ['Trace events', String(match.trace.length)],
  ];
  qs('review-list').replaceChildren(...items.map(([label, value]) => buildReviewItem(document, label, value)));
}

function renderPlayerStrips(match, summary = deriveMatchSummary(match)) {
  for (const [position, seat] of Object.entries(displayedSeats(match.seats, boardFlipped))) {
    qs(`${position}-name`).textContent = seat.name ?? seat.color;
    qs(`${position}-color`).textContent = `${seat.color[0].toUpperCase()}${seat.color.slice(1)}`;
    qs(`${position}-kind`).textContent = seat.kindLabel;
    qs(`${position}-avatar`).className = `avatar avatar-${seat.kind}`;
    qs(`${position}-avatar`).textContent = (seat.name ?? seat.kindLabel).slice(0, 2).toUpperCase();
    qs(`${position}-state`).textContent = summary.review ? 'Finished' : match.game.turn === seat.color ? 'To move' : 'No clock';
  }
}

function render(match) {
  currentMatch = match;
  const summary = deriveMatchSummary(match);
  qs('empty-state').hidden = true;
  qs('match-view').hidden = false;
  const seats = match.seats ?? {};
  qs('connection').textContent = 'Unrated exhibition';
  qs('connection').dataset.connected = String(match.connected);
  qs('engine').textContent = 'Unrated exhibition';
  qs('match-title').textContent = summary.review ? summary.status : `${seats.white?.name ?? 'White'} vs ${seats.black?.name ?? 'Black'}`;
  renderPlayerStrips(match, summary);
  qs('fen').textContent = match.game.fen;
  const material = materialSummary(match.game.positions?.[0] ?? match.game.fen, match.game.fen, materialPerspective(ownedControllerColor, humanColor));
  qs('material').textContent = `Captured: ${material.captured.join(', ') || 'none'} · Material ${material.difference >= 0 ? '+' : ''}${material.difference}`;
  qs('steering-form').hidden = true;
  qs('steering-locked').hidden = false;
  qs('steering-state').textContent = 'No clock';
  qs('status-title').textContent = summary.status;
  renderStatusLine(match);
  renderBoard(match);
  renderMoves(match);
  renderTrace(match);
  renderDecisionBrief(match);
  renderReview(match, summary);
  const ownsAgentSeat = Object.entries(seats).some(([color, seat]) => seat.kind === 'agent' && sessionStorage.getItem(`${match.id}:capability:${color}`));
  const connector = qs('connector');
  connector.hidden = !ownsAgentSeat;
  connector.classList.toggle('connected', Boolean(match.connected));
  qs('connector-title').textContent = match.connected ? 'Local agent connected' : 'Connect local agent';
  qs('connector-steps').hidden = Boolean(match.connected);
  qs('copy-agent-link').hidden = Boolean(match.connected);
  qs('copy-command').hidden = Boolean(match.connected);
  qs('connect-command').hidden = true;
  qs('connector-feedback').textContent = match.connected ? 'Connection confirmed. Agent link no longer needed.' : 'Ticket remains private until copied.';
  qs('lifecycle-action').hidden = summary.review || !humanCapability;
  qs('lifecycle-action').textContent = (match.game.movesSan?.length ?? 0) ? 'Resign' : 'Abort';
}

async function createMatch(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const response = await fetch('/api/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildExhibitionPayload({ matchup: form.get('matchup'), color: form.get('humanColor'), skillLevel: form.get('skillLevel') })),
  });
  if (!response.ok) throw new Error(await response.text());
  const created = await response.json();
  const url = new URL(location.href);
  url.searchParams.set('match', created.matchId);
  history.replaceState(null, '', url);
  humanColor = null;
  ownedControllerColor = null;
  capabilityStorageEntries(created.matchId, created.capabilities).forEach(([key, capability]) => sessionStorage.setItem(key, capability));
  await loadMatch(created.matchId);
}

async function loadMatch(matchId) {
  const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}`);
  if (!response.ok) {
    qs('empty-state').hidden = false;
    qs('match-view').hidden = true;
    return;
  }
  const match = await response.json();
  ownedControllerColor = controllerColor(matchId, match.seats, (key) => sessionStorage.getItem(key));
  humanColor = match.seats?.[ownedControllerColor]?.kind === 'human' ? ownedControllerColor : null;
  humanCapability = humanColor && sessionStorage.getItem(`${matchId}:capability:${humanColor}`);
  if (ownedControllerColor) boardFlipped = ownedControllerColor === 'black';
  render(match);
  eventSocket?.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  eventSocket = new WebSocket(`${protocol}//${location.host}/events?matchId=${encodeURIComponent(matchId)}`);
  eventSocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'match.state') render(message.match);
  });
}

async function handleSquare(square) {
  if (!currentMatch || !humanCapability) return;
  if (selection.selected && selection.legalTargets.includes(square)) {
    const result = buildHumanMove(selection, square);
    if (result?.promotionRequired) return choosePromotion(square, result.promotionOptions);
    if (result?.moveUci) return submitHumanMove(result.moveUci);
  }
  selection = selectHumanSquare(selection, square, currentMatch, humanColor);
  renderBoard(currentMatch);
}

function choosePromotion(destination, options) {
  const dialog = qs('promotion-dialog');
  dialog.showModal();
  dialog.addEventListener('close', () => {
    const result = buildHumanMove(selection, destination, dialog.returnValue);
    if (options.includes(dialog.returnValue) && result?.moveUci) submitHumanMove(result.moveUci);
  }, { once: true });
}

async function submitHumanMove(moveUci) {
  pendingMove = true; renderBoard(currentMatch);
  const response = await fetch(`/api/matches/${encodeURIComponent(currentMatch.id)}/human-moves`, { method: 'POST', headers: { authorization: `Bearer ${humanCapability}`, 'content-type': 'application/json' }, body: JSON.stringify({ turnId: currentMatch.activeTurn.turnId, moveUci }) });
  pendingMove = false; selection = { selected: null, legalTargets: [], legalMoves: [] };
  if (response.status !== 202) { toast('Move rejected'); await loadMatch(currentMatch.id); return; }
  await loadMatch(currentMatch.id);
}

async function sendSteering(event) {
  event.preventDefault();
  const input = qs('steering-input');
  const guidance = input.value.trim();
  if (!guidance) return;
  const matchId = new URL(location.href).searchParams.get('match');
  const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/steering`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guidance }),
  });
  if (response.ok) {
    input.value = '';
    toast('Guidance queued');
  } else {
    toast('Guidance rejected');
  }
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function boot() {
  qs('create-match').addEventListener('submit', createMatch);
  qs('steering-form').addEventListener('submit', sendSteering);
  qs('skill-level').addEventListener('input', (event) => { qs('skill-output').value = event.target.value; });
  qs('matchup').addEventListener('change', (event) => {
    const agent = event.target.value === 'agent-engine';
    qs('color-label').firstChild.textContent = agent ? 'Agent plays as' : 'Play as';
    qs('engine-skill').hidden = event.target.value === 'human-agent';
    qs('skill-level').disabled = event.target.value === 'human-agent';
  });
  qs('new-match-button').addEventListener('click', () => { location.href = '/'; });
  qs('flip-board').addEventListener('click', () => { boardFlipped = !boardFlipped; if (currentMatch) { renderBoard(currentMatch); renderPlayerStrips(currentMatch); } });
  async function mintAgentSession() {
    const agentColor = currentMatch && Object.entries(currentMatch.seats).find(([, seat]) => seat.kind === 'agent')?.[0];
    const agentCapability = agentColor && sessionStorage.getItem(`${currentMatch.id}:capability:${agentColor}`);
    if (!agentCapability) return null;
    const response = await fetch('/api/agent-sessions', { method: 'POST', headers: { authorization: `Bearer ${agentCapability}` } });
    if (!response.ok) { toast('Connector unavailable'); return null; }
    return response.json();
  }
  qs('copy-agent-link').addEventListener('click', async () => {
    const session = await mintAgentSession();
    if (!session) return;
    await copyText(buildAgentInviteUrl(location.origin, session.joinPath), 'Agent link copied. Expires in 60 seconds.');
    qs('connector-feedback').textContent = 'Agent link copied. Expires in 60 seconds.';
  });
  qs('copy-command').addEventListener('click', async () => {
    const session = await mintAgentSession();
    if (!session) return;
    qs('connect-command').textContent = `npm run --silent connect -- --server ${location.origin} --path ${shellQuote(session.wsPath)} --command ./your-agent`;
    qs('connect-command').hidden = false;
    await copyText(qs('connect-command').textContent, 'Connector command copied. Expires in 60 seconds.');
    qs('connector-feedback').textContent = 'Terminal command copied. Expires in 60 seconds.';
  });
  qs('copy-pgn').addEventListener('click', () => currentMatch?.pgn && copyText(currentMatch.pgn, 'PGN copied'));
  qs('share-match').addEventListener('click', () => currentMatch && copyText(`${location.origin}/?match=${encodeURIComponent(currentMatch.id)}`, 'Spectator link copied'));
  qs('focus-mode').addEventListener('click', (event) => { document.documentElement.classList.toggle('focus-mode'); event.currentTarget.setAttribute('aria-pressed', String(document.documentElement.classList.contains('focus-mode'))); });
  qs('return-live').addEventListener('click', () => { replayPly = null; qs('return-live').hidden = true; if (currentMatch) renderBoard(currentMatch); });
  qs('lifecycle-action').addEventListener('click', async () => {
    if (!currentMatch || !humanCapability) return;
    const action = qs('lifecycle-action').textContent.toLowerCase();
    if (!confirm(`${action[0].toUpperCase()}${action.slice(1)} this match?`)) return;
    const response = await fetch(`/api/matches/${encodeURIComponent(currentMatch.id)}/${action}`, { method: 'POST', headers: { authorization: `Bearer ${humanCapability}` } });
    if (!response.ok) return toast(`${action} rejected`);
    await loadMatch(currentMatch.id);
  });
  qs('download-match').addEventListener('click', async () => {
    if (!currentMatch) return;
    const response = await fetch(`/api/matches/${encodeURIComponent(currentMatch.id)}/export`, { headers: humanCapability ? { authorization: `Bearer ${humanCapability}` } : {} });
    if (!response.ok) return toast('Download unavailable');
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${currentMatch.id}.json`; link.click(); URL.revokeObjectURL(url);
  });
  const matchId = new URL(location.href).searchParams.get('match');
  if (matchId) loadMatch(matchId);
}

if (typeof window !== 'undefined') window.addEventListener('DOMContentLoaded', boot);
