import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSeatFor,
  normalizeMatchConfig,
  publicSeat,
  validateSeatCombination,
} from '../src/seats.js';

test('normalizes human versus engine exhibition', () => {
  const config = normalizeMatchConfig({
    mode: 'exhibition', visibility: 'public',
    seats: {
      white: { kind: 'human', name: 'Player' },
      black: { kind: 'engine', name: 'Stockfish' },
    },
    engine: { provider: 'stockfish', skillLevel: 5, movetimeMs: 150 },
  });
  assert.equal(config.clock.kind, 'none');
  assert.equal(config.seats.white.kind, 'human');
  assert.equal(config.seats.black.kind, 'engine');
  assert.equal(config.rated, false);
});

test('maps legacy agent payload into generic seats', () => {
  const config = normalizeMatchConfig({ agentColor: 'black', agentName: 'Legacy Agent', skillLevel: 3 });
  assert.equal(config.seats.black.kind, 'agent');
  assert.equal(config.seats.white.kind, 'engine');
  assert.equal(config.compatibility.legacyAgentColor, 'black');
});

test('rejects unsupported public exhibition pair', () => {
  assert.throws(() => normalizeMatchConfig({
    mode: 'exhibition', visibility: 'public',
    seats: { white: { kind: 'engine' }, black: { kind: 'engine' } },
  }), /UNSUPPORTED_SEAT_COMBINATION/);
});

test('resolves random human color on server and records request', () => {
  const config = normalizeMatchConfig({
    mode: 'exhibition', human: { name: 'Human' },
    opponent: { kind: 'engine', name: 'Computer' }, color: 'random',
  }, { random: () => 0.75 });
  assert.equal(config.seats.black.kind, 'human');
  assert.equal(config.colorSelection.requested, 'random');
  assert.equal(config.colorSelection.resolved, 'black');
});

test('normalizes generic agent versus engine shorthand as a public exhibition', () => {
  const config = normalizeMatchConfig({
    mode: 'exhibition', visibility: 'public',
    controller: { kind: 'agent', name: 'My agent' },
    opponent: { kind: 'engine', name: 'Computer' }, color: 'random',
    skillLevel: 12, movetimeMs: 300,
  }, { random: () => 0.2 });

  assert.equal(config.seats.white.kind, 'agent');
  assert.equal(config.seats.white.traceRequirement, 'structured_required');
  assert.equal(config.seats.black.kind, 'engine');
  assert.deepEqual(config.colorSelection, { requested: 'random', resolved: 'white' });
  assert.equal(config.compatibility, null);
  assert.equal(config.engine.skillLevel, 12);
});

test('preserves estimated Elo practice targets below Stockfish floor', () => {
  const config = normalizeMatchConfig({
    controller: { kind: 'agent', name: 'My agent' },
    opponent: { kind: 'engine', name: 'Computer' },
    color: 'white',
    targetElo: 500,
  });

  assert.equal(config.engine.targetElo, 500);
  assert.equal(config.engine.skillLevel, 5);
});

test('accepts unlimited engine strength target', () => {
  const config = normalizeMatchConfig({
    controller: { kind: 'human', name: 'Human' },
    opponent: { kind: 'engine', name: 'Computer' },
    color: 'white',
    targetElo: 'unlimited',
  });

  assert.equal(config.engine.targetElo, 'unlimited');
});

test('finds active seat for game turn', () => {
  const seats = { white: { kind: 'human' }, black: { kind: 'engine' } };
  assert.deepEqual(activeSeatFor('w', seats), { kind: 'human', color: 'white' });
  assert.deepEqual(activeSeatFor('black', seats), { kind: 'engine', color: 'black' });
});

test('returns only public seat fields', () => {
  assert.deepEqual(publicSeat({
    kind: 'agent', name: 'Private Agent', traceRequirement: 'structured_required', secret: 'hidden',
  }), {
    kind: 'agent', name: 'Private Agent', traceRequirement: 'structured_required',
  });
});

test('omits trace requirement from public non-agent seats', () => {
  assert.deepEqual(publicSeat({
    kind: 'engine', name: 'Stockfish', traceRequirement: null,
  }), {
    kind: 'engine', name: 'Stockfish',
  });
});

test('requires one human in public exhibition when human participates', () => {
  assert.throws(() => validateSeatCombination({
    mode: 'exhibition', visibility: 'public', compatibility: null,
    seats: { white: { kind: 'human' }, black: { kind: 'human' } },
  }), /UNSUPPORTED_SEAT_COMBINATION/);
});

test('rejects public private-eval seats', () => {
  assert.throws(() => normalizeMatchConfig({
    mode: 'private_eval', visibility: 'public',
    seats: {
      white: { kind: 'agent', name: 'Public Agent', traceRequirement: 'optional' },
      black: { kind: 'engine', name: 'Stockfish' },
    },
  }), /PRIVATE_EVAL_REQUIRES_PRIVATE_VISIBILITY/);
});
