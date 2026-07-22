import { randomUUID } from 'node:crypto';
import { AgentChessGame } from './game.js';
import { normalizeMatchConfig, publicSeat } from './seats.js';

const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const FAILURE_CODES = new Set(['AGENT_FAILURE', 'ENGINE_FAILURE', 'MATCH_FAILURE', 'SYSTEM_FAILURE']);

export class MatchSession {
  constructor(input = {}) {
    const { id = randomUUID() } = input;
    const config = normalizeMatchConfig(input);

    this.id = id;
    this.mode = config.mode;
    this.visibility = config.visibility;
    this.seats = structuredClone(config.seats);
    this.clock = structuredClone(config.clock);
    this.engine = structuredClone(config.engine);
    this.compatibility = structuredClone(config.compatibility);
    this.steeringMode = config.steeringMode;
    this.agentColor = this.compatibility?.legacyAgentColor ?? null;
    this.game = new AgentChessGame({
      white: this.seats.white.name,
      black: this.seats.black.name,
    });
    this.status = 'waiting';
    this.termination = null;
    this.resultOverride = null;
    this.pendingGuidance = null;
    this.currentTurnId = null;
    this.currentTurnPayload = null;
    this.closedTurnIds = new Set();
    this.trace = [];
    this.activity = [];
    this.createdAt = new Date().toISOString();
  }

  isAgentTurn() {
    return !this.isTerminal() && this.activeSeat().kind === 'agent';
  }

  activeSeat() {
    const color = this.game.snapshot().turn;
    return { ...this.seats[color], color };
  }

  activeTurn() {
    return this.currentTurnPayload;
  }

  isTerminal() {
    return ['completed', 'aborted', 'failed'].includes(this.status) || this.game.snapshot().gameOver;
  }

  start() {
    if (this.status === 'waiting') this.status = 'active';
    return this.status;
  }

  publishTrace({ turnId, kind = 'status', phase = 'thinking', summary, candidates, selectedMove = null } = {}) {
    this._assertActiveTurn(turnId);
    this._assertTraceMoves({ candidates, selectedMove });
    const clean = String(summary ?? '').trim();
    if (!clean) throw new Error('EMPTY_TRACE');
    const entry = this._recordActivity({
      type: 'agent.trace',
      source: kind === 'decision' ? 'agent' : 'connector',
      kind: kind === 'decision' ? 'decision' : 'status',
      phase,
      turnId,
      summary: clean,
      candidates,
      selectedMove,
    });
    this.trace.push(entry);
    return entry;
  }

  queueSteering(guidance) {
    if (this.steeringMode !== 'trainer') {
      throw new Error('STEERING_LOCKED');
    }
    const clean = String(guidance ?? '').trim();
    if (!clean) throw new Error('EMPTY_GUIDANCE');
    this.pendingGuidance = clean.slice(0, 500);
    this.trace.push({ type: 'steering.queued', at: new Date().toISOString(), message: this.pendingGuidance });
  }

  createTurnPayload() {
    if (this.isTerminal()) throw new Error('GAME_OVER');
    this.start();
    if (this.currentTurnPayload) return this.currentTurnPayload;
    this.currentTurnId = randomUUID();

    const guidance = this.pendingGuidance;
    this.pendingGuidance = null;

    const seat = this.activeSeat();
    const turn = this.currentTurnPayload = this.game.buildTurnSnapshot({
      gameId: this.id,
      turnId: this.currentTurnId,
      agentColor: seat.color,
      steering: { mode: this.steeringMode, guidance },
      deadline: null,
    });
    turn.activeColor = seat.color;
    turn.seatKind = seat.kind;
    turn.mode = this.mode;
    this._recordActivity({
      type: 'turn.start',
      source: 'system',
      phase: 'observe',
      turnId: turn.turnId,
      summary: 'Position ready',
    });
    return turn;
  }

  recordSystemError(message) {
    return this._recordActivity({
      type: 'error', source: 'system', summary: String(message ?? 'Match paused'),
    });
  }

  submitAgentMove({ turnId, moveUci }) {
    const seat = this.activeSeat();
    if (turnId !== this.currentTurnId || this.closedTurnIds.has(turnId)) {
      return this.submitSeatMove({ color: this.agentColor ?? seat.color, turnId, moveUci });
    }
    if (seat.kind !== 'agent') throw new Error('NOT_AGENT_TURN');
    return this.submitSeatMove({ color: seat.color, turnId, moveUci });
  }

  submitOpponentMove(moveUci) {
    const seat = this.activeSeat();
    if (seat.kind === 'agent') throw new Error('NOT_OPPONENT_TURN');
    const pendingGuidance = this.pendingGuidance;
    const turn = this.createTurnPayload();
    const applied = this.submitSeatMove({ color: seat.color, turnId: turn.turnId, moveUci });
    this.pendingGuidance = pendingGuidance;
    return applied;
  }

  submitSeatMove({ color, turnId, moveUci, publicTrace } = {}) {
    this._assertActiveTurn(turnId);
    const seat = this.activeSeat();
    if (color !== seat.color) throw new Error('SEAT_NOT_ACTIVE');
    if (seat.traceRequirement === 'structured_required' && !publicTrace) {
      throw new Error('TRACE_REQUIRED');
    }
    if (publicTrace) this.publishTrace({ turnId, ...publicTrace });

    const applied = this.game.applyMove(moveUci);
    this.closedTurnIds.add(turnId);
    this.currentTurnId = null;
    this.currentTurnPayload = null;
    this.trace.push({ type: `${seat.kind}.move`, at: new Date().toISOString(), ...applied });
    this._recordActivity({
      type: 'move.submit', source: 'system', phase: 'submit', turnId,
      summary: `Submitted ${applied.uci}`, selectedMove: applied.uci,
    });
    this._completeGameIfOver();
    return applied;
  }

  resign(color) {
    if (this.isTerminal()) return this._completion();
    if (!['white', 'black'].includes(color)) throw new Error('INVALID_COLOR');
    this.resultOverride = color === 'white' ? '0-1' : '1-0';
    this.status = 'completed';
    this.termination = 'resignation';
    this._closeActiveTurn();
    this._recordActivity({ type: 'match.resign', source: 'system', phase: 'complete', summary: `${color} resigned` });
    return this._completion();
  }

  abort(color) {
    if (this.isTerminal()) return this._completion();
    if (!['white', 'black'].includes(color)) throw new Error('INVALID_COLOR');
    if (this.game.snapshot().ply > 0) throw new Error('ABORT_NOT_ALLOWED');
    this.status = 'aborted';
    this.termination = 'aborted';
    this._closeActiveTurn();
    this._recordActivity({ type: 'match.abort', source: 'system', phase: 'complete', summary: `${color} aborted` });
    return this._completion();
  }

  fail(code, message) {
    if (this.isTerminal()) return this._completion();
    const failureCode = FAILURE_CODES.has(code) ? code : 'MATCH_FAILURE';
    this.status = 'failed';
    this.termination = 'failure';
    this._closeActiveTurn();
    this._recordActivity({
      type: 'match.fail', source: 'system', phase: 'failed', code: failureCode, summary: 'Match failed',
    });
    return this._completion();
  }

  listMovesForPiece({ turnId, square }) {
    this._assertActiveTurn(turnId);
    if (!this.game.getMovablePieces().some((piece) => piece.square === square)) {
      throw new Error('PIECE_NOT_MOVABLE');
    }
    const moves = this.game.getMovesForSquare(square);
    this._recordActivity({
      type: 'moves.list',
      source: 'system',
      phase: 'probe',
      turnId,
      summary: `Listed ${moves.length} moves for ${square}`,
    });
    return { turnId, square, moves };
  }

  listAllMoves({ turnId }) {
    this._assertActiveTurn(turnId);
    const moves = this.game.legalMoves();
    this._recordActivity({
      type: 'moves.list_all',
      source: 'system',
      phase: 'probe',
      turnId,
      summary: `Listed ${moves.length} legal moves`,
    });
    return { turnId, moves };
  }

  listHistory({ turnId, beforePly, limit = 12 }) {
    this._assertActiveTurn(turnId);
    const ply = this.game.snapshot().ply;
    const cursor = beforePly ?? ply + 1;
    if (!Number.isInteger(cursor) || cursor < 1) throw new Error('INVALID_HISTORY_CURSOR');
    if (!Number.isInteger(limit) || limit < 0) throw new Error('INVALID_HISTORY_LIMIT');
    const moves = limit === 0 ? [] : this.game
      .getRecentMoves(ply)
      .filter((move) => move.ply < cursor)
      .slice(-limit);
    this._recordActivity({
      type: 'history.list',
      source: 'system',
      phase: 'probe',
      turnId,
      summary: `Listed ${moves.length} history moves`,
    });
    return { turnId, moves };
  }

  validateCandidate({ turnId, moveUci }) {
    this._assertActiveTurn(turnId);
    const result = this.game.validateCandidate(moveUci);
    this._recordActivity({
      type: 'move.validate',
      source: 'system',
      phase: 'choose',
      turnId,
      summary: result.legal ? `Validated ${moveUci}` : `Rejected ${moveUci}`,
      selectedMove: result.legal ? moveUci : null,
    });
    return result;
  }

  snapshot() {
    const game = { ...this.game.snapshot(), result: this.resultOverride ?? this.game.result() };
    const snapshot = {
      id: this.id,
      mode: this.mode,
      visibility: this.visibility,
      seats: Object.fromEntries(Object.entries(this.seats).map(([color, seat]) => [color, publicSeat(seat)])),
      clock: structuredClone(this.clock),
      status: this.status,
      termination: this.termination,
      steeringMode: this.steeringMode,
      createdAt: this.createdAt,
      trace: [...this.trace],
      activity: this.activity.map((entry) => ({
        ...entry,
        candidates: entry.candidates.map((candidate) => ({ ...candidate })),
      })),
      game,
      pgn: this.game.pgn(),
    };
    if (this.compatibility) snapshot.agentColor = this.agentColor;
    return snapshot;
  }

  exportRecord() {
    return {
      id: this.id,
      config: {
        mode: this.mode, visibility: this.visibility,
        seats: Object.fromEntries(Object.entries(this.seats).map(([color, seat]) => [color, publicSeat(seat)])),
        clock: structuredClone(this.clock), steeringMode: this.steeringMode,
        engine: structuredClone(this.engine), compatibility: structuredClone(this.compatibility),
      },
      status: this.status,
      termination: this.termination,
      result: this.resultOverride ?? this.game.result(),
      pgn: this.game.pgn(),
      activity: this.snapshot().activity,
      positions: this.game.snapshot().positions,
    };
  }

  _assertActiveTurn(turnId) {
    if (!turnId || turnId !== this.currentTurnId || this.closedTurnIds.has(turnId)) {
      throw new Error('STALE_TURN');
    }
    if (this.isTerminal()) throw new Error('GAME_OVER');
  }

  _closeActiveTurn() {
    if (this.currentTurnId) this.closedTurnIds.add(this.currentTurnId);
    this.currentTurnId = null;
    this.currentTurnPayload = null;
  }

  _completeGameIfOver() {
    const game = this.game.snapshot();
    if (!game.gameOver) return;
    this.status = 'completed';
    this.termination = game.checkmate ? 'checkmate' : game.draw ? 'draw' : 'game_over';
  }

  _completion() {
    return {
      status: this.status,
      termination: this.termination,
      result: this.resultOverride ?? this.game.result(),
    };
  }

  _assertTraceMoves({ candidates, selectedMove }) {
    if (Array.isArray(candidates) && candidates.some((candidate) => (
      typeof candidate?.uci !== 'string' || !UCI_PATTERN.test(candidate.uci)
    ))) {
      throw new Error('INVALID_MOVE_FORMAT');
    }
    if (typeof selectedMove === 'string' && !UCI_PATTERN.test(selectedMove)) {
      throw new Error('INVALID_MOVE_FORMAT');
    }
  }

  _recordActivity({ type, source, kind = null, phase, turnId = null, summary = '', candidates, selectedMove = null, code = null }) {
    const entry = {
      type,
      source,
      kind,
      phase: String(phase ?? '').slice(0, 40),
      at: new Date().toISOString(),
      turnId,
      summary: String(summary ?? '').trim().slice(0, 500),
      candidates: Array.isArray(candidates)
        ? candidates.slice(0, 3).map((candidate) => ({
          uci: String(candidate?.uci ?? '').trim(),
          note: String(candidate?.note ?? '').trim().slice(0, 160),
        }))
        : [],
      selectedMove: selectedMove ? String(selectedMove).trim() : null,
      ...(code ? { code } : {}),
    };
    this.activity.push(entry);
    return entry;
  }
}
