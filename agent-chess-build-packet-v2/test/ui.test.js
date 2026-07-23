import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildExhibitionPayload, materialPerspective, buildAgentInviteUrl, selectDecisionBrief, deriveBoardTransitions, buildMaterialDisplay } from '../public/app.js';
import * as appModule from '../public/app.js';
import { spawnSync } from 'node:child_process';
import { fenToBoard, shellQuote, squareName, deriveMatchSummary, groupMoves, deriveTurnPhase, derivePhaseEvidence, formatActivity, selectActivityEntries, buildActivityEntry, buildReviewItem } from '../public/app.js';

const deriveTurnOwnerStatus = appModule.deriveTurnOwnerStatus ?? (() => ({}));
const derivePlayerState = appModule.derivePlayerState ?? (() => '');
const derivePostGameInterview = appModule.derivePostGameInterview ?? (() => ({}));
const deriveBalanceOfPower = appModule.deriveBalanceOfPower ?? (() => ({}));
const hasAgentJoined = appModule.hasAgentJoined ?? (() => false);
const shouldCompactMoveHistory = appModule.shouldCompactMoveHistory ?? (() => false);

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
  assert.equal(formatActivity({ source: 'system', type: 'error', message: 'Engine unavailable.', recoverable: false }).label, 'Match failed');
  assert.equal(formatActivity({ source: 'system', type: 'error', message: 'Engine unavailable.', status: 'failed' }).label, 'Match failed');
});

test('renders exact public trace disclosure source separate from transport actor', () => {
  const formatted = formatActivity({
    type: 'agent.decision', source: 'agent_reported', actor: 'agent', phase: 'choose', summary: 'Claim center.',
  });
  assert.equal(formatted.source, 'agent');
  assert.equal(formatted.disclosureSource, 'agent_reported');
  assert.equal(formatted.disclosureLabel, 'Agent reported');
  assert.equal(formatted.label, 'Decision');
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

test('keeps compact status and technical activity inside progressive match tools', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="status-line"/);
  assert.match(html, /id="match-tools-dialog"/);
  assert.match(html, /<details class="technical-activity"/);
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
  assert.match(css, /@media \(min-width: 1021px\)[\s\S]*?\.status-line,\s*\.player-strip,\s*\.board-footer\s*\{[^}]*width:\s*100%/);
});

test('allows the terminal fallback command to shrink on narrow screens', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /#match-tools-dialog\s*\{[^}]*width:\s*min\(620px,\s*calc\(100vw\s*-\s*32px\)\)/);
  assert.match(css, /\.terminal-fallback code\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('centers a height-bound desktop board beside a bounded three-surface rail', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(min-width: 1021px\)[\s\S]*?--live-board-size:\s*min\(820px,\s*calc\(100dvh\s*-\s*var\(--desktop-fixed-chrome\)\),\s*calc\(100vw\s*-\s*492px\)\)/);
  assert.match(css, /\.match-layout\s*\{[^}]*grid-template-columns:\s*var\(--live-board-size\)\s+minmax\(360px,\s*440px\)[^}]*justify-content:\s*center/);
  assert.match(css, /\.board-stage\s*\{[^}]*width:\s*var\(--live-board-size\)/);
  assert.match(css, /\.control-rail\s*\{[^}]*height:\s*calc\(var\(--live-board-size\)\s*\+\s*144px\)[^}]*overflow:\s*hidden/);
});

test('caps the aligned desktop board and derives rail height from it at every desktop height', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(min-width: 1021px\)\s*\{[\s\S]*?--live-board-size:\s*min\(820px,\s*calc\(100dvh\s*-\s*var\(--desktop-fixed-chrome\)\),\s*calc\(100vw\s*-\s*492px\)\)/);
  assert.doesNotMatch(css, /@media \(min-width: 1021px\) and \(max-height: 1250px\)/);
  assert.match(css, /\.control-rail\s*\{[^}]*height:\s*calc\(var\(--live-board-size\)\s*\+\s*144px\)/);
});

test('locks chess squares to eight equal grid rows without intrinsic piece overflow', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.board\s*\{[^}]*grid-template-rows:\s*repeat\(8,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.square\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*0/);
  assert.match(css, /@media \(min-width: 1021px\)[\s\S]*?\.piece\s*\{[^}]*font-size:\s*min\(5rem,\s*calc\(var\(--live-board-size\)\s*\/\s*10\)\)/);
});

test('defines generic exhibition controls without capability leakage', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /name="matchup"/);
  assert.match(html, /name="humanColor"/);
  assert.match(html, /Human vs Computer/);
  assert.match(html, /My agent vs Computer/);
  assert.match(app, /Agent plays as/);
  assert.match(html, /Unrated exhibition/);
  assert.match(html, /id="promotion-dialog"/);
  assert.match(html, /id="share-match"/);
  assert.match(html, /id="return-live"/);
  assert.match(html, /id="focus-mode"/);
  assert.match(html, /id="lifecycle-action"/);
  assert.doesNotMatch(html, /id="seat-token"/);
  assert.match(app, /sessionStorage\.setItem/);
  assert.match(app, /buildExhibitionPayload/);
  assert.match(app, /controller: \{ kind: agent \? 'agent' : 'human'/);
  assert.match(app, /human-moves/);
  assert.match(app, /legal-target/);
  assert.match(app, /legal-capture/);
  assert.match(app, /document\.createElement\('button'\)/);
  assert.match(css, /\.board\s*\{[^}]*grid-template-columns:\s*repeat\(8/);
  assert.match(css, /\.board\s*\{[^}]*grid-template-rows:\s*repeat\(8/);
});

test('builds agent versus computer setup payload without legacy fields', () => {
  assert.deepEqual(buildExhibitionPayload({ matchup: 'agent-engine', color: 'black', skillLevel: '9' }), {
    controller: { kind: 'agent', name: 'My agent' },
    opponent: { kind: 'engine', name: 'Computer' },
    color: 'black', skillLevel: 9, movetimeMs: 150,
  });
});

test('uses owned agent color for material while keeping spectators neutral', () => {
  assert.equal(materialPerspective('white', null), 'white');
  assert.equal(materialPerspective('black', null), 'black');
  assert.equal(materialPerspective(null, 'white'), 'white');
  assert.equal(materialPerspective(null, null), 'white');
});

test('builds an absolute agent invitation only from the server join path', () => {
  assert.equal(
    buildAgentInviteUrl('https://agent-chess.example:8443', '/agent/join?ticket=one-use'),
    'https://agent-chess.example:8443/agent/join?ticket=one-use',
  );
});

test('selects current structured decision without exposing private reasoning', () => {
  assert.deepEqual(selectDecisionBrief({ activity: [
    { type: 'agent.trace', source: 'agent', phase: 'evaluate', summary: 'Private scratchpad: attack h7', reasoning: 'hidden' },
    { type: 'agent.decision', source: 'agent_reported', actor: 'agent', phase: 'choose', summary: 'Develop king-side pressure.', selectedMove: 'g1f3', candidates: [{ uci: 'g1f3', note: 'Develop' }, { uci: 'd2d4', note: 'Center' }], disclosure: 'public' },
  ] }), {
    state: 'decision', intent: 'Develop king-side pressure.', candidates: [{ uci: 'g1f3', note: 'Develop' }, { uci: 'd2d4', note: 'Center' }], selectedMove: 'g1f3', disclosure: 'Agent reported',
  });
  assert.deepEqual(selectDecisionBrief({ status: 'failed', game: { gameOver: false }, activity: [] }), {
    state: 'failed', intent: 'Match failed before an agent decision was published.', candidates: [], selectedMove: '', disclosure: 'System status',
  });
  assert.deepEqual(selectDecisionBrief({ activity: [{ source: 'agent', phase: 'evaluate', summary: 'Private chain of thought' }] }), {
    state: 'working', intent: 'Agent is evaluating current position.', candidates: [], selectedMove: '', disclosure: 'Phase status',
  });
  assert.deepEqual(selectDecisionBrief({ activity: [] }), {
    state: 'empty', intent: 'No public agent decision yet.', candidates: [], selectedMove: '', disclosure: 'No disclosure',
  });
  assert.deepEqual(selectDecisionBrief({
    activeTurn: { turnId: 'turn-2' },
    activity: [
      { type: 'agent.decision', turnId: 'turn-1', source: 'agent_reported', actor: 'agent', summary: 'Previous move.', selectedMove: 'a2a3' },
      { type: 'turn.start', turnId: 'turn-2' },
      { type: 'agent.trace', turnId: 'turn-2', actor: 'agent', source: 'agent_reported', phase: 'evaluate', summary: 'Evaluating current move.' },
    ],
  }), {
    state: 'working', intent: 'Agent is evaluating current position.', candidates: [], selectedMove: '', disclosure: 'Phase status',
  });
});

test('uses spectator-first hierarchy while preserving match controls', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="status-line"/);
  assert.match(html, /id="decision-brief"/);
  assert.match(html, /<details class="technical-activity"/);
  assert.match(html, /<details class="steering-details"/);
  assert.match(html, /Copy agent link/);
  assert.match(html, /id="copy-agent-link"/);
  assert.match(html, /id="copy-command"/);
  for (const id of ['lifecycle-action', 'download-match', 'share-match', 'focus-mode', 'copy-pgn', 'moves']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /buildAgentInviteUrl\(location\.origin, session\.joinPath\)/);
  assert.match(app, /copy-agent-link.*addEventListener/s);
  assert.match(app, /connector\.classList\.toggle\('connected'/);
  assert.doesNotMatch(html, /id="connect-command">[^<]+ticket=/);
  assert.match(css, /--live-board-size:\s*min\(820px,\s*calc\(100dvh\s*-\s*var\(--desktop-fixed-chrome\)\)/);
  assert.match(css, /\.control-rail\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.technical-activity/);
  assert.match(css, /@media \(max-width: 1020px\)[\s\S]*?\.control-rail\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.connector-actions button\s*\{[^}]*min-height:\s*44px/);
});

test('keeps match tools available in focus mode', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="match-tools-button"/);
  assert.doesNotMatch(css, /\.focus-mode[^}]*#match-tools-button/);
});

test('centers only the board stack in focus mode without reserving a hidden rail', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.focus-mode \.topbar,\s*\.focus-mode \.control-rail\s*\{[^}]*display:\s*none/);
  assert.match(css, /@media \(min-width:\s*1021px\)[\s\S]*?\.focus-mode \.match-layout\s*\{[^}]*grid-template-columns:\s*var\(--live-board-size\)[^}]*justify-content:\s*center/);
  assert.doesNotMatch(css, /\.focus-mode \.match-layout\s*\{[^}]*minmax\(280px,\s*360px\)/);
});

test('budgets full desktop board stack within a 720px viewport', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const chrome = Number(css.match(/--desktop-fixed-chrome:\s*(\d+)px/)?.[1]);
  assert.equal(chrome, 250);
  assert.equal(720 - chrome + chrome <= 720, true);
  const board = 720 - chrome;
  assert.equal(board + 235 <= 705, true);
  assert.equal(board + 144 <= 720, true);
  assert.match(css, /--live-board-size:\s*min\(820px,\s*calc\(100dvh\s*-\s*var\(--desktop-fixed-chrome\)\),\s*calc\(100vw\s*-\s*492px\)\)/);
  assert.match(css, /\.match-active,\s*\.match-active body\s*\{[^}]*height:\s*100dvh[^}]*overflow:\s*hidden/);
  assert.match(css, /\.board-footer\s*\{[^}]*max-height:\s*24px/);
});

test('removes obsolete phase tab summary and legacy rail CSS', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const selector of ['phase-ribbon', 'phase-steps', 'status-panel', 'status-primary', 'summary-grid', 'tab-panel', 'tab-content', 'live-label', 'lifecycle-panel', 'position-line']) {
    assert.doesNotMatch(css, new RegExp(`\\.${selector}\\b`));
  }
  assert.doesNotMatch(css, /\.tabs\b|\.tab\b/);
});

test('removes obsolete tab controller after native details migration', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /function selectTab\(/);
  assert.doesNotMatch(app, /querySelectorAll\('\.tab'\)/);
});

test('limits default rail to onboarding decision and move history surfaces', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const rail = html.match(/<aside class="control-rail">([\s\S]*?)<\/aside>/)?.[1] ?? '';
  assert.match(rail, /id="connector"/);
  assert.match(rail, /id="decision-brief"/);
  assert.match(rail, /class="panel moves-panel"/);
  for (const id of ['steering-form', 'activity', 'download-match', 'lifecycle-action', 'fen', 'copy-pgn']) assert.doesNotMatch(rail, new RegExp(`id="${id}"`));
  assert.doesNotMatch(rail, /<ol id="connector-steps"/);
});

test('moves preserved secondary controls into one internally scrolling Match tools dialog', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  const dialog = html.match(/<dialog id="match-tools-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? '';
  for (const id of ['steering-form', 'activity', 'copy-pgn', 'download-match', 'lifecycle-action', 'fen', 'copy-command']) assert.match(dialog, new RegExp(`id="${id}"`));
  assert.match(dialog, /id="close-match-tools"/);
  assert.match(html, /How agents connect/);
  assert.match(app, /match-tools-button.*showModal/s);
  assert.match(app, /connector-how.*showModal/s);
  assert.match(css, /#match-tools-dialog\s*\{[^}]*max-height:\s*calc\(100dvh\s*-\s*32px\)[^}]*overflow-y:\s*auto/);
});

test('keeps board footer compact and technical position data out of sight', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const footer = html.match(/<div class="board-footer">([\s\S]*?)<\/div>/)?.[1] ?? '';
  assert.match(footer, /id="material"/);
  assert.match(footer, /id="return-live"/);
  assert.match(footer, /id="flip-board"/);
  assert.doesNotMatch(footer, /id="fen"|No clock|position-line/);
});

test('uses mode-neutral move-history empty copy', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /Moves will appear after play begins\./);
  assert.doesNotMatch(app, /Moves will appear after the agent connects\./);
});

test('keeps early live move history content-sized and expands established games', async () => {
  assert.equal(shouldCompactMoveHistory({ status: 'active', game: { movesSan: [] } }), true);
  assert.equal(shouldCompactMoveHistory({ status: 'active', game: { movesSan: ['e4', 'e5', 'Nf3', 'Nc6'] } }), true);
  assert.equal(shouldCompactMoveHistory({ status: 'active', game: { movesSan: Array.from({ length: 12 }, (_, index) => `m${index}`) } }), false);
  assert.equal(shouldCompactMoveHistory({ status: 'completed', game: { gameOver: true, movesSan: [] } }), false);

  const [app, css] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /movesPanel\.classList\.toggle\('is-compact', shouldCompactMoveHistory\(match\)\)/);
  assert.match(css, /\.moves-panel\.is-compact\s*\{[^}]*flex:\s*0 0 auto/);
});

test('collapses connected onboarding to a slim status row', async () => {
  const [app, css] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /const agentHasJoined = hasAgentJoined\(match\)/);
  assert.match(app, /connector\.hidden = !ownsAgentSeat \|\| summary\.review/);
  assert.match(app, /connector\.classList\.toggle\('connected', agentHasJoined\)/);
  assert.match(app, /connector-how'\)\.hidden = agentHasJoined/);
  assert.match(app, /connector-feedback'\)\.hidden = agentHasJoined/);
  assert.match(css, /\.connector-card\.connected\s*\{[^}]*display:\s*flex[^}]*min-height:\s*0[^}]*padding:\s*8px 10px/);
});

test('does not mistake an engine-first move for an agent connection', () => {
  assert.equal(hasAgentJoined({ connected: false, game: { ply: 1 }, activity: [{ actor: 'engine', type: 'move.accepted' }] }), false);
  assert.equal(hasAgentJoined({ connected: true, game: { ply: 0 }, activity: [] }), true);
  assert.equal(hasAgentJoined({ connected: false, game: { ply: 2 }, activity: [{ actor: 'agent', type: 'agent.decision' }] }), true);
});

test('hides agent decision surface when no agent is playing', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const hasAgentSeat = Object\.values\(seats\)\.some\(\(seat\) => seat\.kind === 'agent'\)/);
  assert.match(app, /decisionPanel\.hidden = summary\.review \|\| !hasAgentSeat/);
});

test('names exactly who owns the current turn', () => {
  const seats = {
    white: { kind: 'agent', name: 'Luna' },
    black: { kind: 'engine', name: 'Computer' },
  };

  assert.deepEqual(deriveTurnOwnerStatus({ status: 'active', connected: false, seats, game: { turn: 'white' }, activity: [] }), {
    headline: 'Waiting on Luna', detail: 'Agent needs to connect', state: 'waiting', activeColor: 'white',
  });
  assert.deepEqual(deriveTurnOwnerStatus({ status: 'active', connected: true, seats, game: { turn: 'white' }, activity: [{ phase: 'evaluate' }] }), {
    headline: 'Luna is thinking', detail: 'Evaluate', state: 'thinking', activeColor: 'white',
  });
  assert.deepEqual(deriveTurnOwnerStatus({ status: 'active', connected: true, seats, game: { turn: 'black' }, activity: [] }), {
    headline: 'Computer is moving', detail: 'Engine turn', state: 'moving', activeColor: 'black',
  });
  assert.equal(derivePlayerState({ status: 'active', connected: true, seats, game: { turn: 'white' } }, 'white'), 'Thinking');
  assert.equal(derivePlayerState({ status: 'active', connected: true, seats, game: { turn: 'white' } }, 'black'), 'Watching');
  assert.equal(derivePlayerState({ status: 'active', connected: false, seats, game: { turn: 'white' } }, 'white'), 'Connecting');
  assert.equal(derivePlayerState({ status: 'completed', connected: false, seats, game: { turn: 'black', gameOver: true } }, 'white'), 'Finished');
});

test('uses explicit turn-owner states without ambiguous Waiting labels', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /derivePlayerState\(match, seat\.color, ownedControllerColor\)/);
  assert.match(app, /deriveTurnOwnerStatus\(match, ownedControllerColor\)/);
  assert.doesNotMatch(app, /\? 'Thinking' : 'Waiting'/);
  assert.doesNotMatch(app, /\? 'To move' : 'No clock'/);
  assert.doesNotMatch(html, /id="(?:top|bottom)-state" class="clock">No clock/);
});

test('builds a post-game interview from public summaries and recorded material swings', () => {
  const interview = derivePostGameInterview({
    status: 'completed',
    termination: 'checkmate',
    seats: { white: { kind: 'agent', name: 'Luna' }, black: { kind: 'engine', name: 'Computer' } },
    activity: [
      { type: 'agent.decision', actor: 'agent', source: 'agent_reported', summary: 'Claim the center.', selectedMove: 'd1d5' },
      { type: 'agent.decision', actor: 'agent', source: 'agent_reported', summary: 'Keep king cover.', selectedMove: 'h2h3' },
    ],
    game: {
      gameOver: true,
      checkmate: true,
      result: '0-1',
      movesSan: ['Qxd5', 'exd5', 'Kh1', 'Qxg2#'],
      positions: [
        '4k3/8/4p3/3Q4/8/8/8/4K3 w - - 0 1',
        '4k3/8/4p3/3Q4/8/8/8/4K3 b - - 0 1',
        '4k3/8/8/3p4/8/8/8/4K3 w - - 0 2',
        '4k3/8/8/3p4/8/8/7K/8 b - - 1 2',
        '4k3/8/8/3p4/8/8/6qK/8 w - - 2 3',
      ],
    },
  });

  assert.equal(interview.agentName, 'Luna');
  assert.equal(interview.sourceLabel, 'Public record');
  assert.match(interview.opening, /Claim the center/);
  assert.match(interview.turningPoint, /1\.Qxd5/);
  assert.match(interview.turningPoint, /1\.\.\.exd5/);
  assert.match(interview.turningPoint, /9-point/);
  assert.match(interview.pressure, /2\.\.\.Qxg2#/);
  assert.match(interview.rematch, /recaptures/);
  assert.match(interview.note, /No private reasoning/);
});

test('shows interview in terminal rail without adding another visible live-match surface', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  const postMatch = html.match(/<section id="post-match"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(postMatch, /id="interview-list"/);
  assert.match(postMatch, /id="interview-title"/);
  assert.ok(postMatch.indexOf('id="interview-list"') < postMatch.indexOf('id="review-list"'));
  assert.match(app, /decisionPanel\.hidden = summary\.review/);
  assert.match(app, /derivePostGameInterview\(match\)/);
  assert.match(css, /\.match-complete \.post-match\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.match-complete \.moves-panel\s*\{[^}]*flex:\s*0 0 164px/);
  assert.match(css, /\.match-complete \.moves-panel \.moves\s*\{[^}]*height:\s*114px[^}]*max-height:\s*114px/);
});

test('derives chess-site-style balance from Stockfish evaluation with truthful fallbacks', () => {
  const whiteLead = deriveBalanceOfPower({ evaluation: { type: 'cp', value: 120, perspective: 'white' }, game: {} });
  assert.equal(whiteLead.label, '+1.2');
  assert.equal(whiteLead.leader, 'White');
  assert.ok(whiteLead.whitePercent > 50);
  assert.equal(whiteLead.source, 'Stockfish');

  assert.deepEqual(deriveBalanceOfPower({ evaluation: { type: 'mate', value: -3, perspective: 'white' }, game: {} }), {
    whitePercent: 0, label: 'M3', leader: 'Black', source: 'Stockfish', accessible: 'Stockfish evaluation: Black has mate in 3',
  });
  assert.deepEqual(deriveBalanceOfPower({ game: { gameOver: true, checkmate: true, result: '0-1' } }), {
    whitePercent: 0, label: '0-1', leader: 'Black', source: 'Result', accessible: 'Final result: Black won',
  });

  const material = deriveBalanceOfPower({ game: {
    initialFen: '3qk3/8/8/8/8/8/8/3QK3 w - - 0 1',
    fen: '3qk3/8/8/8/8/8/8/3QK3 w - - 0 1',
  } });
  assert.equal(material.source, 'Material');
  assert.equal(material.whitePercent, 50);
});

test('places an accessible vertical power bar beside the fixed board', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /class="board-shell"[\s\S]*?id="power-bar"[\s\S]*?id="board"/);
  assert.match(html, /id="power-score"/);
  assert.match(app, /deriveBalanceOfPower\(match\)/);
  assert.match(app, /powerBar\.style\.setProperty\('--white-share'/);
  assert.match(css, /\.power-bar\s*\{[^}]*position:\s*absolute[^}]*left:\s*-18px[^}]*height:\s*100%/);
  assert.match(css, /\.power-white\s*\{[^}]*height:\s*var\(--white-share\)/);
});

test('keeps captured-piece detail accessible while showing compact material score', () => {
  assert.deepEqual(buildMaterialDisplay({ captured: ['white pawn', 'white knight'], difference: -6 }), {
    text: 'Material -6',
    accessible: 'Captured: white pawn, white knight; Material -6',
  });
  assert.deepEqual(buildMaterialDisplay({ captured: ['black pawn'], difference: 1 }), {
    text: 'Material +1',
    accessible: 'Captured: black pawn; Material +1',
  });
});

test('keeps every visible desktop footer child within the 24px footer', async () => {
  const [app, css] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /materialNode\.setAttribute\('aria-label', display\.accessible\)/);
  assert.match(app, /materialNode\.title = display\.accessible/);
  assert.match(css, /\.board-footer \.material\s*\{[^}]*white-space:\s*nowrap[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*line-height:\s*24px/);
  assert.match(css, /\.board-footer \.text-button\s*\{[^}]*height:\s*24px[^}]*min-height:\s*24px[^}]*padding:\s*0 6px[^}]*line-height:\s*24px/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.board-footer \.text-button\s*\{[^}]*min-height:\s*44px/);
});

test('keeps every mobile match and dialog action at least 44px tall', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const mobile = css.match(/@media \(max-width: 720px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  for (const selector of ['.context-actions button', '.dialog-heading button', '.tool-actions button', '.terminal-fallback button', '.promotion-actions button', '#promotion-dialog > form > .text-button', '#match-tools-dialog summary', '#new-match-button', '.move-row button']) {
    assert.match(mobile, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(mobile, /min-height:\s*44px/);
});

test('removes dead connector code and obsolete match eyebrow selectors', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.connector-card code\b/);
  assert.doesNotMatch(css, /\.connector-actions small\b/);
  assert.doesNotMatch(css, /\.match-context \.eyebrow\b/);
});

test('keeps board squares stable while reconciling keyed pieces', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(app, /board\.replaceChildren\(\)/);
  assert.match(app, /function initializeBoard\(board\)/);
  assert.match(app, /function reconcileBoardPieces\(board, pieces, animation\)/);
  assert.match(app, /board\.dataset\.orientation/);
  assert.match(app, /square\.dataset\.square = name/);
});

test('uses bounded transform motion while preserving board interaction states', async () => {
  const [app, css] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /requestAnimationFrame/);
  assert.match(app, /setTimeout\(clearBoardAnimation, BOARD_SETTLE_MS\)/);
  assert.match(app, /const BOARD_SETTLE_MS = 280/);
  assert.match(app, /replayPly === null && !pendingMove/);
  assert.match(app, /square\.classList\.toggle\('selected'/);
  assert.match(app, /square\.classList\.toggle\('submission-pending'/);
  assert.match(css, /\.piece\.move-animation\s*\{[^}]*transform[^}]*260ms cubic-bezier\(\.22,\s*1,\s*\.36,\s*1\)/);
  assert.match(css, /\.piece\.capture-animation\s*\{[^}]*opacity/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.piece\.move-animation,\s*\.piece\.capture-animation\s*\{[^}]*transition:\s*none/);
});

test('derives en-passant pawn square for its opacity transition', () => {
  const transitions = deriveBoardTransitions(
    fenToBoard('8/8/8/3pP3/8/8/8/4K3 w - d6 0 1'),
    fenToBoard('8/8/3P4/8/8/8/8/4K3 b - - 0 1'),
    'e5d6',
  );
  assert.deepEqual(transitions.captureSquares, ['d5']);
  assert.deepEqual(transitions.transfers, [{ from: 'e5', to: 'd6', piece: 'P' }]);
});

test('keeps en-passant capture node until its opacity transition finishes', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /function deriveBoardTransitions\(previous, current, lastMove\)/);
  assert.match(app, /removedOpponent/);
  assert.match(app, /captureSquare/);
  assert.match(app, /capturedSquare\.querySelector\('\.piece'\)/);
});

test('derives king and rook transfers for castling', () => {
  const transitions = deriveBoardTransitions(
    fenToBoard('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'),
    fenToBoard('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1'),
    'e1g1',
  );
  assert.deepEqual(transitions.transfers, [
    { from: 'e1', to: 'g1', piece: 'K' },
    { from: 'h1', to: 'f1', piece: 'R' },
  ]);
});

test('transfers both king and rook nodes during castling', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /transfers\.push/);
  assert.match(app, /for \(const transfer of animation\.transfers\)/);
  assert.match(app, /rookFrom/);
  assert.match(app, /rookTo/);
});
