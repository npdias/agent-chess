import { canHumanMove, selectHumanSquare, buildHumanMove, capabilityStorageEntries, deriveExhibitionSummary, materialSummary, replayPlyForRow, controllerColor, consumeSuppressedClick, displayedSeats } from './board-interaction.js';

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
    error: 'Match paused',
  };
  const count = Number.isFinite(entry.count) ? `${entry.count} legal move${entry.count === 1 ? '' : 's'}` : '';
  const meta = entry.type === 'moves.list' && entry.square && count ? `${entry.square} · ${count}` : entry.selectedMove ?? '';
  const fallback = agent && entry.phase ? 'Agent working' : source === 'connector' ? 'Connector status' : 'Verified system event';
  const tracePhase = TURN_PHASES.find((phase) => phase.key === (PHASE_ALIASES[entry.phase] ?? entry.phase));
  const traceLabel = tracePhase?.label ?? (entry.kind === 'decision' ? 'Decision' : source === 'connector' ? 'Connector status' : 'Status');
  return {
    label: entry.type === 'agent.trace' ? traceLabel : (typeLabels[entry.type] ?? 'System event'),
    meta,
    detail: entry.summary?.trim() || entry.message?.trim() || fallback,
    source,
    ...(['agent_reported', 'provider_summary', 'adapter_generated'].includes(entry.source) ? { disclosureSource: entry.source } : {}),
    candidates: Array.isArray(entry.candidates) ? entry.candidates.slice(0, 3) : [],
  };
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
  title.textContent = `${formatted.disclosureSource ?? `${formatted.source[0].toUpperCase()}${formatted.source.slice(1)}`} · ${formatted.label}`;
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
let selection = { selected: null, legalTargets: [], legalMoves: [] };
let replayPly = null;
let pendingMove = false;
let dragFrom = null;
let suppressClick = false;

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

function renderBoard(match) {
  const board = qs('board');
  const displayFen = replayPly === null ? match.game.fen : (match.game.positions?.[replayPly] ?? match.game.fen);
  const pieces = fenToBoard(displayFen);
  const lastMove = match.game.movesUci.at(-1) ?? '';
  const from = lastMove.slice(0, 2);
  const to = lastMove.slice(2, 4);
  const indexes = Array.from({ length: 64 }, (_, index) => index);
  if (boardFlipped) indexes.reverse();
  board.replaceChildren();

  for (const index of indexes) {
    const piece = pieces[index];
    const name = squareName(index);
    const row = Math.floor(index / 8);
    const col = index % 8;
    const visualRow = boardFlipped ? 7 - row : row;
    const visualCol = boardFlipped ? 7 - col : col;
    const square = document.createElement('button');
    square.type = 'button';
    square.setAttribute('aria-label', `${name}${piece ? ` ${piece}` : ''}`);
    square.className = `square ${(row + col) % 2 ? 'dark' : 'light'}`;
    square.dataset.square = name;
    if (name === from || name === to) square.classList.add('last-move');
    if (selection.selected === name) square.classList.add('selected');
    if (selection.legalTargets.includes(name)) square.classList.add(piece ? 'legal-capture' : 'legal-target');
    if (match.game.inCheck && piece?.toLowerCase() === 'k' && (piece === piece.toUpperCase()) === (match.game.turn === 'white')) square.classList.add('in-check');
    if (pendingMove) square.classList.add('submission-pending');
    square.disabled = !humanCapability || !canHumanMove(match, humanColor) || replayPly !== null || pendingMove;
    square.addEventListener('click', () => { const click = consumeSuppressedClick(suppressClick); suppressClick = click.suppressed; if (click.handle) handleSquare(name); });
    square.addEventListener('pointerdown', () => { dragFrom = name; });
    square.addEventListener('pointerup', () => { if (dragFrom && dragFrom !== name) { suppressClick = true; selection = selectHumanSquare(selection, dragFrom, currentMatch, humanColor); handleSquare(name); } dragFrom = null; });
    if (piece) {
      const token = document.createElement('span');
      token.className = `piece ${piece === piece.toUpperCase() ? 'white-piece' : 'black-piece'}`;
      token.textContent = PIECES[piece];
      token.setAttribute('aria-label', `${piece === piece.toUpperCase() ? 'white' : 'black'} piece on ${name}`);
      square.append(token);
    }
    if (visualCol === 0) {
      const rank = document.createElement('small');
      rank.className = 'rank-label';
      rank.textContent = name[1];
      square.append(rank);
    }
    if (visualRow === 7) {
      const file = document.createElement('small');
      file.className = 'file-label';
      file.textContent = name[0];
      square.append(file);
    }
    board.append(square);
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
    row.replaceChildren(...[move.number + '.', move.white, move.black].map((value) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = value; return button; }));
    row.addEventListener('click', () => { replayPly = replayPlyForRow(index, Boolean(move.black), match.game.movesSan.length); qs('return-live').hidden = false; renderBoard(match); });
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

function renderPhaseRibbon(match) {
  const current = deriveTurnPhase(match);
  const evidence = derivePhaseEvidence(match);
  qs('phase-current').textContent = current.label;
  qs('phase-ribbon').replaceChildren(...TURN_PHASES.map((phase, index) => {
    const item = document.createElement('li');
    const complete = evidence.has(phase.key) && phase.key !== current.key;
    item.className = complete ? 'complete' : phase.key === current.key ? 'current' : '';
    item.innerHTML = `<span aria-hidden="true">${complete ? '✓' : index + 1}</span><strong>${phase.label}</strong>`;
    return item;
  }));
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
  const material = materialSummary(match.game.positions?.[0] ?? match.game.fen, match.game.fen, humanColor);
  qs('material').textContent = `Captured: ${material.captured.join(', ') || 'none'} · Material ${material.difference >= 0 ? '+' : ''}${material.difference}`;
  qs('steering-form').hidden = true;
  qs('steering-locked').hidden = false;
  qs('steering-state').textContent = 'No clock';
  qs('status-title').textContent = summary.status;
  qs('summary-result').textContent = summary.resultLabel;
  qs('summary-moves').textContent = String(summary.moveCount);
  qs('summary-steering').textContent = 'No clock';
  qs('summary-termination').textContent = summary.termination;
  renderPhaseRibbon(match);
  renderBoard(match);
  renderMoves(match);
  renderTrace(match);
  renderReview(match, summary);
  qs('connector').hidden = !Object.entries(seats).some(([color, seat]) => seat.kind === 'agent' && sessionStorage.getItem(`${match.id}:capability:${color}`));
  qs('lifecycle-action').hidden = summary.review;
  qs('lifecycle-action').textContent = (match.game.movesSan?.length ?? 0) ? 'Resign' : 'Abort';
}

async function createMatch(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const response = await fetch('/api/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ human: { kind: 'human', name: 'Human' }, opponent: { kind: form.get('opponentKind'), name: form.get('opponentKind') === 'engine' ? 'Computer' : 'My agent' }, color: form.get('humanColor'), skillLevel: Number(form.get('skillLevel')), movetimeMs: 150 }),
  });
  if (!response.ok) throw new Error(await response.text());
  const created = await response.json();
  const url = new URL(location.href);
  url.searchParams.set('match', created.matchId);
  history.replaceState(null, '', url);
  humanColor = form.get('humanColor') === 'random' ? null : form.get('humanColor');
  if (humanColor) boardFlipped = humanColor === 'black';
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
  humanColor = controllerColor(matchId, match.seats, (key) => sessionStorage.getItem(key));
  humanCapability = humanColor && sessionStorage.getItem(`${matchId}:capability:${humanColor}`);
  if (humanCapability) boardFlipped = humanColor === 'black';
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

function selectTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${name}`));
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function boot() {
  qs('create-match').addEventListener('submit', createMatch);
  qs('steering-form').addEventListener('submit', sendSteering);
  qs('skill-level').addEventListener('input', (event) => { qs('skill-output').value = event.target.value; });
  qs('new-match-button').addEventListener('click', () => { location.href = '/'; });
  qs('flip-board').addEventListener('click', () => { boardFlipped = !boardFlipped; if (currentMatch) { renderBoard(currentMatch); renderPlayerStrips(currentMatch); } });
  qs('copy-command').addEventListener('click', async () => {
    const agentColor = currentMatch && Object.entries(currentMatch.seats).find(([, seat]) => seat.kind === 'agent')?.[0];
    const agentCapability = agentColor && sessionStorage.getItem(`${currentMatch.id}:capability:${agentColor}`);
    if (!agentCapability) return;
    const response = await fetch('/api/agent-sessions', { method: 'POST', headers: { authorization: `Bearer ${agentCapability}` } });
    if (!response.ok) return toast('Connector unavailable');
    const session = await response.json();
    qs('connect-command').textContent = `npm run connect -- --server ${location.origin} --path ${shellQuote(session.wsPath)} --command ./your-agent`;
    copyText(qs('connect-command').textContent, 'Connector command copied');
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
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
  const matchId = new URL(location.href).searchParams.get('match');
  if (matchId) loadMatch(matchId);
}

if (typeof window !== 'undefined') window.addEventListener('DOMContentLoaded', boot);
