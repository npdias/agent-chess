import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fenToBoard, shellQuote, squareName, deriveMatchSummary, groupMoves, deriveTurnPhase, derivePhaseEvidence, formatActivity, selectActivityEntries, buildActivityEntry, buildReviewItem } from '../public/app.js';

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

test('quotes copied ticket paths for zsh argv parsing', () => {
  const path = '/agent?ticket=short-lived';
  const result = spawnSync('/bin/zsh', ['-f', '-c', `set -- --path ${shellQuote(path)}; print -r -- "$2"`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path);
});

test('suppresses npm script echo in copied ticket command', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /npm run --silent connect -- --server/);
});


test('derives live and completed match summary states', () => {
  const live = deriveMatchSummary({
    status: 'active', seats: { white: { name: 'Human' }, black: { name: 'Computer' } },
    game: { gameOver: false, turn: 'black', result: '*', movesSan: ['e4'] },
  });
  assert.equal(live.status, 'Computer to move');
  assert.equal(live.resultLabel, 'In progress');

  const completed = deriveMatchSummary({
    status: 'completed', seats: { white: { name: 'Human' }, black: { name: 'Computer' } },
    game: { gameOver: true, turn: 'black', result: '1-0', checkmate: true, movesSan: ['e4', 'e5', 'Qh5'] },
  });
  assert.equal(completed.status, 'Checkmate');
  assert.equal(completed.resultLabel, '1-0');
  assert.equal(completed.termination, 'Checkmate');
});

test('groups SAN history into numbered move rows', () => {
  assert.deepEqual(groupMoves(['e4', 'e5', 'Nf3']), [
    { number: 1, white: 'e4', black: 'e5' },
    { number: 2, white: 'Nf3', black: '' },
  ]);
});

test('binds replay selection to individual native SAN buttons', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /button\.addEventListener\('click', \(\) => \{ replayPly = replayPlyForMove\(index, color\)/);
  assert.doesNotMatch(app, /row\.addEventListener\('click'/);
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

test('uses terminal lifecycle status without chess game-over', () => {
  assert.equal(deriveTurnPhase({ status: 'failed', game: { gameOver: false } }).key, 'complete');
  assert.equal(deriveMatchSummary({ status: 'aborted', termination: 'aborted', seats: {}, game: { gameOver: false, movesSan: [] } }).review, true);
});

test('formats system probe activity as compact verified metadata', () => {
  assert.equal(formatActivity({ source: 'system', type: 'moves.list', square: 'e2', count: 2 }).meta, 'e2 · 2 legal moves');
});

test('shows an agent-working fallback without invented decision text', () => {
  const activity = formatActivity({ source: 'agent', type: 'agent.trace', phase: 'evaluate' });
  assert.equal(activity.label, 'Evaluate');
  assert.equal(activity.detail, 'Agent working');
});

test('labels connector status and visible engine errors without claiming agent authorship', () => {
  assert.equal(formatActivity({ source: 'connector', type: 'agent.trace', phase: 'evaluate' }).source, 'connector');
  assert.deepEqual(formatActivity({ source: 'system', type: 'error', message: 'Engine offline.' }), {
    label: 'Match paused', meta: '', detail: 'Engine offline.', source: 'system', candidates: [],
  });
});

test('renders exact public trace disclosure source separate from transport actor', () => {
  const formatted = formatActivity({
    type: 'agent.decision', source: 'agent_reported', actor: 'agent', phase: 'choose', summary: 'Claim center.',
  });
  assert.equal(formatted.source, 'agent');
  assert.equal(formatted.disclosureSource, 'agent_reported');
  assert.equal(formatted.disclosureLabel, 'Agent reported');
  assert.equal(formatActivity({ type: 'agent.trace', source: 'provider_summary' }).disclosureLabel, 'Provider summary');
  assert.equal(formatActivity({ type: 'agent.trace', source: 'adapter_generated' }).disclosureLabel, 'Adapter generated');
});

test('uses neutral labels for unknown trace phases instead of a waiting state', () => {
  assert.equal(formatActivity({ source: 'agent', kind: 'decision', type: 'agent.trace', phase: 'gpt-5.6' }).label, 'Decision');
  assert.equal(formatActivity({ source: 'connector', kind: 'status', type: 'agent.trace', phase: 'failed' }).label, 'Connector status');
});

test('only marks phase ribbon steps backed by current-turn activity', () => {
  const match = {
    activity: [
      { type: 'turn.start', turnId: 'old', phase: 'observe' },
      { type: 'agent.trace', turnId: 'old', source: 'agent', phase: 'choose' },
      { type: 'turn.start', turnId: 'current', phase: 'observe' },
      { type: 'agent.trace', turnId: 'current', source: 'agent', phase: 'evaluate' },
    ],
  };
  assert.deepEqual(deriveTurnPhase(match), { key: 'evaluate', label: 'Evaluate' });
  assert.deepEqual(derivePhaseEvidence(match), new Set(['observe', 'evaluate']));
});

test('keeps last verified phase when a later connector failure has no phase mapping', () => {
  assert.deepEqual(deriveTurnPhase({ activity: [
    { type: 'turn.start', turnId: 'current', phase: 'observe' },
    { type: 'agent.trace', turnId: 'current', source: 'connector', phase: 'failed', summary: 'Connector stopped.' },
  ] }), { key: 'observe', label: 'Observe' });
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

test('renders hostile public seat names as text in review rows', () => {
  const nodes = [];
  const doc = { createElement(tag) { const node = { tag, children: [], append(...items) { this.children.push(...items); } }; nodes.push(node); return node; } };
  const row = buildReviewItem(doc, 'White', '<img src=x onerror=alert(1)>');
  assert.equal(row.innerHTML, undefined);
  assert.equal(nodes.at(-1).textContent, '<img src=x onerror=alert(1)>');
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

test('uses a desktop height-density rule to keep the square board in one viewport', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(min-width: 1021px\)[\s\S]*?\.board\s*\{[^}]*width:\s*100%[^}]*aspect-ratio:\s*1/);
  assert.match(css, /@media \(min-width: 1021px\)[\s\S]*?\.phase-ribbon,\s*\.player-strip,\s*\.board-footer\s*\{[^}]*width:\s*100%/);
});

test('allows the local connector command to shrink on narrow screens', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.connector-actions\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.connector-actions small\s*\{[^}]*min-width:\s*0/);
});

test('centers a height-bound desktop board beside an equal-height activity rail', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(min-width: 1021px\)[\s\S]*?--live-board-size:\s*min\(820px,\s*calc\(100dvh\s*-\s*290px\),\s*calc\(100vw\s*-\s*492px\)\)/);
  assert.match(css, /\.match-layout\s*\{[^}]*grid-template-columns:\s*var\(--live-board-size\)\s+minmax\(360px,\s*440px\)[^}]*justify-content:\s*center/);
  assert.match(css, /\.board-stage\s*\{[^}]*width:\s*var\(--live-board-size\)/);
  assert.match(css, /\.control-rail\s*\{[^}]*height:\s*calc\(var\(--live-board-size\)\s*\+\s*210px\)[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.activity-panel\s*\{[^}]*flex:\s*1\s+1\s+0/);
});

test('caps the aligned desktop board and derives rail height from it at every desktop height', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(min-width: 1021px\)\s*\{[\s\S]*?--live-board-size:\s*min\(820px,\s*calc\(100dvh\s*-\s*290px\),\s*calc\(100vw\s*-\s*492px\)\)/);
  assert.doesNotMatch(css, /@media \(min-width: 1021px\) and \(max-height: 1250px\)/);
  assert.match(css, /\.control-rail\s*\{[^}]*height:\s*calc\(var\(--live-board-size\)\s*\+\s*210px\)/);
});

test('locks chess squares to eight equal grid rows without intrinsic piece overflow', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.board\s*\{[^}]*grid-template-rows:\s*repeat\(8,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.square\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*0/);
  assert.match(css, /@media \(min-width: 1021px\)[\s\S]*?\.piece\s*\{[^}]*font-size:\s*min\(5rem,\s*calc\(var\(--live-board-size\)\s*\/\s*10\)\)/);
});

test('defines generic unrated human exhibition controls without capability leakage', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /name="opponentKind"/);
  assert.match(html, /name="humanColor"/);
  assert.match(html, /Unrated exhibition/);
  assert.match(html, /id="promotion-dialog"/);
  assert.match(html, /id="share-match"/);
  assert.match(html, /id="return-live"/);
  assert.match(html, /id="focus-mode"/);
  assert.match(html, /id="lifecycle-action"/);
  assert.doesNotMatch(html, /id="seat-token"/);
  assert.match(app, /sessionStorage\.setItem/);
  assert.match(app, /human-moves/);
  assert.match(app, /legal-target/);
  assert.match(app, /legal-capture/);
  assert.match(app, /document\.createElement\('button'\)/);
  assert.match(css, /\.board\s*\{[^}]*grid-template-columns:\s*repeat\(8/);
  assert.match(css, /\.board\s*\{[^}]*grid-template-rows:\s*repeat\(8/);
});
