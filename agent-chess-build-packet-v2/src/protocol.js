export const PROTOCOL_VERSION = '2.0';

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
]);

const REQUEST_TYPES = new Set([...TURN_SCOPED_TYPES, MESSAGE_TYPES.TRACE_PUBLISH]);
const SQUARE_PATTERN = /^[a-h][1-8]$/;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

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

  if (message.type === MESSAGE_TYPES.HISTORY_LIST) {
    if (Number.isInteger(message.beforePly)) parsed.beforePly = message.beforePly;
    if (Number.isInteger(message.limit)) parsed.limit = message.limit;
  }

  if (message.type === MESSAGE_TYPES.TRACE_PUBLISH) {
    if (typeof message.phase === 'string') parsed.phase = message.phase;
    if (typeof message.summary === 'string') parsed.summary = message.summary;
  }

  return parsed;
}
