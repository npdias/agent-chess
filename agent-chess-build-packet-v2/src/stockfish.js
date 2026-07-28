import { createRequire } from 'node:module';
import { Chess } from 'chess.js';

const require = createRequire(import.meta.url);
const initStockfish = require('stockfish');
const STOCKFISH_MIN_ELO = 1320;
const STOCKFISH_MAX_ELO = 3190;
const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export function strengthProfileForTarget(targetElo) {
  if (targetElo === null || targetElo === undefined || targetElo === '') return null;
  if (targetElo === 'unlimited') return { mode: 'unlimited', targetElo: null };
  const numeric = Number(targetElo);
  if (!Number.isFinite(numeric)) return null;
  const target = Math.max(250, Math.min(3200, Math.round(numeric)));
  if (target < STOCKFISH_MIN_ELO) return { mode: 'practice', targetElo: target };
  return {
    mode: 'uci-elo',
    targetElo: target,
    uciElo: Math.max(STOCKFISH_MIN_ELO, Math.min(STOCKFISH_MAX_ELO, target)),
  };
}

function practiceMoveScore(fen, move) {
  const chess = new Chess(fen);
  let score = (PIECE_VALUE[move.captured] ?? 0) + (move.promotion ? PIECE_VALUE[move.promotion] : 0);
  if ('kq'.includes(move.flags)) score += 45;
  if ('d4e4d5e5'.includes(move.to)) score += 20;
  if ('nb'.includes(move.piece) && ['1', '2', '7', '8'].includes(move.from[1])) score += 20;

  chess.move(move);
  if (chess.isCheckmate()) return 100_000;
  if (chess.inCheck()) score += 55;

  const canRecapture = chess.moves({ verbose: true }).some((reply) => (
    reply.to === move.to && reply.captured === move.piece
  ));
  if (canRecapture) score -= PIECE_VALUE[move.piece] ?? 0;
  return score;
}

export function selectPracticeMove(fen, targetElo, random = Math.random) {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  if (!moves.length) throw new Error('STOCKFISH_NO_MOVE');
  const randomValue = Math.max(0, Math.min(0.999999, Number(random())));
  if (Number(targetElo) <= 250) return moves[Math.floor(randomValue * moves.length)].lan;

  const ranked = moves
    .map((move, index) => ({ move, index, score: practiceMoveScore(fen, move) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const quality = Math.max(0, Math.min(1, (Number(targetElo) - 250) / 1000));
  const poolSize = Math.max(1, Math.ceil(ranked.length * (1 - quality * 0.88)));
  return ranked[Math.floor(randomValue * poolSize)].move.lan;
}

function setStrength(engine, targetElo, skillLevel) {
  const profile = strengthProfileForTarget(targetElo);
  if (!profile) {
    engine.sendCommand('setoption name UCI_LimitStrength value false');
    engine.sendCommand(`setoption name Skill Level value ${Math.max(0, Math.min(20, Number(skillLevel)))}`);
    return null;
  }
  if (profile.mode === 'unlimited') {
    engine.sendCommand('setoption name UCI_LimitStrength value false');
    engine.sendCommand('setoption name Skill Level value 20');
  } else if (profile.mode === 'uci-elo') {
    engine.sendCommand('setoption name UCI_LimitStrength value true');
    engine.sendCommand(`setoption name UCI_Elo value ${profile.uciElo}`);
  } else {
    engine.sendCommand('setoption name UCI_LimitStrength value false');
    engine.sendCommand('setoption name Skill Level value 0');
  }
  return profile;
}

function waitForLine(engine, predicate, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      engine.__listeners.delete(listener);
      reject(new Error('STOCKFISH_TIMEOUT'));
    }, timeoutMs);

    const listener = (line) => {
      if (!predicate(line)) return;
      clearTimeout(timer);
      engine.__listeners.delete(listener);
      resolve(line);
    };

    engine.__listeners.add(listener);
  });
}

export function parseUciScore(line, fen) {
  const match = String(line).match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  if (!match) return null;
  const sideToMove = String(fen).trim().split(/\s+/)[1];
  const value = Number(match[2]) * (sideToMove === 'b' ? -1 : 1);
  return { type: match[1], value, perspective: 'white' };
}

export class StockfishEngine {
  constructor(engine, { movetimeMs = 100, skillLevel = 5, targetElo = null, random = Math.random } = {}) {
    this.engine = engine;
    this.movetimeMs = movetimeMs;
    this.skillLevel = skillLevel;
    this.targetElo = targetElo;
    this.random = random;
    this.queue = Promise.resolve();
  }

  static async start(options = {}) {
    delete require.cache[require.resolve('stockfish/bin/stockfish-18-lite-single.js')];
    const engine = await initStockfish('lite-single');
    engine.__listeners = new Set();
    engine.listener = (line) => {
      for (const listener of engine.__listeners) listener(line);
    };

    engine.sendCommand('uci');
    await waitForLine(engine, (line) => line === 'uciok');
    setStrength(engine, options.targetElo, options.skillLevel ?? 5);
    engine.sendCommand('isready');
    await waitForLine(engine, (line) => line === 'readyok');

    return new StockfishEngine(engine, options);
  }

  async bestMove(fen, {
    movetimeMs = this.movetimeMs,
    skillLevel = this.skillLevel,
    targetElo = this.targetElo,
  } = {}) {
    const profile = strengthProfileForTarget(targetElo);
    if (profile?.mode === 'practice') {
      return selectPracticeMove(fen, profile.targetElo, this.random);
    }
    const operation = async () => {
      setStrength(this.engine, targetElo, skillLevel);
      this.engine.sendCommand(`position fen ${fen}`);
      this.engine.sendCommand(`go movetime ${movetimeMs}`);
      const line = await waitForLine(
        this.engine,
        (candidate) => candidate.startsWith('bestmove '),
        Math.max(10_000, movetimeMs * 20)
      );
      const [, move] = line.split(/\s+/);
      if (!move || move === '(none)') throw new Error('STOCKFISH_NO_MOVE');
      return move;
    };

    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async evaluate(fen, { movetimeMs = Math.min(100, this.movetimeMs) } = {}) {
    const operation = async () => {
      let latest = null;
      const scoreListener = (line) => {
        const score = parseUciScore(line, fen);
        if (score) latest = score;
      };
      this.engine.__listeners.add(scoreListener);
      try {
        this.engine.sendCommand('setoption name UCI_LimitStrength value false');
        this.engine.sendCommand('setoption name Skill Level value 20');
        this.engine.sendCommand(`position fen ${fen}`);
        this.engine.sendCommand(`go movetime ${movetimeMs}`);
        await waitForLine(
          this.engine,
          (candidate) => candidate.startsWith('bestmove '),
          Math.max(10_000, movetimeMs * 20),
        );
      } finally {
        this.engine.__listeners.delete(scoreListener);
      }
      if (!latest) throw new Error('STOCKFISH_NO_EVALUATION');
      return latest;
    };

    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  close() {
    try {
      this.engine.sendCommand('quit');
    } catch {
      // Engine may already be terminated.
    }
  }
}
