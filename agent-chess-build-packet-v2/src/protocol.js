export const MESSAGE_TYPES = Object.freeze({
  MATCH_START: 'match.start',
  TURN_START: 'turn.start',
  MOVE_SUBMIT: 'move.submit',
  MOVE_ACCEPTED: 'move.accepted',
  MOVE_REJECTED: 'move.rejected',
  OPPONENT_MOVE: 'opponent.move',
  GAME_END: 'game.end',
  STATE: 'match.state',
  TRACE_PUBLISH: 'trace.publish',
  ERROR: 'error',
});

export function parseClientMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    throw new Error('INVALID_JSON');
  }
  if (!message || typeof message.type !== 'string') throw new Error('INVALID_MESSAGE');
  return message;
}
