import { spawn } from 'node:child_process';

const SQUARE_PATTERN = /^[a-h][1-8]$/;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const TRACE_SOURCES = new Set(['agent_reported', 'provider_summary', 'adapter_generated']);

export async function resolveJoinTarget(fetchImpl, joinUrl) {
  let invitation;
  try {
    invitation = new URL(joinUrl);
  } catch {
    throw new Error('INVALID_INVITATION_URL');
  }
  if (!['http:', 'https:'].includes(invitation.protocol)) throw new Error('INVALID_INVITATION_URL');

  const response = await fetchImpl(invitation);
  if (!response.ok) {
    if (response.status === 410) throw new Error('INVITATION_EXPIRED');
    if (response.status === 409) throw new Error('INVITATION_ALREADY_CLAIMED');
    throw new Error(`INVITATION_REQUEST_FAILED_${response.status}`);
  }

  let contract;
  try {
    contract = await response.json();
  } catch {
    throw new Error('INVALID_INVITATION_CONTRACT');
  }
  const target = contract?.connection?.websocket?.url ?? contract?.connection?.wsUrl;
  let socketUrl;
  try {
    socketUrl = new URL(target);
  } catch {
    throw new Error('INVALID_INVITATION_CONTRACT');
  }
  if (
    contract?.service?.name !== 'Agent Chess'
    || contract?.protocolVersion !== '2.0'
    || !['ws:', 'wss:'].includes(socketUrl.protocol)
  ) {
    throw new Error('INVALID_INVITATION_CONTRACT');
  }
  return socketUrl.toString();
}

export async function exchangeAgentSession(fetchImpl, server, capability) {
  const response = await fetchImpl(new URL('/api/agent-sessions', server), {
    method: 'POST', headers: { authorization: `Bearer ${capability}` },
  });
  if (!response.ok) throw new Error(`AGENT_SESSION_FAILED_${response.status}`);
  const session = await response.json();
  if (typeof session?.wsPath !== 'string' || !session.wsPath.startsWith('/agent?ticket=')) {
    throw new Error('INVALID_AGENT_SESSION');
  }
  return session.wsPath;
}

function parseTrace(parsed) {
  const suppliedSource = typeof parsed.trace?.source === 'string' ? parsed.trace.source.trim() : parsed.trace?.source;
  const source = suppliedSource == null || suppliedSource === '' ? 'agent_reported' : suppliedSource;
  if (!TRACE_SOURCES.has(source)) throw new Error('INVALID_TRACE_SOURCE');
  if (!parsed.trace?.summary) return null;
  if (parsed.trace.confidence !== undefined && (!Number.isFinite(parsed.trace.confidence) || parsed.trace.confidence < 0 || parsed.trace.confidence > 1)) {
    throw new Error('INVALID_TRACE_METRIC');
  }
  if (parsed.trace.elapsedMs !== undefined && (!Number.isInteger(parsed.trace.elapsedMs) || parsed.trace.elapsedMs < 0 || parsed.trace.elapsedMs > 300_000)) {
    throw new Error('INVALID_TRACE_METRIC');
  }
  return {
    source,
    kind: parsed.trace.kind === 'decision' ? 'decision' : 'status',
    phase: String(parsed.trace.phase ?? 'thinking').slice(0, 40),
    summary: String(parsed.trace.summary).slice(0, 1000),
    candidates: Array.isArray(parsed.trace.candidates) ? parsed.trace.candidates
      .filter((candidate) => UCI_PATTERN.test(String(candidate?.uci ?? '').trim()))
      .slice(0, 3)
      .map((candidate) => ({ uci: String(candidate.uci).trim(), note: String(candidate?.note ?? '').trim().slice(0, 160) })) : [],
    selectedMove: UCI_PATTERN.test(String(parsed.trace.selectedMove ?? '').trim()) ? String(parsed.trace.selectedMove).trim() : null,
    ...(parsed.trace.confidence !== undefined ? { confidence: parsed.trace.confidence } : {}),
    ...(parsed.trace.elapsedMs !== undefined ? { elapsedMs: parsed.trace.elapsedMs } : {}),
  };
}

export function chooseDemoMove(turn) {
  const preference = ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'e7e5', 'd7d5', 'g8f6', 'c7c5'];
  const legal = new Set((turn.legalMoves ?? []).map((move) => move.uci));
  return preference.find((move) => legal.has(move)) ?? turn.legalMoves?.[0]?.uci ?? null;
}

export function chooseDemoAction(turn) {
  const preference = ['e2', 'd2', 'g1', 'c2', 'e7', 'd7', 'g8', 'c7'];
  const cachedMoves = Object.values(turn.probeResults ?? {}).flatMap((result) => result.moves ?? []);
  const moveUci = preference
    .map((square) => cachedMoves.find((move) => move.uci.startsWith(square))?.uci)
    .find(Boolean) ?? cachedMoves[0]?.uci;
  if (moveUci) return {
    moveUci,
    trace: {
      source: 'adapter_generated', phase: 'demo', summary: 'Demo connector selected a cached legal move.',
      candidates: [{ uci: moveUci, note: 'Demo legal candidate.' }], selectedMove: moveUci,
    },
  };

  const movable = new Set((turn.positionStatus?.movablePieces ?? []).map((piece) => piece.square));
  const probeSquare = preference.find((square) => movable.has(square)) ?? turn.positionStatus?.movablePieces?.[0]?.square;
  if (!probeSquare) throw new Error('NO_MOVABLE_PIECE');
  return { probeSquare, trace: { source: 'adapter_generated', phase: 'demo', summary: `Demo connector probing ${probeSquare}.` } };
}

export function parseAgentAction(stdout) {
  const text = String(stdout ?? '').trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { moveUci: text };
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_AGENT_ACTION');

  const trace = parseTrace(parsed);
  if (parsed.requestAllMoves === true && !('probeSquare' in parsed || 'moveUci' in parsed || 'move' in parsed || 'uci' in parsed)) {
    return { requestAllMoves: true, trace };
  }
  if (typeof parsed.probeSquare === 'string' && !('moveUci' in parsed || 'move' in parsed || 'uci' in parsed)) {
    if (!SQUARE_PATTERN.test(parsed.probeSquare)) throw new Error('INVALID_PROBE_SQUARE');
    return { probeSquare: parsed.probeSquare, trace };
  }

  const moveUci = parsed.moveUci ?? parsed.move ?? parsed.uci;
  if (typeof moveUci !== 'string' || !UCI_PATTERN.test(moveUci)) throw new Error('MOVE_NOT_LEGAL');
  return { moveUci, trace };
}

export function cacheProbe(turn, result) {
  if (!turn?.turnId || result?.turnId !== turn.turnId || !SQUARE_PATTERN.test(result?.square ?? '')) {
    throw new Error('STALE_TURN');
  }
  if (!Array.isArray(result.moves)) throw new Error('INVALID_PROBE_RESULT');
  return {
    ...turn,
    probeResults: {
      ...(turn.probeResults ?? {}),
      [result.square]: { square: result.square, moves: result.moves },
    },
  };
}

export function cacheAllMoves(turn, result) {
  if (!turn?.turnId || result?.turnId !== turn.turnId) throw new Error('STALE_TURN');
  if (!Array.isArray(result.moves)) throw new Error('INVALID_PROBE_RESULT');
  return { ...turn, requestAllMoves: true, allMoves: result.moves };
}

export function createAgentRequest(turn, action) {
  if (!turn?.turnId) throw new Error('STALE_TURN');
  if (action?.probeSquare) return { type: 'moves.list', turnId: turn.turnId, square: action.probeSquare };
  if (action?.requestAllMoves) return { type: 'moves.list_all', turnId: turn.turnId };
  if (action?.moveUci) return {
    type: 'move.submit', turnId: turn.turnId, moveUci: action.moveUci,
    ...(action.trace && turn.mode !== 'private_eval' ? { publicTrace: { ...action.trace, selectedMove: action.moveUci } } : {}),
  };
  throw new Error('INVALID_AGENT_ACTION');
}

export function publicStatusTraceForAction(action = {}) {
  if ((!action.probeSquare && !action.requestAllMoves) || !action.trace?.summary) return null;
  return {
    source: action.trace.source,
    kind: 'status',
    phase: action.trace.phase,
    summary: action.trace.summary,
  };
}

export function validateLocalCandidate(turn, moveUci) {
  if (typeof moveUci !== 'string' || !UCI_PATTERN.test(moveUci)) throw new Error('MOVE_NOT_LEGAL');
  const moves = [
    ...(turn?.legalMoves ?? []),
    ...(turn?.allMoves ?? []),
    ...Object.values(turn?.probeResults ?? {}).flatMap((result) => result.moves ?? []),
  ];
  if (!moves.some((move) => move.uci === moveUci)) throw new Error('MOVE_NOT_LEGAL');
  return { moveUci };
}

export function parseAgentOutput(stdout, turn) {
  const action = parseAgentAction(stdout);
  if (!action.moveUci) throw new Error('AGENT_ACTION_INCOMPLETE');
  try {
    return { ...validateLocalCandidate(turn, action.moveUci), trace: action.trace };
  } catch (error) {
    if (error.message === 'MOVE_NOT_LEGAL') throw new Error(`ILLEGAL_AGENT_OUTPUT: ${action.moveUci}`);
    throw error;
  }
}

export function runCommandAction(command, turn, { timeoutMs = Number(process.env.AGENT_COMMAND_TIMEOUT_MS ?? turn.deadlineMs ?? 30_000) } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('AGENT_COMMAND_TIMEOUT'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`AGENT_COMMAND_FAILED(${code}): ${Buffer.concat(stderr).toString('utf8').trim()}`));
        return;
      }
      try {
        resolve(parseAgentAction(Buffer.concat(stdout).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${JSON.stringify(turn)}\n`);
  });
}

export async function runCommandAgent(command, turn, options) {
  const action = await runCommandAction(command, turn, options);
  if (!action.moveUci) throw new Error('AGENT_ACTION_INCOMPLETE');
  return { ...validateLocalCandidate(turn, action.moveUci), trace: action.trace };
}
