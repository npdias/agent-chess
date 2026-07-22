import { randomUUID } from 'node:crypto';
import { AgentChessGame } from './game.js';

const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export class MatchSession {
  constructor({
    id = randomUUID(),
    steeringMode = 'locked',
    agentColor = 'white',
    agentName = 'Agent',
    opponentName = 'Stockfish',
  } = {}) {
    if (!['locked', 'trainer'].includes(steeringMode)) {
      throw new Error(`INVALID_STEERING_MODE: ${steeringMode}`);
    }
    if (!['white', 'black'].includes(agentColor)) {
      throw new Error(`INVALID_AGENT_COLOR: ${agentColor}`);
    }

    this.id = id;
    this.steeringMode = steeringMode;
    this.agentColor = agentColor;
    this.game = new AgentChessGame({
      white: agentColor === 'white' ? agentName : opponentName,
      black: agentColor === 'black' ? agentName : opponentName,
    });
    this.pendingGuidance = null;
    this.currentTurnId = null;
    this.closedTurnIds = new Set();
    this.trace = [];
    this.activity = [];
    this.createdAt = new Date().toISOString();
  }

  isAgentTurn() {
    return !this.game.snapshot().gameOver && this.game.snapshot().turn === this.agentColor;
  }

  publishTrace({ turnId, kind = 'status', phase = 'thinking', summary, candidates, selectedMove = null } = {}) {
    this._assertActiveTurn(turnId);
    this._assertTraceMoves({ candidates, selectedMove });
    const clean = String(summary ?? '').trim();
    if (!clean) throw new Error('EMPTY_TRACE');
    const entry = this._recordActivity({
      type: 'agent.trace',
      source: 'agent',
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
    if (!this.isAgentTurn()) throw new Error('NOT_AGENT_TURN');
    const isNewTurn = !this.currentTurnId;
    if (isNewTurn) this.currentTurnId = randomUUID();

    const guidance = this.pendingGuidance;
    this.pendingGuidance = null;

    const turn = this.game.buildTurnSnapshot({
      gameId: this.id,
      turnId: this.currentTurnId,
      agentColor: this.agentColor,
      steering: { mode: this.steeringMode, guidance },
      deadline: null,
    });
    if (isNewTurn) {
      this._recordActivity({
        type: 'turn.start',
        source: 'system',
        phase: 'observe',
        turnId: turn.turnId,
        summary: 'Position ready',
      });
    }
    return turn;
  }

  submitAgentMove({ turnId, moveUci }) {
    this._assertActiveTurn(turnId);

    const applied = this.game.applyMove(moveUci);
    this.closedTurnIds.add(turnId);
    this.currentTurnId = null;
    this.trace.push({ type: 'agent.move', at: new Date().toISOString(), ...applied });
    this._recordActivity({
      type: 'move.submit',
      source: 'system',
      phase: 'submit',
      turnId,
      summary: `Submitted ${applied.uci}`,
      selectedMove: applied.uci,
    });
    return applied;
  }

  submitOpponentMove(moveUci) {
    if (this.game.snapshot().gameOver) throw new Error('GAME_OVER');
    if (this.game.snapshot().turn === this.agentColor) throw new Error('NOT_OPPONENT_TURN');
    const applied = this.game.applyMove(moveUci);
    this.trace.push({ type: 'opponent.move', at: new Date().toISOString(), ...applied });
    this._recordActivity({
      type: 'opponent.move',
      source: 'system',
      phase: 'observe',
      summary: `Opponent played ${applied.uci}`,
      selectedMove: applied.uci,
    });
    return applied;
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
    const moves = this.game
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
    return {
      id: this.id,
      steeringMode: this.steeringMode,
      agentColor: this.agentColor,
      createdAt: this.createdAt,
      trace: [...this.trace],
      activity: this.activity.map((entry) => ({
        ...entry,
        candidates: entry.candidates.map((candidate) => ({ ...candidate })),
      })),
      game: this.game.snapshot(),
      pgn: this.game.pgn(),
    };
  }

  _assertActiveTurn(turnId) {
    if (!turnId || turnId !== this.currentTurnId || this.closedTurnIds.has(turnId)) {
      throw new Error('STALE_TURN');
    }
    if (!this.isAgentTurn()) throw new Error('NOT_AGENT_TURN');
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

  _recordActivity({ type, source, kind = null, phase, turnId = null, summary = '', candidates, selectedMove = null }) {
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
    };
    this.activity.push(entry);
    return entry;
  }
}
