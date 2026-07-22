import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, parseClientMessage } from '../src/protocol.js';

test('uses protocol 2.0', () => assert.equal(PROTOCOL_VERSION, '2.0'));
test('rejects messages without a type', () => {
  assert.throws(() => parseClientMessage('{}'), /INVALID_MESSAGE/);
});
test('rejects unsupported message types', () => {
  assert.throws(() => parseClientMessage('{"type":"unknown.request"}'), /UNSUPPORTED_MESSAGE/);
});
test('requires turnId for probes', () => {
  assert.throws(() => parseClientMessage('{"type":"moves.list","square":"e2"}'), /STALE_TURN/);
});
test('rejects invalid probe squares', () => {
  assert.throws(() => parseClientMessage('{"type":"moves.list","turnId":"t","square":"z9"}'), /INVALID_SQUARE/);
});
test('accepts canonical piece probes', () => {
  assert.deepEqual(parseClientMessage('{"type":"moves.list","turnId":"t","square":"e2"}'), {
    type: 'moves.list', turnId: 't', square: 'e2',
  });
});
test('accepts canonical piece probes from a Buffer', () => {
  assert.deepEqual(parseClientMessage(Buffer.from('{"type":"moves.list","turnId":"t","square":"e2"}')), {
    type: 'moves.list', turnId: 't', square: 'e2',
  });
});
test('rejects malformed UCI validation moves', () => {
  assert.throws(() => parseClientMessage('{"type":"move.validate","turnId":"t","moveUci":"e2e9"}'), /INVALID_MOVE_FORMAT/);
});
test('rejects malformed UCI submitted moves', () => {
  assert.throws(() => parseClientMessage('{"type":"move.submit","turnId":"t","moveUci":"e2e9"}'), /INVALID_MOVE_FORMAT/);
});
test('normalizes valid UCI validation moves', () => {
  assert.deepEqual(parseClientMessage('{"type":"move.validate","turnId":"t","moveUci":"e2e4","ignored":true}'), {
    type: 'move.validate', turnId: 't', moveUci: 'e2e4',
  });
});
test('requires turnId for trace publication', () => {
  assert.throws(
    () => parseClientMessage('{"type":"trace.publish","summary":"Choose e4."}'),
    /STALE_TURN/
  );
});
test('preserves normalized turn-scoped trace fields', () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({
    type: 'trace.publish',
    turnId: ' t ',
    kind: 'decision',
    phase: 'evaluate',
    summary: 'Choose e4.',
    candidates: [{ uci: 'e2e4', note: 'Claims center.' }],
    selectedMove: null,
    ignored: true,
  })), {
    type: 'trace.publish',
    turnId: 't',
    kind: 'decision',
    phase: 'evaluate',
    summary: 'Choose e4.',
    candidates: [{ uci: 'e2e4', note: 'Claims center.' }],
    selectedMove: null,
  });
});

test('rejects supplied history fields that are not integers', () => {
  for (const field of ['beforePly', 'limit']) {
    assert.throws(
      () => parseClientMessage(JSON.stringify({ type: 'history.list', turnId: 'turn-1', [field]: '2' })),
      /INVALID_HISTORY_(CURSOR|LIMIT)/
    );
  }
});

test('rejects malformed trace candidate and selected UCI values', () => {
  for (const trace of [
    { candidates: [{ uci: 'e2e9', note: 'Invalid destination.' }] },
    { selectedMove: 'e2e9' },
  ]) {
    assert.throws(
      () => parseClientMessage(JSON.stringify({
        type: 'trace.publish', turnId: 'turn-1', summary: 'Choose e4.', ...trace,
      })),
      /INVALID_MOVE_FORMAT/
    );
  }
});
