import { randomUUID } from 'node:crypto';
import { AgentChessGame } from './game.js';

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
    this.createdAt = new Date().toISOString();
  }

  isAgentTurn() {
    return !this.game.snapshot().gameOver && this.game.snapshot().turn === this.agentColor;
  }

  publishTrace({ phase = 'thinking', summary } = {}) {
    const clean = String(summary ?? '').trim();
    if (!clean) throw new Error('EMPTY_TRACE');
    const entry = {
      type: 'agent.trace',
      at: new Date().toISOString(),
      phase: String(phase ?? 'thinking').slice(0, 40),
      summary: clean.slice(0, 1000),
    };
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

  createTurnPayload({ deadlineMs = 30_000 } = {}) {
    if (!this.isAgentTurn()) throw new Error('NOT_AGENT_TURN');
    if (!this.currentTurnId) this.currentTurnId = randomUUID();

    const state = this.game.snapshot();
    const guidance = this.pendingGuidance;
    this.pendingGuidance = null;

    return {
      protocolVersion: '1.0',
      type: 'turn.start',
      gameId: this.id,
      turnId: this.currentTurnId,
      color: this.agentColor,
      initialFen: state.initialFen,
      fen: state.fen,
      movesUci: state.movesUci,
      movesSan: state.movesSan,
      legalMoves: state.legalMoves,
      deadlineMs,
      steering: { mode: this.steeringMode, guidance },
    };
  }

  submitAgentMove({ turnId, moveUci }) {
    if (!turnId || turnId !== this.currentTurnId || this.closedTurnIds.has(turnId)) {
      throw new Error('STALE_TURN');
    }
    if (!this.isAgentTurn()) throw new Error('NOT_AGENT_TURN');

    const applied = this.game.applyMove(moveUci);
    this.closedTurnIds.add(turnId);
    this.currentTurnId = null;
    this.trace.push({ type: 'agent.move', at: new Date().toISOString(), ...applied });
    return applied;
  }

  submitOpponentMove(moveUci) {
    if (this.game.snapshot().gameOver) throw new Error('GAME_OVER');
    if (this.game.snapshot().turn === this.agentColor) throw new Error('NOT_OPPONENT_TURN');
    const applied = this.game.applyMove(moveUci);
    this.trace.push({ type: 'opponent.move', at: new Date().toISOString(), ...applied });
    return applied;
  }

  snapshot() {
    return {
      id: this.id,
      steeringMode: this.steeringMode,
      agentColor: this.agentColor,
      createdAt: this.createdAt,
      trace: [...this.trace],
      game: this.game.snapshot(),
      pgn: this.game.pgn(),
    };
  }
}
