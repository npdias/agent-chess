import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

function json(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}

function failure(error) {
  const code = String(error?.message ?? 'TOOL_FAILED').split(':')[0];
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code }) }], structuredContent: { error: code } };
}

function tool(callback) {
  return async (args) => {
    try {
      return json(await callback(args));
    } catch (error) {
      return failure(error);
    }
  };
}

const turnId = z.string().min(1);
const trace = {
  source: z.enum(['agent_reported', 'provider_summary', 'adapter_generated']).optional(),
  phase: z.string().max(40).optional(),
  summary: z.string().min(1).max(500),
  candidates: z.array(z.object({ uci: z.string(), note: z.string().max(160).optional() })).max(3).optional(),
  selectedMove: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  elapsedMs: z.number().int().min(0).max(300_000).optional(),
};
const statusTrace = {
  source: z.enum(['agent_reported', 'provider_summary', 'adapter_generated']).optional(),
  phase: z.string().max(40).optional(),
  summary: z.string().min(1).max(500),
};

export function createAgentChessMcpServer({ access, sessionToken, onStatusPublished = undefined, onMoveSubmitted = undefined }) {
  const server = new McpServer({ name: 'Agent Chess', version: '0.1.0' });

  server.registerTool('join_match', { description: 'Join assigned match and read current agent turn.', inputSchema: {} }, tool(() => access.joinMatch(sessionToken)));
  server.registerTool('await_turn', { description: 'Wait up to 25 seconds for assigned turn.', inputSchema: {
    after: z.string().nullable().optional(), waitMs: z.number().int().min(0).max(25_000).optional(),
  } }, tool((args) => access.awaitTurn(sessionToken, args)));
  server.registerTool('list_legal_moves', { description: 'List legal moves for current assigned turn.', inputSchema: { turnId } }, tool((args) => access.listLegalMoves(sessionToken, args)));
  server.registerTool('publish_status', { description: 'Publish bounded public status; never raw reasoning.', inputSchema: { turnId, ...statusTrace } }, tool(async (args) => {
    const result = access.publishStatus(sessionToken, args);
    await onStatusPublished?.(result);
    return result;
  }));
  server.registerTool('publish_decision', { description: 'Publish bounded public decision; never raw reasoning.', inputSchema: { turnId, ...trace } }, tool((args) => access.publishDecision(sessionToken, args)));
  server.registerTool('submit_move', { description: 'Submit a legal UCI move for current assigned turn.', inputSchema: {
    turnId, moveUci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/), publicTrace: z.object(trace).optional(),
  } }, tool(async (args) => {
    const result = access.submitMove(sessionToken, args);
    if (!result.replayed) await onMoveSubmitted?.(result);
    return result;
  }));
  server.registerTool('get_result', { description: 'Read match result and PGN.', inputSchema: {} }, tool(() => access.getResult(sessionToken)));

  return server;
}
