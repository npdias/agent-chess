export const PROTOCOL_VERSION = '2.0';

export const AGENT_REST_ACTIONS = Object.freeze([
  'GET /api/agent/match',
  'GET /api/agent/turn',
  'GET /api/agent/legal-moves',
  'POST /api/agent/decision',
  'POST /api/agent/move',
  'GET /api/agent/result',
]);

export const MESSAGE_TYPES = Object.freeze({
  MATCH_START: 'match.start',
  TURN_START: 'turn.start',
  MOVES_LIST: 'moves.list',
  MOVES_LIST_RESULT: 'moves.list.result',
  MOVES_LIST_ALL: 'moves.list_all',
  MOVES_LIST_ALL_RESULT: 'moves.list_all.result',
  HISTORY_LIST: 'history.list',
  HISTORY_LIST_RESULT: 'history.list.result',
  MOVE_VALIDATE: 'move.validate',
  MOVE_VALIDATE_RESULT: 'move.validate.result',
  MOVE_SUBMIT: 'move.submit',
  MOVE_ACCEPTED: 'move.accepted',
  MOVE_REJECTED: 'move.rejected',
  OPPONENT_MOVE: 'opponent.move',
  GAME_END: 'game.end',
  STATE: 'match.state',
  TRACE_PUBLISH: 'trace.publish',
  ERROR: 'error',
});

export const ERROR_CODES = Object.freeze({
  STALE_TURN: 'STALE_TURN',
  INVALID_SQUARE: 'INVALID_SQUARE',
  PIECE_NOT_MOVABLE: 'PIECE_NOT_MOVABLE',
  INVALID_MOVE_FORMAT: 'INVALID_MOVE_FORMAT',
  MOVE_NOT_LEGAL: 'MOVE_NOT_LEGAL',
  UNSUPPORTED_MESSAGE: 'UNSUPPORTED_MESSAGE',
});

const TURN_SCOPED_TYPES = new Set([
  MESSAGE_TYPES.MOVES_LIST,
  MESSAGE_TYPES.MOVES_LIST_ALL,
  MESSAGE_TYPES.HISTORY_LIST,
  MESSAGE_TYPES.MOVE_VALIDATE,
  MESSAGE_TYPES.MOVE_SUBMIT,
  MESSAGE_TYPES.TRACE_PUBLISH,
]);

const REQUEST_TYPES = TURN_SCOPED_TYPES;
const SQUARE_PATTERN = /^[a-h][1-8]$/;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const TRACE_SOURCES = new Set(['agent_reported', 'provider_summary', 'adapter_generated']);

export function parsePublicTrace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_TRACE');
  if (typeof value.summary !== 'string' || !value.summary.trim()) throw new Error('EMPTY_TRACE');
  if (Array.isArray(value.candidates) && value.candidates.some((candidate) => (
    typeof candidate?.uci !== 'string' || !UCI_PATTERN.test(candidate.uci)
  ))) {
    throw new Error(ERROR_CODES.INVALID_MOVE_FORMAT);
  }
  if (value.selectedMove !== undefined && value.selectedMove !== null && (
    typeof value.selectedMove !== 'string' || !UCI_PATTERN.test(value.selectedMove)
  )) {
    throw new Error(ERROR_CODES.INVALID_MOVE_FORMAT);
  }
  if (value.confidence !== undefined && (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) {
    throw new Error('INVALID_TRACE_METRIC');
  }
  if (value.elapsedMs !== undefined && (!Number.isInteger(value.elapsedMs) || value.elapsedMs < 0 || value.elapsedMs > 300_000)) {
    throw new Error('INVALID_TRACE_METRIC');
  }

  const source = typeof value.source === 'string' && value.source.trim()
    ? value.source.trim() : 'agent_reported';
  if (!TRACE_SOURCES.has(source)) throw new Error('INVALID_TRACE_SOURCE');
  return {
    source,
    phase: typeof value.phase === 'string' ? value.phase.trim().slice(0, 40) : 'thinking',
    summary: value.summary.trim().slice(0, 500),
    candidates: Array.isArray(value.candidates) ? value.candidates.slice(0, 3).map((candidate) => ({
      uci: candidate.uci,
      note: typeof candidate.note === 'string' ? candidate.note.trim().slice(0, 160) : '',
    })) : [],
    selectedMove: value.selectedMove ?? null,
    ...(value.confidence !== undefined ? { confidence: value.confidence } : {}),
    ...(value.elapsedMs !== undefined ? { elapsedMs: value.elapsedMs } : {}),
  };
}

export function parseClientMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    throw new Error('INVALID_JSON');
  }
  if (!message || typeof message.type !== 'string') throw new Error('INVALID_MESSAGE');
  if (!REQUEST_TYPES.has(message.type)) throw new Error(ERROR_CODES.UNSUPPORTED_MESSAGE);

  const parsed = { type: message.type };
  if (TURN_SCOPED_TYPES.has(message.type)) {
    if (typeof message.turnId !== 'string' || !message.turnId.trim()) {
      throw new Error(ERROR_CODES.STALE_TURN);
    }
    parsed.turnId = message.turnId.trim();
  }

  if (message.type === MESSAGE_TYPES.MOVES_LIST) {
    if (typeof message.square !== 'string' || !SQUARE_PATTERN.test(message.square)) {
      throw new Error(ERROR_CODES.INVALID_SQUARE);
    }
    parsed.square = message.square;
  }

  if (message.type === MESSAGE_TYPES.MOVE_VALIDATE || message.type === MESSAGE_TYPES.MOVE_SUBMIT) {
    if (typeof message.moveUci !== 'string' || !UCI_PATTERN.test(message.moveUci)) {
      throw new Error(ERROR_CODES.INVALID_MOVE_FORMAT);
    }
    parsed.moveUci = message.moveUci;
  }

  if (message.type === MESSAGE_TYPES.MOVE_SUBMIT && message.publicTrace !== undefined) {
    parsed.publicTrace = parsePublicTrace(message.publicTrace);
  }

  if (message.type === MESSAGE_TYPES.HISTORY_LIST) {
    if ('beforePly' in message) {
      if (!Number.isInteger(message.beforePly)) throw new Error('INVALID_HISTORY_CURSOR');
      parsed.beforePly = message.beforePly;
    }
    if ('limit' in message) {
      if (!Number.isInteger(message.limit)) throw new Error('INVALID_HISTORY_LIMIT');
      parsed.limit = message.limit;
    }
  }

  if (message.type === MESSAGE_TYPES.TRACE_PUBLISH) {
    parsed.kind = 'status';
    const { source, phase, summary } = parsePublicTrace(message);
    Object.assign(parsed, { source, phase, summary });
  }

  return parsed;
}
