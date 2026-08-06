import { canHumanMove, selectHumanSquare, buildHumanMove, capabilityStorageEntries, deriveExhibitionSummary, deriveOutcome, materialSummary, replayPlyForMove, controllerColor, consumeSuppressedClick, displayedSeats } from './board-interaction.js';

export { deriveOutcome };

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

const BOARD_SETTLE_MS = 460;
const CAPTURE_FADE_MS = 300;
const AGENT_ACTIVITY_STALE_MS = 30_000;
const OBSERVER_HEARTBEAT_STALE_MS = 15_000;

export function deriveTurnPhase(match = {}) {
  if (match.game?.gameOver || ['completed', 'aborted', 'failed'].includes(match.status)) return { key: 'complete', label: 'Match complete' };
  if (activeTurnSeat(match).kind === 'agent' && !currentTurnEntries(match).some((entry) => entry?.type === 'agent.turn.ready')) {
    return { key: 'waiting', label: 'Waiting for agent' };
  }
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

function timestampMs(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTurnDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(seconds % 1 ? 1 : 0)}s`;
}

function activeTurnId(match = {}) {
  return match.activeTurn?.turnId
    ?? [...(match.activity ?? [])].reverse().find((entry) => entry?.type === 'turn.start')?.turnId
    ?? null;
}

function currentTurnEntries(match = {}) {
  const turnId = activeTurnId(match);
  return turnId ? (match.activity ?? []).filter((entry) => entry?.turnId === turnId) : [];
}

function activeTurnSeat(match = {}) {
  return match.seats?.[match.activeTurn?.activeColor ?? match.game?.turn] ?? {};
}

function agentTurnElapsed(entries, endAt, connectedAtEnd) {
  let elapsed = 0;
  let segmentStartedAt = null;
  let delivered = false;
  for (const entry of [...entries].sort((left, right) => timestampMs(left.at) - timestampMs(right.at))) {
    const at = timestampMs(entry.at);
    if (at === null || at > endAt) continue;
    if (entry.type === 'agent.turn.ready') {
      delivered = true;
      if (segmentStartedAt === null) segmentStartedAt = at;
      continue;
    }
    if (entry.type === 'agent.disconnect' && segmentStartedAt !== null) {
      elapsed += Math.max(0, at - segmentStartedAt);
      segmentStartedAt = null;
    }
  }
  if (segmentStartedAt !== null && connectedAtEnd) elapsed += Math.max(0, endAt - segmentStartedAt);
  return delivered ? elapsed : null;
}

export function deriveTurnTiming(match = {}, now = Date.now()) {
  const activity = match.activity ?? [];
  const currentTurnId = activeTurnId(match);
  const currentStart = currentTurnId
    ? [...activity].reverse().find((entry) => entry?.type === 'turn.start' && entry.turnId === currentTurnId)
    : null;
  const currentStartedAt = timestampMs(currentStart?.at);
  const activeSeat = activeTurnSeat(match);
  const agentTurn = activeSeat.kind === 'agent';
  const agentAvailable = Boolean(match.connected || match.agentSessionActive);
  const currentEntries = currentTurnEntries(match);
  const currentMs = terminalMatch(match) || currentStartedAt === null ? null
    : agentTurn ? agentTurnElapsed(currentEntries, now, agentAvailable)
      : Math.max(0, now - currentStartedAt);
  const completedMove = [...activity].reverse().find((entry) => entry?.type === 'move.submit' && timestampMs(entry.at) !== null);
  const completedStart = completedMove
    ? [...activity].reverse().find((entry) => entry?.type === 'turn.start' && entry.turnId === completedMove.turnId)
    : null;
  const completedStartedAt = timestampMs(completedStart?.at);
  const completedAt = timestampMs(completedMove?.at);
  const completedEntries = completedMove?.turnId
    ? activity.filter((entry) => entry?.turnId === completedMove.turnId)
    : [];
  const completedAgentTurn = completedEntries.some((entry) => entry?.type === 'agent.turn.ready');
  const lastMs = completedStartedAt === null || completedAt === null ? null
    : completedAgentTurn ? agentTurnElapsed(completedEntries, completedAt, true)
      : Math.max(0, completedAt - completedStartedAt);
  const currentLabel = currentMs === null
    ? agentTurn && !agentAvailable ? 'Waiting for agent connection' : 'Current turn time unavailable'
    : agentTurn && !agentAvailable ? `Agent disconnected · ${formatTurnDuration(currentMs)} elapsed` : `Current turn ${formatTurnDuration(currentMs)}`;
  return {
    currentMs,
    lastMs,
    currentLabel,
    lastLabel: lastMs === null ? 'Last turn time unavailable' : `Last turn ${formatTurnDuration(lastMs)}`,
  };
}

export function deriveLiveStatus(match = {}, { now = Date.now(), observer = {} } = {}) {
  if (terminalMatch(match)) {
    if (match.status === 'failed') {
      if (match.failureCode === 'AGENT_DECISION_TIMEOUT') return { state: 'failed', title: 'Agent decision timed out', detail: 'Server ended this match after its decision deadline.' };
      if (match.failureCode === 'ENGINE_FAILURE') return { state: 'failed', title: 'Evaluator failed', detail: 'Server ended this match after evaluator failure.' };
      return { state: 'failed', title: 'Match failed', detail: match.failureCode ? `Failure code: ${match.failureCode}` : 'Server reported a terminal failure.' };
    }
    if (match.status === 'aborted') {
      const aborted = [...(match.activity ?? [])].reverse().find((entry) => entry?.type === 'match.abort');
      return { state: 'aborted', title: 'Match aborted', detail: aborted?.summary || 'A player aborted before play began.' };
    }
    const outcome = deriveOutcome(match);
    return { state: 'complete', title: outcome.headline, detail: outcome.secondary };
  }
  if (observer.state === 'disconnected') return { state: 'disconnected', title: 'Live updates disconnected', detail: 'Last known game state is shown.' };
  const lastSignalAt = Number.isFinite(observer.lastSignalAt) ? observer.lastSignalAt : null;
  if (lastSignalAt !== null && now - lastSignalAt > OBSERVER_HEARTBEAT_STALE_MS) {
    return { state: 'unavailable', title: 'Live status unavailable', detail: 'No server heartbeat received. Last known game state is shown.' };
  }
  const owner = deriveTurnOwnerStatus(match, null);
  const activeSeat = match.seats?.[match.game?.turn] ?? {};
  const turnDelivered = currentTurnEntries(match).some((entry) => entry?.type === 'agent.turn.ready');
  if (activeSeat.kind === 'agent' && !turnDelivered) {
    if (!match.connected && !match.agentSessionActive) {
      return { state: 'offline', title: `Waiting on ${activeSeat.name ?? 'agent'}`, detail: 'Invite remains unclaimed. Timer starts after agent receives this turn.' };
    }
    return { state: 'offline', title: `Waiting on ${activeSeat.name ?? 'agent'}`, detail: 'Agent session is active; server has not delivered this turn yet.' };
  }
  if (activeSeat.kind === 'agent' && !match.connected && !match.agentSessionActive) {
    return { state: 'offline', title: `${activeSeat.name ?? 'Agent'} disconnected`, detail: 'Turn timer is paused until agent reconnects and receives this turn.' };
  }
  const latestActivity = [...currentTurnEntries(match)].reverse().find((entry) => timestampMs(entry.at) !== null);
  const latestActivityAt = timestampMs(latestActivity?.at);
  if (activeSeat.kind === 'agent' && latestActivityAt !== null && now - latestActivityAt > AGENT_ACTIVITY_STALE_MS) {
    const seconds = Math.floor((now - latestActivityAt) / 1000);
    const sessionState = match.connected ? 'Connection remains open.' : 'Agent session remains active.';
    return { state: 'stale', title: 'Agent status not confirmed', detail: `No public activity for ${seconds}s. ${sessionState}` };
  }
  return { state: owner.state, title: owner.headline, detail: owner.detail };
}

export function formatActivity(entry = {}) {
  const source = ['agent', 'connector', 'system'].includes(entry.actor ?? entry.source) ? (entry.actor ?? entry.source) : 'system';
  const agent = source === 'agent';
  const typeLabels = {
    'turn.start': 'Position received',
    'agent.turn.ready': 'Agent turn ready',
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

export function buildSpectatorMatchUrl(origin, matchId) {
  return `${origin}/?match=${encodeURIComponent(matchId)}`;
}

export function buildAgentPlayCommand(joinUrl) {
  return [
    'node',
    'public/agent-play.js',
    'join',
    '--join-url',
    joinUrl,
  ].map(shellQuote).join(' ');
}

export function buildAgentHandoffPrompt(joinUrl) {
  return `You are playing an Agent Chess exhibition match.

Run this command from an Agent Chess checkout:
${buildAgentPlayCommand(joinUrl)}

The link is a transcript-exposed, single-use bootstrap credential scoped to this match and seat. It expires in three minutes. Do not republish it.

Join and play inside this same agent task:
1. Run the join command once. It stores a protected local session, prints session.ready, and exits.
2. Run returned turn command. It prints one compact turn.ready containing turn.start state plus authoritative moves.list_all legal moves, then exits.
3. Inspect attachments[0] before choosing a move. It is a provider-neutral image/png board attachment. A vision-capable adapter must map its dataUrl into provider image input; a file-capable runtime must inspect imagePath. If neither works, report BOARD_IMAGE_UNSUPPORTED and do not claim visual review. FEN remains canonical source of truth; reconcile it with image, material, recent moves, position status, deadline, and legalMoves.
4. Transport automation must not select chess moves. Your model must select every move after it evaluates authoritative position and legal-move data.
5. Never use random, preference-list, engine, or first-legal fallback. Retry invalid model output through the model using returned legal moves and rejection details.
6. Submit move JSON before posting commentary. Run cached client with move --match MATCH_ID --json '{"turnId":"TURN_ID","moveUci":"e2e4","publicTrace":{"source":"agent_reported","phase":"choose","summary":"Claims central space.","candidates":[{"uci":"e2e4","note":"Space and development."}],"selectedMove":"e2e4","confidence":0.72,"elapsedMs":1800}}'. This wraps authoritative move.submit.
7. Wait for move.accepted before narrating result. Keep transport reads responsive; do not spend remaining deadline only on commentary.
8. Run returned turn command again. Each short process reconnects to same match and seat through cached auth token.
9. Run status after any command failure, follow nextAction, and retry same short command. Do not create a new match for transport recovery.
10. Continue until game.end, then run result and report outcome.
11. Do not launch another model process. Stable instructions plus appended compact turn packets preserve prompt-token caching.

Protocol mapping: turn.ready wraps turn.start and moves.list_all; move command sends move.submit; terminal response is game.end. Use moves.list only when focused piece detail helps.

Public trace rules:
- Use structured decision fields only for bounded public summaries: source, phase, summary, up to three candidates, selectedMove, confidence and elapsedMs.
- Share concise intent, candidate moves, tradeoffs, and selected move.
- Never publish private chain-of-thought, secrets, prompts, credentials, memory, local files, or raw reasoning.
- Candidate moves must be legal. selectedMove must equal moveUci.
- Keep all private analysis inside your own runtime.`;
}

export function selectDecisionBrief(match = {}) {
  const activity = match.activity ?? [];
  const currentTurnId = match.activeTurn?.turnId
    ?? [...activity].reverse().find((entry) => entry?.type === 'turn.start')?.turnId;
  const isPublicDecision = (entry) => (
    entry?.type === 'agent.decision'
    && entry?.actor === 'agent'
    && DISCLOSURE_LABELS[entry?.source]
  );
  const currentDecision = [...activity].reverse().find((entry) => isPublicDecision(entry) && (!currentTurnId || entry.turnId === currentTurnId));
  const decision = currentDecision ?? [...activity].reverse().find(isPublicDecision);
  if (decision) return {
    state: 'decision',
    intent: decision.summary?.trim() || 'Agent published a structured decision.',
    candidates: Array.isArray(decision.candidates) ? decision.candidates.slice(0, 4).map(({ uci, note }) => ({ uci, note })) : [],
    selectedMove: decision.selectedMove ?? '',
    ...(typeof decision.confidence === 'number' ? { confidence: decision.confidence } : {}),
    ...(Number.isInteger(decision.elapsedMs) ? { elapsedMs: decision.elapsedMs } : {}),
    disclosure: currentDecision ? DISCLOSURE_LABELS[decision.source] : `Last move · ${DISCLOSURE_LABELS[decision.source]}`,
    recency: currentDecision ? 'current' : 'previous',
  };
  if (match.status === 'failed') return { state: 'failed', intent: 'Match failed before an agent decision was published.', candidates: [], selectedMove: '', disclosure: 'System status', recency: 'none' };
  const phase = deriveTurnPhase(match);
  const phaseCopy = { observe: 'observing', probe: 'probing', evaluate: 'evaluating', choose: 'choosing', submit: 'submitting' };
  if (phase.key !== 'waiting' && phase.key !== 'complete') return { state: 'working', intent: `Agent is ${phaseCopy[phase.key] ?? 'working on'} current position.`, candidates: [], selectedMove: '', disclosure: 'Phase status', recency: 'current' };
  return { state: 'empty', intent: 'No public agent decision yet.', candidates: [], selectedMove: '', disclosure: 'No disclosure', recency: 'none' };
}

export function selectThoughtTicker(match = {}, limit = 3) {
  const allowedSystemTypes = new Set(['turn.start', 'moves.list', 'moves.list_all', 'history.list', 'move.validate']);
  return activeTurnActivity(match)
    .filter((entry) => (
      String(entry?.summary ?? '').trim()
      && (allowedSystemTypes.has(entry.type)
        || (['agent.trace', 'agent.decision'].includes(entry.type) && DISCLOSURE_LABELS[entry.source]))
    ))
    .map((entry) => {
      const phaseKey = PHASE_ALIASES[entry.phase] ?? entry.phase;
      return {
        phase: TURN_PHASES.find((item) => item.key === phaseKey)?.label ?? 'Status',
        summary: entry.summary.trim(),
        disclosure: DISCLOSURE_LABELS[entry.source] ?? 'Verified system',
      };
    })
    .slice(-Math.max(0, limit));
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

function terminalMatch(match = {}) {
  return Boolean(match.game?.gameOver || ['completed', 'aborted', 'failed'].includes(match.status));
}

export function deriveTurnOwnerStatus(match = {}, ownedColor = null) {
  if (terminalMatch(match)) {
    const outcome = deriveOutcome(match);
    return { headline: outcome.headline, detail: outcome.secondary, state: 'complete', activeColor: null };
  }
  const activeColor = match.game?.turn ?? null;
  const seat = match.seats?.[activeColor] ?? {};
  const name = seat.name ?? (activeColor ? `${activeColor[0].toUpperCase()}${activeColor.slice(1)}` : 'Player');
  if (seat.kind === 'agent') {
    const delivered = currentTurnEntries(match).some((entry) => entry?.type === 'agent.turn.ready');
    if (!delivered) return { headline: `Waiting on ${name}`, detail: match.connected || match.agentSessionActive ? 'Waiting for turn delivery' : 'Agent needs to connect', state: 'waiting', activeColor };
    return match.connected || match.agentSessionActive
      ? { headline: `${name} is thinking`, detail: deriveTurnPhase(match).label, state: 'thinking', activeColor }
      : { headline: `Waiting on ${name}`, detail: 'Agent needs to connect', state: 'waiting', activeColor };
  }
  if (seat.kind === 'engine') return { headline: `${name} is moving`, detail: 'Engine turn', state: 'moving', activeColor };
  if (seat.kind === 'human' && activeColor === ownedColor) return { headline: 'Your move', detail: `${name} controls ${activeColor}`, state: 'your-turn', activeColor };
  return { headline: `Waiting on ${name}`, detail: 'Player turn', state: 'waiting', activeColor };
}

export function derivePlayerState(match = {}, color, ownedColor = null) {
  if (terminalMatch(match)) {
    const outcome = deriveOutcome(match);
    if (outcome.kind === 'decisive') return color === outcome.winnerColor ? 'Winner' : 'Lost';
    if (outcome.kind === 'draw') return 'Draw';
    return 'Finished';
  }
  if (match.game?.turn !== color) return 'Watching';
  const seat = match.seats?.[color] ?? {};
  if (seat.kind === 'agent') {
    if (!currentTurnEntries(match).some((entry) => entry?.type === 'agent.turn.ready')) return 'Waiting';
    return match.connected || match.agentSessionActive ? 'Thinking' : 'Connecting';
  }
  if (seat.kind === 'engine') return 'Moving';
  if (seat.kind === 'human') return color === ownedColor ? 'Your move' : 'To move';
  return 'To move';
}

function moveLabel(index, san) {
  const number = Math.floor(index / 2) + 1;
  return index % 2 === 0 ? `${number}.${san}` : `${number}...${san}`;
}

function moveColor(index) {
  return index % 2 === 0 ? 'white' : 'black';
}

export function derivePostGameInterview(match = {}) {
  const seats = match.seats ?? {};
  const agentEntry = Object.entries(seats).find(([, seat]) => seat.kind === 'agent')
    ?? Object.entries(seats).find(([, seat]) => seat.kind !== 'engine')
    ?? ['white', seats.white ?? {}];
  const [agentColor, agentSeat] = agentEntry;
  const opponentColor = agentColor === 'white' ? 'black' : 'white';
  const agentName = agentSeat.name ?? 'Agent';
  const opponentName = seats[opponentColor]?.name ?? 'Opponent';
  const moves = match.game?.movesSan ?? [];
  const positions = match.game?.positions ?? [];
  const summaries = [...new Set((match.activity ?? [])
    .filter((entry) => entry?.type === 'agent.decision' && entry?.actor === 'agent' && DISCLOSURE_LABELS[entry?.source])
    .map((entry) => entry.summary?.trim())
    .filter(Boolean))].slice(0, 2);
  const earlyAgentMoves = moves
    .map((san, index) => ({ san, index }))
    .filter(({ index }) => moveColor(index) === agentColor)
    .slice(0, 3)
    .map(({ san, index }) => moveLabel(index, san));
  const opening = summaries.length
    ? `Early published summaries: ${summaries.map((summary) => `“${summary}”`).join(' ')}`
    : `Opening moves: ${earlyAgentMoves.join(', ') || 'No completed agent moves.'}`;

  let largestDrop = { points: 0, index: -1 };
  const initialFen = positions[0];
  if (initialFen) {
    for (let index = 1; index < positions.length; index += 1) {
      const before = materialSummary(initialFen, positions[index - 1], agentColor).difference;
      const after = materialSummary(initialFen, positions[index], agentColor).difference;
      const points = before - after;
      if (points > largestDrop.points) largestDrop = { points, index: index - 1 };
    }
  }
  const lossMoveIndex = largestDrop.index;
  const precedingAgentIndex = lossMoveIndex >= 0 && moveColor(lossMoveIndex) !== agentColor ? lossMoveIndex - 1 : lossMoveIndex;
  const criticalIndex = precedingAgentIndex >= 0 ? precedingAgentIndex : Math.max(0, moves.length - 1);
  const criticalMove = moves[criticalIndex] ? moveLabel(criticalIndex, moves[criticalIndex]) : 'critical move';
  const reply = moves[lossMoveIndex] ? moveLabel(lossMoveIndex, moves[lossMoveIndex]) : '';
  const turningPoint = largestDrop.points > 0
    ? `${criticalMove} preceded the largest recorded material swing, a ${largestDrop.points}-point loss${reply ? ` after ${reply}` : ''}.`
    : 'Public move record shows no single material swing large enough to name a turning point.';
  const finalIndex = moves.length - 1;
  const finalMove = finalIndex >= 0 ? moveLabel(finalIndex, moves[finalIndex]) : '';
  const outcome = deriveOutcome(match);
  const finishingName = outcome.kind === 'decisive' ? outcome.winnerName : opponentName;
  const pressure = match.game?.checkmate && finalMove
    ? `${finishingName} converted the final attack with ${finalMove}.`
    : `${finishingName} completed the recorded result ${match.game?.result ?? '*'}.`;
  const rematch = largestDrop.points > 0
    ? `Before ${criticalMove}, recheck forcing captures and recaptures.`
    : 'Keep published plans concise, then recheck forcing moves before submission.';
  return {
    agentName,
    sourceLabel: 'Public record',
    opening,
    turningPoint,
    pressure,
    rematch,
    note: 'Generated from public PGN and published summaries. No private reasoning or engine evaluation.',
  };
}

export function buildExhibitionPayload({ matchup, color, targetElo }) {
  const agent = matchup === 'agent-engine';
  return {
    controller: { kind: agent ? 'agent' : 'human', name: agent ? 'My agent' : 'Human' },
    opponent: { kind: matchup === 'human-agent' ? 'agent' : 'engine', name: matchup === 'human-agent' ? 'My agent' : 'Computer' },
    color,
    targetElo: targetElo === 'unlimited' ? 'unlimited' : Number(targetElo),
    movetimeMs: 500,
    decisionDeadlineMs: 180_000,
    turnPaceMs: 800,
  };
}

export function materialPerspective(ownedControllerColor, humanColor) {
  return ownedControllerColor ?? humanColor ?? 'white';
}

export function buildMaterialDisplay(material) {
  const score = `${material.difference >= 0 ? '+' : ''}${material.difference}`;
  return {
    text: `Material ${score}`,
    accessible: `Captured: ${material.captured.join(', ') || 'none'}; Material ${score}`,
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function deriveBalanceOfPower(match = {}) {
  const game = match.game ?? {};
  if (game.gameOver && game.checkmate && ['1-0', '0-1'].includes(game.result)) {
    const whiteWon = game.result === '1-0';
    return {
      whitePercent: whiteWon ? 100 : 0,
      label: game.result,
      leader: whiteWon ? 'White' : 'Black',
      source: 'Result',
      accessible: `Final result: ${whiteWon ? 'White' : 'Black'} won`,
    };
  }
  const evaluation = match.evaluation;
  if (evaluation?.perspective === 'white' && evaluation.type === 'mate' && Number.isInteger(evaluation.value)) {
    const whiteLeads = evaluation.value > 0;
    return {
      whitePercent: whiteLeads ? 100 : 0,
      label: `M${Math.abs(evaluation.value)}`,
      leader: whiteLeads ? 'White' : 'Black',
      source: 'Stockfish',
      accessible: `Stockfish evaluation: ${whiteLeads ? 'White' : 'Black'} has mate in ${Math.abs(evaluation.value)}`,
    };
  }
  if (evaluation?.perspective === 'white' && evaluation.type === 'cp' && Number.isInteger(evaluation.value)) {
    const whitePercent = clamp(50 + 45 * Math.tanh(evaluation.value / 350), 5, 95);
    const score = evaluation.value / 100;
    const label = `${score >= 0 ? '+' : ''}${score.toFixed(1)}`;
    const leader = score > 0.05 ? 'White' : score < -0.05 ? 'Black' : 'Even';
    return {
      whitePercent,
      label,
      leader,
      source: 'Stockfish',
      accessible: leader === 'Even' ? `Stockfish evaluation: even, ${label}` : `Stockfish evaluation: ${leader} leads, ${label}`,
    };
  }
  const initialFen = game.initialFen ?? game.positions?.[0] ?? game.fen;
  const material = materialSummary(initialFen, game.fen ?? initialFen, 'white');
  const whitePercent = clamp(50 + material.difference * 3, 10, 90);
  const leader = material.difference > 0 ? 'White' : material.difference < 0 ? 'Black' : 'Even';
  const label = `M ${material.difference >= 0 ? '+' : ''}${material.difference}`;
  return {
    whitePercent,
    label,
    leader,
    source: 'Material',
    accessible: leader === 'Even' ? 'Material balance: even' : `Material balance: ${leader} leads by ${Math.abs(material.difference)}`,
  };
}

export function hasAgentJoined(match = {}) {
  return Boolean(
    match.connected
    || match.agentSessionActive
    || (match.activity ?? []).some((entry) => (
      entry.type === 'agent.connect'
      || entry.type === 'agent.decision'
      || entry.actor === 'agent'
    ))
  );
}

export function deriveConnectorStatus(match = {}, agentHasJoined = hasAgentJoined(match)) {
  if (match.connected) return { label: 'Agent online', state: 'online' };
  if (match.agentSessionActive) return { label: 'Agent ready', state: 'online' };
  if (agentHasJoined) return { label: 'Connection lost', state: 'offline' };
  return { label: 'Invitation ready', state: 'ready' };
}

export function deriveHeaderStatus(match = {}) {
  if (terminalMatch(match)) return { label: 'Match complete', connected: false };
  const hasAgentSeat = Object.values(match.seats ?? {}).some((seat) => seat.kind === 'agent');
  if (!hasAgentSeat) return { label: 'Live', connected: false };
  if (match.agentSessionActive) return { label: 'Agent ready', connected: true };
  return match.connected
    ? { label: 'Agent online', connected: true }
    : { label: 'Agent offline', connected: false };
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
let liveObserver = { state: 'unknown', lastSignalAt: null };

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
        setTimeout(() => captured.remove(), CAPTURE_FADE_MS);
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
      moving.style.transform = `translate3d(${fromRect.left - toRect.left}px, ${fromRect.top - toRect.top}px, 0)`;
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
    boardAnimationTimer = setTimeout(clearBoardAnimation, BOARD_SETTLE_MS);
  }
}

function renderMoves(match) {
  const list = qs('moves');
  const followButton = qs('return-live');
  followButton.disabled = replayPly === null;
  followButton.textContent = replayPly === null ? 'Following live' : 'Follow live';
  const rows = groupMoves(match.game.movesSan);
  list.replaceChildren();
  if (!rows.length) {
    list.innerHTML = '<div class="trace-empty">Moves will appear after play begins.</div>';
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
      const ply = replayPlyForMove(index, color);
      button.dataset.ply = String(ply);
      button.classList.toggle('selected', replayPly === ply);
      button.setAttribute('aria-pressed', String(replayPly === ply));
      button.addEventListener('click', () => {
        replayPly = ply;
        followButton.disabled = false;
        followButton.textContent = 'Follow live';
        for (const moveButton of list.querySelectorAll('button[data-ply]')) {
          const selected = moveButton === button;
          moveButton.classList.toggle('selected', selected);
          moveButton.setAttribute('aria-pressed', String(selected));
        }
        renderBoard(match);
      });
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
  qs('decision-title').textContent = brief.recency === 'previous' ? 'Last move' : 'Agent decision';
  qs('decision-intent').textContent = brief.intent;
  qs('decision-disclosure').textContent = brief.disclosure;
  const ticker = qs('thought-ticker');
  ticker.replaceChildren();
  const tickerItems = selectThoughtTicker(match);
  ticker.hidden = tickerItems.length === 0;
  tickerItems.forEach((item, index, items) => {
    const row = document.createElement('li');
    row.className = `thought-item${index === items.length - 1 ? ' current' : ''}`;
    const phase = document.createElement('strong'); phase.textContent = item.phase;
    const summary = document.createElement('span'); summary.className = 'thought-summary'; summary.textContent = item.summary;
    summary.title = `${item.disclosure}: ${item.summary}`;
    row.append(phase, summary);
    ticker.append(row);
  });
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
  const metrics = [
    typeof brief.confidence === 'number' ? `${Math.round(brief.confidence * 100)}%` : null,
    Number.isInteger(brief.elapsedMs) ? `${(brief.elapsedMs / 1000).toFixed(brief.elapsedMs % 1000 ? 1 : 0)}s` : null,
  ].filter(Boolean).join(' · ');
  selected.textContent = brief.selectedMove ? `Selected move: ${brief.selectedMove}${metrics ? ` · ${metrics}` : ''}` : '';
}

function renderStatusLine(match) {
  const status = deriveLiveStatus(match, { observer: liveObserver });
  const timing = deriveTurnTiming(match);
  qs('status-kicker').textContent = ['complete', 'failed', 'aborted'].includes(status.state) ? 'Match status' : 'Current turn';
  qs('status-title').textContent = status.title;
  qs('phase-current').textContent = status.detail;
  qs('turn-timing').textContent = `${timing.currentLabel} · ${timing.lastLabel}`;
  qs('status-line').dataset.state = status.state;
}

function renderReview(match, summary) {
  const panel = qs('post-match');
  panel.hidden = !summary.review;
  if (!summary.review) return;
  const outcome = summary.outcome ?? deriveOutcome(match);
  qs('review-headline').textContent = outcome.headline;
  qs('review-copy').textContent = `${outcome.secondary}. ${outcome.moveCount} full moves.`;
  const items = [
    ...(outcome.kind === 'decisive' ? [['Winner', `${outcome.winnerName} · ${outcome.winnerColor[0].toUpperCase()}${outcome.winnerColor.slice(1)}`]] : []),
    ['Result', outcome.resultLabel],
    ['Termination', outcome.termination],
    ['White', match.seats.white.name],
    ['Trace events', String(match.trace.length)],
  ];
  qs('review-list').replaceChildren(...items.map(([label, value]) => buildReviewItem(document, label, value)));
  const interview = derivePostGameInterview(match);
  qs('interview-title').textContent = `${interview.agentName} post-game`;
  qs('interview-source').textContent = interview.sourceLabel;
  const answers = [
    ['Opening plan', interview.opening],
    ['Turning point', interview.turningPoint],
    ['Biggest pressure', interview.pressure],
    ['Rematch change', interview.rematch],
  ];
  const list = qs('interview-list');
  list.replaceChildren(...answers.map(([question, answer]) => {
    const row = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = question;
    const detail = document.createElement('dd'); detail.textContent = answer;
    row.append(term, detail);
    return row;
  }));
  qs('interview-note').textContent = interview.note;
}

function renderPlayerStrips(match, summary = deriveMatchSummary(match)) {
  for (const [position, seat] of Object.entries(displayedSeats(match.seats, boardFlipped))) {
    qs(`${position}-name`).textContent = seat.name ?? seat.color;
    qs(`${position}-color`).textContent = `${seat.color[0].toUpperCase()}${seat.color.slice(1)}`;
    qs(`${position}-kind`).textContent = seat.kindLabel;
    qs(`${position}-avatar`).className = `avatar avatar-${seat.kind}`;
    qs(`${position}-avatar`).textContent = (seat.name ?? seat.kindLabel).slice(0, 2).toUpperCase();
    const state = qs(`${position}-state`);
    state.textContent = derivePlayerState(match, seat.color, ownedControllerColor);
    state.dataset.outcome = state.textContent.toLowerCase();
  }
}

function renderPowerBar(match) {
  const balance = deriveBalanceOfPower(match);
  const powerBar = qs('power-bar');
  powerBar.style.setProperty('--white-share', `${balance.whitePercent}%`);
  powerBar.classList.toggle('flipped', boardFlipped);
  powerBar.dataset.leader = balance.leader.toLowerCase();
  powerBar.setAttribute('aria-label', balance.accessible);
  const score = qs('power-score');
  score.textContent = balance.label;
  score.title = balance.source;
}

function render(match) {
  currentMatch = match;
  const summary = deriveMatchSummary(match);
  document.documentElement.classList.add('match-active');
  document.documentElement.classList.toggle('match-complete', summary.review);
  qs('empty-state').hidden = true;
  qs('match-view').hidden = false;
  qs('match-context').hidden = false;
  const seats = match.seats ?? {};
  const headerStatus = deriveHeaderStatus(match);
  qs('connection').textContent = headerStatus.label;
  qs('connection').dataset.connected = String(headerStatus.connected);
  qs('engine').textContent = 'Public match';
  qs('match-title').textContent = summary.review ? (summary.outcome?.headline ?? deriveOutcome(match).headline) : `${seats.white?.name ?? 'White'} vs ${seats.black?.name ?? 'Black'}`;
  renderPlayerStrips(match, summary);
  qs('fen').textContent = match.game.fen;
  const material = materialSummary(match.game.positions?.[0] ?? match.game.fen, match.game.fen, materialPerspective(ownedControllerColor, humanColor));
  const materialNode = qs('material');
  const display = buildMaterialDisplay(material);
  materialNode.hidden = !material.captured.length && material.difference === 0;
  materialNode.textContent = display.text;
  materialNode.setAttribute('aria-label', display.accessible);
  materialNode.title = display.accessible;
  renderPowerBar(match);
  qs('steering-form').hidden = true;
  qs('steering-locked').hidden = false;
  qs('steering-state').textContent = 'Locked';
  renderStatusLine(match);
  renderBoard(match);
  renderMoves(match);
  renderTrace(match);
  const hasAgentSeat = Object.values(seats).some((seat) => seat.kind === 'agent');
  const decisionPanel = qs('decision-brief');
  decisionPanel.hidden = summary.review || !hasAgentSeat;
  if (!decisionPanel.hidden) renderDecisionBrief(match);
  renderReview(match, summary);
  const ownsAgentSeat = Object.entries(seats).some(([color, seat]) => seat.kind === 'agent' && sessionStorage.getItem(`${match.id}:capability:${color}`));
  const agentHasJoined = hasAgentJoined(match);
  const agentAvailable = Boolean(match.connected || match.agentSessionActive);
  const needsReconnect = agentHasJoined && !agentAvailable && !summary.review;
  const connectorStatus = deriveConnectorStatus(match, agentHasJoined);
  const connector = qs('connector');
  connector.hidden = !ownsAgentSeat || summary.review;
  connector.classList.toggle('connected', agentHasJoined);
  connector.dataset.state = connectorStatus.state;
  qs('connector-title').textContent = connectorStatus.label;
  qs('copy-agent-prompt').hidden = agentAvailable || summary.review;
  qs('copy-agent-prompt').textContent = needsReconnect ? 'Copy prompt' : 'Copy full prompt';
  qs('copy-agent-link').hidden = agentAvailable || summary.review;
  qs('copy-agent-link').textContent = needsReconnect ? 'Copy link' : 'Copy link only';
  qs('copy-command').hidden = agentHasJoined || summary.review;
  qs('connector-feedback').hidden = agentHasJoined;
  qs('connect-command').hidden = true;
  qs('connector-feedback').textContent = 'One-use link keeps credentials, prompts, and private reasoning local.';
  qs('lifecycle-action').hidden = summary.review || !humanCapability;
  qs('lifecycle-action').textContent = (match.game.movesSan?.length ?? 0) ? 'Resign' : 'Abort';
}

async function createMatch(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const response = await fetch('/api/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildExhibitionPayload({ matchup: form.get('matchup'), color: form.get('humanColor'), targetElo: form.get('targetElo') })),
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
    document.documentElement.classList.remove('match-active');
    qs('empty-state').hidden = false;
    qs('match-view').hidden = true;
    return;
  }
  const match = await response.json();
  ownedControllerColor = controllerColor(matchId, match.seats, (key) => sessionStorage.getItem(key));
  humanColor = match.seats?.[ownedControllerColor]?.kind === 'human' ? ownedControllerColor : null;
  humanCapability = humanColor && sessionStorage.getItem(`${matchId}:capability:${humanColor}`);
  if (ownedControllerColor) boardFlipped = ownedControllerColor === 'black';
  liveObserver = { state: 'connected', lastSignalAt: Date.now() };
  render(match);
  eventSocket?.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = eventSocket = new WebSocket(`${protocol}//${location.host}/events?matchId=${encodeURIComponent(matchId)}`);
  socket.addEventListener('message', (event) => {
    if (eventSocket !== socket) return;
    const message = JSON.parse(event.data);
    liveObserver = { state: 'connected', lastSignalAt: Date.now() };
    if (message.type === 'match.state') render(message.match);
    else if (message.type === 'match.heartbeat' && currentMatch) renderStatusLine(currentMatch);
  });
  socket.addEventListener('close', () => {
    if (eventSocket !== socket) return;
    liveObserver = { ...liveObserver, state: 'disconnected' };
    if (currentMatch) renderStatusLine(currentMatch);
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
  setInterval(() => { if (currentMatch) renderStatusLine(currentMatch); }, 1_000);
  qs('create-match').addEventListener('submit', createMatch);
  qs('steering-form').addEventListener('submit', sendSteering);
  qs('matchup').addEventListener('change', (event) => {
    const agent = event.target.value === 'agent-engine';
    qs('color-label').firstChild.textContent = agent ? 'Agent plays as' : 'Play as';
    qs('engine-skill').hidden = event.target.value === 'human-agent';
    qs('skill-level').disabled = event.target.value === 'human-agent';
  });
  qs('new-match-button').addEventListener('click', () => { location.href = '/'; });
  qs('match-tools-button').addEventListener('click', () => qs('match-tools-dialog').showModal());
  qs('new-match-menu').addEventListener('click', () => { location.href = '/'; });
  qs('flip-board').addEventListener('click', () => { boardFlipped = !boardFlipped; if (currentMatch) { renderBoard(currentMatch); renderPlayerStrips(currentMatch); renderPowerBar(currentMatch); } });
  async function mintAgentSession() {
    const agentColor = currentMatch && Object.entries(currentMatch.seats).find(([, seat]) => seat.kind === 'agent')?.[0];
    const agentCapability = agentColor && sessionStorage.getItem(`${currentMatch.id}:capability:${agentColor}`);
    if (!agentCapability) return null;
    const response = await fetch('/api/agent-sessions', { method: 'POST', headers: { authorization: `Bearer ${agentCapability}` } });
    if (!response.ok) { toast('Connector unavailable'); return null; }
    return response.json();
  }
  async function mintAgentInviteUrl() {
    const session = await mintAgentSession();
    return session ? buildAgentInviteUrl(location.origin, session.joinPath) : null;
  }
  qs('copy-agent-prompt').addEventListener('click', async () => {
    const inviteUrl = await mintAgentInviteUrl();
    if (!inviteUrl) return;
    await copyText(buildAgentHandoffPrompt(inviteUrl), 'Agent prompt copied. Expires in 3 minutes.');
    qs('connector-feedback').textContent = 'Full prompt copied. Link expires in 3 minutes.';
  });
  qs('copy-agent-link').addEventListener('click', async () => {
    const inviteUrl = await mintAgentInviteUrl();
    if (!inviteUrl) return;
    await copyText(inviteUrl, 'Agent link copied. Expires in 3 minutes.');
    qs('connector-feedback').textContent = 'Agent link copied. Expires in 3 minutes.';
  });
  qs('copy-command').addEventListener('click', async () => {
    const inviteUrl = await mintAgentInviteUrl();
    if (!inviteUrl) return;
    qs('connect-command').textContent = buildAgentPlayCommand(inviteUrl);
    qs('connect-command').hidden = false;
    await copyText(qs('connect-command').textContent, 'Connector command copied. Expires in 3 minutes.');
    qs('connector-feedback').textContent = 'Terminal command copied. Expires in 3 minutes.';
  });
  qs('copy-pgn').addEventListener('click', () => currentMatch?.pgn && copyText(currentMatch.pgn, 'PGN copied'));
  const copySpectatorLink = () => currentMatch && copyText(buildSpectatorMatchUrl(location.origin, currentMatch.id), 'Spectator link copied');
  qs('share-match-menu').addEventListener('click', copySpectatorLink);
  qs('focus-mode').addEventListener('click', (event) => { document.documentElement.classList.toggle('focus-mode'); event.currentTarget.setAttribute('aria-pressed', String(document.documentElement.classList.contains('focus-mode'))); });
  qs('return-live').addEventListener('click', () => {
    replayPly = null;
    qs('return-live').disabled = true;
    qs('return-live').textContent = 'Following live';
    if (currentMatch) {
      renderMoves(currentMatch);
      renderBoard(currentMatch);
    }
  });
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
