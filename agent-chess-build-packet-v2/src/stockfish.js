import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const initStockfish = require('stockfish');

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

export class StockfishEngine {
  constructor(engine, { movetimeMs = 100, skillLevel = 5 } = {}) {
    this.engine = engine;
    this.movetimeMs = movetimeMs;
    this.skillLevel = skillLevel;
    this.queue = Promise.resolve();
  }

  static async start(options = {}) {
    const engine = await initStockfish('lite-single');
    engine.__listeners = new Set();
    engine.listener = (line) => {
      for (const listener of engine.__listeners) listener(line);
    };

    engine.sendCommand('uci');
    await waitForLine(engine, (line) => line === 'uciok');
    engine.sendCommand(`setoption name Skill Level value ${options.skillLevel ?? 5}`);
    engine.sendCommand('isready');
    await waitForLine(engine, (line) => line === 'readyok');

    return new StockfishEngine(engine, options);
  }

  async bestMove(fen, { movetimeMs = this.movetimeMs, skillLevel = this.skillLevel } = {}) {
    const operation = async () => {
      this.engine.sendCommand(`setoption name Skill Level value ${Math.max(0, Math.min(20, Number(skillLevel)))}`);
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

  close() {
    try {
      this.engine.sendCommand('quit');
    } catch {
      // Engine may already be terminated.
    }
  }
}
