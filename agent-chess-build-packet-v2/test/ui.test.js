import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fenToBoard, squareName, deriveMatchSummary, groupMoves, deriveTurnPhase, formatActivity, selectActivityEntries, buildActivityEntry } from '../public/app.js';

test('maps FEN piece placement into 64 board squares', () => {
  const board = fenToBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(board.length, 64);
  assert.equal(board[0], 'r');
  assert.equal(board[4], 'k');
  assert.equal(board[60], 'K');
  assert.equal(board[63], 'R');
});

test('converts board indexes to algebraic square names', () => {
  assert.equal(squareName(0), 'a8');
  assert.equal(squareName(7), 'h8');
  assert.equal(squareName(56), 'a1');
  assert.equal(squareName(63), 'h1');
});


test('derives live and completed match summary states', () => {
  const live = deriveMatchSummary({
    agentColor: 'white',
    connected: true,
    steeringMode: 'trainer',
    game: { gameOver: false, turn: 'black', result: '*', movesSan: ['e4'] },
  });
  assert.equal(live.status, 'Stockfish thinking');
  assert.equal(live.resultLabel, 'In progress');
  assert.equal(live.steeringLabel, 'Trainer enabled');

  const completed = deriveMatchSummary({
    agentColor: 'white',
    connected: true,
    steeringMode: 'locked',
    game: { gameOver: true, turn: 'black', result: '1-0', checkmate: true, movesSan: ['e4', 'e5', 'Qh5'] },
  });
  assert.equal(completed.status, 'Agent victory');
  assert.equal(completed.resultLabel, '1-0');
  assert.equal(completed.termination, 'Checkmate');
});

test('groups SAN history into numbered move rows', () => {
  assert.deepEqual(groupMoves(['e4', 'e5', 'Nf3']), [
    { number: 1, white: 'e4', black: 'e5' },
    { number: 2, white: 'Nf3', black: '' },
  ]);
});

test('derives verified turn phase or truthful waiting fallback', () => {
  assert.equal(deriveTurnPhase({ activity: [{ phase: 'probe' }] }).key, 'probe');
  assert.equal(deriveTurnPhase({ activity: [] }).label, 'Waiting for turn');
});

test('labels completed matches without showing a live turn phase', () => {
  assert.deepEqual(deriveTurnPhase({ game: { gameOver: true }, activity: [{ phase: 'observe' }] }), {
    key: 'complete', label: 'Match complete',
  });
});

test('formats system probe activity as compact verified metadata', () => {
  assert.equal(formatActivity({ source: 'system', type: 'moves.list', square: 'e2', count: 2 }).meta, 'e2 · 2 legal moves');
});

test('shows an agent-working fallback without invented decision text', () => {
  const activity = formatActivity({ source: 'agent', type: 'agent.trace', phase: 'evaluate' });
  assert.equal(activity.label, 'Evaluate');
  assert.equal(activity.detail, 'Agent working');
});

test('retains queued steering when verified activity exists, newest first', () => {
  const entries = selectActivityEntries({
    activity: [{ type: 'moves.list', source: 'system', at: '2026-07-21T12:00:00.000Z' }],
    trace: [{ type: 'steering.queued', message: 'Avoid exchanges.', at: '2026-07-21T12:01:00.000Z' }],
  });
  assert.deepEqual(entries.map((entry) => entry.type), ['steering.queued', 'moves.list']);
});

test('uses structured activity without duplicating generic trace copies', () => {
  const entries = selectActivityEntries({
    activity: [{ type: 'move.submit', source: 'system', selectedMove: 'e2e4', at: '2026-07-21T12:01:00.000Z' }],
    trace: [
      { type: 'agent.move', uci: 'e2e4', at: '2026-07-21T12:01:00.000Z' },
      { type: 'steering.queued', message: 'Avoid exchanges.', at: '2026-07-21T12:00:00.000Z' },
    ],
  });
  assert.deepEqual(entries.map((entry) => entry.type), ['move.submit', 'steering.queued']);
});

test('renders malicious activity text without injecting markup', () => {
  const nodes = [];
  const doc = { createElement(tag) {
    const node = { tag, children: [], append(...children) { this.children.push(...children); }, setAttribute() {} };
    nodes.push(node);
    return node;
  } };
  const entry = buildActivityEntry(doc, {
    source: 'agent', type: 'agent.trace', phase: 'evaluate', summary: '<img src=x onerror=alert(1)>',
    candidates: [{ uci: 'e2e4', note: '<script>alert(1)</script>' }],
  });
  const text = nodes.map((node) => node.textContent).filter(Boolean);
  assert.equal(entry.innerHTML, undefined);
  assert.deepEqual(text, ['Agent · Evaluate', '<img src=x onerror=alert(1)>', 'e2e4', ' <script>alert(1)</script>']);
});

test('keeps phase ribbon and activity rail visible outside secondary tabs', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /class="phase-ribbon"/);
  assert.match(html, /id="activity"/);
  assert.match(css, /\.board\s*\{[^}]*aspect-ratio:\s*1/);
  assert.match(css, /\.square\s*\{[^}]*aspect-ratio:\s*1/);
  assert.match(css, /@media \(max-width: 1020px\)[\s\S]*?\.match-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.player-identity,\s*\.player-meta\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.clock\s*\{[^}]*min-width:\s*0/);
});
