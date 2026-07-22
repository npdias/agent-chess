import { spawn } from 'node:child_process';

const SQUARE_PATTERN = /^[a-h][1-8]$/;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function parseTrace(parsed) {
  if (!parsed.trace?.summary) return null;
  return {
    phase: String(parsed.trace.phase ?? 'thinking').slice(0, 40),
    summary: String(parsed.trace.summary).slice(0, 1000),
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
  if (moveUci) return { moveUci, trace: { phase: 'demo', summary: 'Demo connector selected a cached legal move.' } };

  const movable = new Set((turn.positionStatus?.movablePieces ?? []).map((piece) => piece.square));
  const probeSquare = preference.find((square) => movable.has(square)) ?? turn.positionStatus?.movablePieces?.[0]?.square;
  if (!probeSquare) throw new Error('NO_MOVABLE_PIECE');
  return { probeSquare, trace: { phase: 'demo', summary: `Demo connector probing ${probeSquare}.` } };
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
  if (action?.moveUci) return { type: 'move.submit', turnId: turn.turnId, moveUci: action.moveUci };
  throw new Error('INVALID_AGENT_ACTION');
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
