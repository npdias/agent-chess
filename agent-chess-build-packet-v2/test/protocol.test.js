import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, parseClientMessage } from '../src/protocol.js';

test('uses protocol 2.0', () => assert.equal(PROTOCOL_VERSION, '2.0'));
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
