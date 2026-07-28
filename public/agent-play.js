import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQUARE_PATTERN = /^[a-h][1-8]$/;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const TRACE_SOURCES = new Set(['agent_reported', 'provider_summary', 'adapter_generated']);
const SESSION_VERSION = 1;
const SESSION_ROOT = join(tmpdir(), 'agent-chess');
const SHORT_COMMANDS = new Set(['join', 'turn', 'move', 'status', 'result']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'aborted']);
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_JSON_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorCode(error) {
  return String(error?.message ?? error).split(':')[0];
}

function coded(code, phase, {
  recoverable = true,
  nextAction = 'run_status',
  cause = undefined,
} = {}) {
  const error = new Error(code, cause ? { cause } : undefined);
  Object.assign(error, { code, phase, recoverable, nextAction });
  return error;
}

function argValue(name, argv = process.argv) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function parseArgs(argv) {
  const joinUrl = argValue('--join-url', argv);
  if (!joinUrl) throw new Error('USAGE: --join-url URL');
  return { joinUrl };
}

function safeMatchId(value) {
  const matchId = String(value ?? '');
  if (!/^[A-Za-z0-9-]{1,128}$/.test(matchId)) {
    throw coded('SESSION_INVALID', 'load_session', { nextAction: 'request_reconnect_invitation' });
  }
  return matchId;
}

function sessionPaths(matchId) {
  const directory = join(SESSION_ROOT, safeMatchId(matchId));
  return {
    directory,
    sessionPath: join(directory, 'session.json'),
    clientPath: join(directory, 'agent-play.mjs'),
  };
}

function safeTurnId(value) {
  const turnId = String(value ?? '');
  if (!/^[A-Za-z0-9-]{1,160}$/.test(turnId)) {
    throw coded('BOARD_IMAGE_INVALID', 'persist_board_image', { nextAction: 'run_turn' });
  }
  return turnId;
}

function boardImagePath(directory, turnId) {
  return join(directory, `board-${safeTurnId(turnId)}.png`);
}

async function assertDirectory(path) {
  const details = await lstat(path);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw coded('SESSION_INVALID', 'write_session', { nextAction: 'request_reconnect_invitation' });
  }
}

async function assertRegularOrMissing(path) {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink() || !details.isFile()) {
      throw coded('SESSION_INVALID', 'write_session', { nextAction: 'request_reconnect_invitation' });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function atomicWrite(path, value, mode) {
  await assertRegularOrMissing(path);
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, value, { encoding: 'utf8', flag: 'wx', mode });
    await rename(temporary, path);
    await chmod(path, mode);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeSession(session, clientSource = null) {
  await mkdir(SESSION_ROOT, { recursive: true, mode: 0o700 });
  await assertDirectory(SESSION_ROOT);
  await chmod(SESSION_ROOT, 0o700);
  const paths = sessionPaths(session.matchId);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await assertDirectory(paths.directory);
  await chmod(paths.directory, 0o700);
  await atomicWrite(paths.sessionPath, `${JSON.stringify(session)}\n`, 0o600);
  if (clientSource !== null) await atomicWrite(paths.clientPath, clientSource, 0o600);
  return paths;
}

async function readSession(matchId) {
  const paths = sessionPaths(matchId);
  let details;
  let raw;
  try {
    details = await lstat(paths.sessionPath);
    if (details.isSymbolicLink() || !details.isFile() || (details.mode & 0o077) !== 0) {
      throw coded('SESSION_INVALID', 'load_session', { nextAction: 'request_reconnect_invitation' });
    }
    raw = await readFile(paths.sessionPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw coded('SESSION_NOT_FOUND', 'load_session', { nextAction: 'request_reconnect_invitation' });
    }
    throw error;
  }
  let session;
  try {
    session = JSON.parse(raw);
  } catch (error) {
    throw coded('SESSION_INVALID', 'load_session', {
      nextAction: 'request_reconnect_invitation',
      cause: error,
    });
  }
  if (
    session?.version !== SESSION_VERSION
    || session?.matchId !== matchId
    || typeof session?.serverUrl !== 'string'
    || !['white', 'black'].includes(session?.color)
    || typeof session?.sessionToken !== 'string'
    || !session.sessionToken
  ) {
    throw coded('SESSION_INVALID', 'load_session', { nextAction: 'request_reconnect_invitation' });
  }
  return { session, paths };
}

async function saveSession(session) {
  await writeSession(session);
}

function decodeBoardImage(boardImage) {
  if (
    boardImage?.type !== 'image'
    || boardImage?.mimeType !== 'image/png'
    || typeof boardImage?.alt !== 'string'
    || typeof boardImage?.dataUrl !== 'string'
    || !boardImage.dataUrl.startsWith(PNG_DATA_URL_PREFIX)
  ) {
    throw coded('BOARD_IMAGE_INVALID', 'persist_board_image', { nextAction: 'run_turn' });
  }
  const encoded = boardImage.dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw coded('BOARD_IMAGE_INVALID', 'persist_board_image', { nextAction: 'run_turn' });
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length <= PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw coded('BOARD_IMAGE_INVALID', 'persist_board_image', { nextAction: 'run_turn' });
  }
  return bytes;
}

async function persistBoardAttachment(turn, session, paths) {
  const boardImage = turn?.boardImage;
  const bytes = decodeBoardImage(boardImage);
  const imagePath = boardImagePath(paths.directory, turn.turnId);
  await atomicWrite(imagePath, bytes, 0o600);
  if (session.lastTurnId && session.lastTurnId !== turn.turnId) {
    await rm(boardImagePath(paths.directory, session.lastTurnId), { force: true });
  }
  return { ...boardImage, imagePath };
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function parseTrace(parsed) {
  const source = String(parsed.trace?.source ?? 'agent_reported').trim();
  if (!TRACE_SOURCES.has(source)) throw new Error('INVALID_TRACE_SOURCE');
  if (!parsed.trace?.summary) return null;
  if (parsed.trace.confidence !== undefined && (
    !Number.isFinite(parsed.trace.confidence)
    || parsed.trace.confidence < 0
    || parsed.trace.confidence > 1
  )) throw new Error('INVALID_TRACE_METRIC');
  if (parsed.trace.elapsedMs !== undefined && (
    !Number.isInteger(parsed.trace.elapsedMs)
    || parsed.trace.elapsedMs < 0
    || parsed.trace.elapsedMs > 300_000
  )) throw new Error('INVALID_TRACE_METRIC');
  return {
    source,
    kind: parsed.trace.kind === 'decision' ? 'decision' : 'status',
    phase: String(parsed.trace.phase ?? 'thinking').slice(0, 40),
    summary: String(parsed.trace.summary).slice(0, 1000),
    candidates: Array.isArray(parsed.trace.candidates)
      ? parsed.trace.candidates
        .filter((candidate) => UCI_PATTERN.test(String(candidate?.uci ?? '').trim()))
        .slice(0, 3)
        .map((candidate) => ({
          uci: String(candidate.uci).trim(),
          note: String(candidate?.note ?? '').trim().slice(0, 160),
        }))
      : [],
    selectedMove: UCI_PATTERN.test(String(parsed.trace.selectedMove ?? '').trim())
      ? String(parsed.trace.selectedMove).trim()
      : null,
    ...(parsed.trace.confidence !== undefined ? { confidence: parsed.trace.confidence } : {}),
    ...(parsed.trace.elapsedMs !== undefined ? { elapsedMs: parsed.trace.elapsedMs } : {}),
  };
}

function parseAction(line) {
  let parsed;
  try {
    parsed = JSON.parse(String(line).trim());
  } catch {
    parsed = { moveUci: String(line).trim() };
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_AGENT_ACTION');
  const trace = parseTrace(parsed);
  if (parsed.requestAllMoves === true && !('probeSquare' in parsed || 'moveUci' in parsed || 'move' in parsed || 'uci' in parsed)) {
    return { requestAllMoves: true, trace };
  }
  if (typeof parsed.probeSquare === 'string' && !('moveUci' in parsed || 'move' in parsed || 'uci' in parsed)) {
    if (!SQUARE_PATTERN.test(parsed.probeSquare)) throw new Error('INVALID_PROBE_SQUARE');
    return { probeSquare: parsed.probeSquare, trace };
  }
  const moveUci = parsed.moveUci ?? parsed.move ?? parsed.uci;
  if (typeof moveUci !== 'string' || !UCI_PATTERN.test(moveUci)) throw new Error('MOVE_NOT_LEGAL');
  return { moveUci, trace };
}

function cachedMoves(turn) {
  return [
    ...(turn?.legalMoves ?? []),
    ...(turn?.allMoves ?? []),
    ...Object.values(turn?.probeResults ?? {}).flatMap((result) => result.moves ?? []),
  ];
}

function invitationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INVALID_INVITATION_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('INVALID_INVITATION_URL');
  return url;
}

async function fetchBounded(url, options, phase) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_JSON_RESPONSE_BYTES) {
      throw coded('RESPONSE_TOO_LARGE', phase, { recoverable: false });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_JSON_RESPONSE_BYTES) {
        throw coded('RESPONSE_TOO_LARGE', phase, { recoverable: false });
      }
      chunks.push(bytes);
    }
    return { response, body: Buffer.concat(chunks).toString('utf8') };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveInvitation(joinUrl) {
  const parsedUrl = invitationUrl(joinUrl);
  let response;
  let responseBody;
  try {
    ({ response, body: responseBody } = await fetchBounded(parsedUrl, {}, 'read_invitation'));
  } catch (error) {
    if (error?.code === 'RESPONSE_TOO_LARGE') throw error;
    throw coded('SERVER_UNREACHABLE', 'read_invitation', { nextAction: 'retry_join', cause: error });
  }
  if (!response.ok) {
    if (response.status === 410) {
      throw coded('INVITATION_EXPIRED', 'read_invitation', { nextAction: 'request_reconnect_invitation' });
    }
    if (response.status === 409) {
      throw coded('INVITATION_ALREADY_CLAIMED', 'read_invitation', { nextAction: 'load_existing_session' });
    }
    throw coded(`INVITATION_REQUEST_FAILED_${response.status}`, 'read_invitation', {
      recoverable: false,
      nextAction: 'run_status',
    });
  }
  let contract;
  try {
    contract = JSON.parse(responseBody);
  } catch (error) {
    throw coded('INVALID_INVITATION_CONTRACT', 'read_invitation', {
      recoverable: false,
      nextAction: 'request_reconnect_invitation',
      cause: error,
    });
  }
  if (
    contract?.service?.name !== 'Agent Chess'
    || contract?.protocolVersion !== '2.0'
  ) {
    throw coded('INVALID_INVITATION_CONTRACT', 'read_invitation', {
      recoverable: false,
      nextAction: 'request_reconnect_invitation',
    });
  }
  return { contract, parsedUrl };
}

async function resolveSocket(joinUrl) {
  const { contract } = await resolveInvitation(joinUrl);
  let target;
  try {
    target = new URL(contract?.connection?.websocket?.url ?? contract?.connection?.wsUrl);
  } catch {
    throw new Error('INVALID_INVITATION_CONTRACT');
  }
  if (!['ws:', 'wss:'].includes(target.protocol)) throw new Error('INVALID_INVITATION_CONTRACT');
  return target.toString();
}

function httpFailure(status, value, phase) {
  const code = String(value?.error ?? value?.code ?? (
    status === 401 ? 'UNAUTHORIZED'
      : status === 404 ? 'MATCH_NOT_FOUND'
        : `HTTP_${status}`
  )).split(':')[0];
  const recovery = {
    INVITATION_EXPIRED: 'request_reconnect_invitation',
    INVITATION_ALREADY_CLAIMED: 'load_existing_session',
    UNAUTHORIZED: 'request_reconnect_invitation',
    STALE_TURN: 'run_turn',
    MOVE_NOT_LEGAL: 'reevaluate_legal_moves',
    CONFLICTING_REPLAY: 'run_status',
    MATCH_TERMINAL: 'run_result',
  };
  return coded(code, phase, {
    recoverable: !['MATCH_NOT_FOUND'].includes(code),
    nextAction: recovery[code] ?? 'run_status',
  });
}

async function requestJson(url, {
  token = null,
  method = 'GET',
  body = undefined,
  phase = 'request',
} = {}) {
  let response;
  let responseBody;
  try {
    ({ response, body: responseBody } = await fetchBounded(
      url,
      {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      phase,
    ));
  } catch (error) {
    if (error?.code === 'RESPONSE_TOO_LARGE') throw error;
    throw coded('SERVER_UNREACHABLE', phase, { nextAction: 'retry_status', cause: error });
  }
  let value = {};
  try {
    value = responseBody ? JSON.parse(responseBody) : {};
  } catch {}
  if (!response.ok) throw httpFailure(response.status, value, phase);
  return value;
}

function commandName(argv = process.argv) {
  return argv.find((value) => SHORT_COMMANDS.has(value)) ?? null;
}

function requireArg(name, phase) {
  const value = argValue(name);
  if (!value) throw coded('USAGE', phase, { recoverable: false, nextAction: 'read_prompt' });
  return value;
}

function terminalResult(result) {
  return TERMINAL_STATUSES.has(result?.status);
}

function diagnosticCode(result) {
  if (result?.failureCode === 'AGENT_FAILURE') return 'AGENT_DECISION_TIMEOUT';
  return result?.failureCode ?? null;
}

function publicFailure(error, context = {}) {
  const code = error?.code ?? errorCode(error);
  const recovery = {
    INVITATION_EXPIRED: 'request_reconnect_invitation',
    INVITATION_ALREADY_CLAIMED: 'load_existing_session',
    SESSION_NOT_FOUND: 'request_reconnect_invitation',
    SESSION_INVALID: 'request_reconnect_invitation',
    UNAUTHORIZED: 'request_reconnect_invitation',
    SERVER_UNREACHABLE: 'retry_status',
    STALE_TURN: 'run_turn',
    MOVE_NOT_LEGAL: 'reevaluate_legal_moves',
    CONFLICTING_REPLAY: 'run_status',
    MATCH_TERMINAL: 'run_result',
  };
  return {
    type: 'connector.error',
    code,
    phase: error?.phase ?? 'unknown',
    recoverable: error?.recoverable ?? true,
    matchId: context.matchId ?? null,
    turnId: context.turnId ?? null,
    nextAction: error?.nextAction ?? recovery[code] ?? 'run_status',
  };
}

async function runJoin() {
  const joinUrl = requireArg('--join-url', 'read_invitation');
  const { contract, parsedUrl } = await resolveInvitation(joinUrl);
  const ticket = parsedUrl.searchParams.get('ticket');
  let claimUrl = contract?.connection?.rest?.claimUrl;
  if (!claimUrl && ticket) {
    claimUrl = new URL(`/api/agent/claim?ticket=${encodeURIComponent(ticket)}`, parsedUrl).toString();
  }
  if (!claimUrl) {
    throw coded('INVALID_INVITATION_CONTRACT', 'claim_session', {
      recoverable: false,
      nextAction: 'request_reconnect_invitation',
    });
  }
  const clientSource = await readFile(fileURLToPath(import.meta.url), 'utf8');
  const claimed = await requestJson(claimUrl, { method: 'POST', phase: 'claim_session' });
  const matchId = safeMatchId(claimed?.matchId);
  if (!['white', 'black'].includes(claimed?.color) || typeof claimed?.sessionToken !== 'string') {
    throw coded('INVALID_INVITATION_CONTRACT', 'claim_session', {
      recoverable: false,
      nextAction: 'request_reconnect_invitation',
    });
  }
  const session = {
    version: SESSION_VERSION,
    serverUrl: parsedUrl.origin,
    matchId,
    color: claimed.color,
    sessionToken: claimed.sessionToken,
    lastSuccessfulStep: 'session_claimed',
    lastTurnId: null,
  };
  const paths = await writeSession(session, clientSource);
  emit({
    type: 'session.ready',
    matchId,
    seat: claimed.color,
    sessionPath: paths.sessionPath,
    clientPath: paths.clientPath,
    nextCommand: `${shellArg(process.execPath)} ${shellArg(paths.clientPath)} turn --match ${shellArg(matchId)}`,
  });
}

async function runTurn() {
  const matchId = safeMatchId(requireArg('--match', 'load_session'));
  const { session, paths } = await readSession(matchId);
  const requestedWait = argValue('--wait-ms');
  const waitMs = requestedWait === null ? 0 : Number(requestedWait);
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 25_000) {
    throw coded('INVALID_WAIT_MS', 'fetch_turn', { recoverable: false, nextAction: 'run_turn' });
  }
  const turnResponse = await requestJson(
    `${session.serverUrl}/api/agent/turn?waitMs=${waitMs}`,
    { token: session.sessionToken, phase: 'fetch_turn' },
  );
  if (!turnResponse.turn) {
    const result = await requestJson(`${session.serverUrl}/api/agent/result`, {
      token: session.sessionToken,
      phase: 'read_result',
    });
    if (terminalResult(result)) {
      emit({ type: 'game.end', matchId, ...result });
      return;
    }
    emit({ type: 'turn.wait', matchId, timeout: true, nextAction: 'retry_turn' });
    return;
  }
  const legal = await requestJson(
    `${session.serverUrl}/api/agent/legal-moves?turnId=${encodeURIComponent(turnResponse.turn.turnId)}`,
    { token: session.sessionToken, phase: 'list_legal_moves' },
  );
  const attachment = await persistBoardAttachment(turnResponse.turn, session, paths);
  const turn = { ...turnResponse.turn };
  delete turn.boardImage;
  await saveSession({
    ...session,
    lastSuccessfulStep: 'legal_moves_received',
    lastTurnId: turnResponse.turn.turnId,
  });
  emit({
    type: 'turn.ready',
    matchId,
    seat: session.color,
    turn,
    legalMoves: legal.moves ?? [],
    attachments: [attachment],
  });
}

async function runMove() {
  const matchId = safeMatchId(requireArg('--match', 'load_session'));
  const { session } = await readSession(matchId);
  const raw = requireArg('--json', 'parse_move');
  let body;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    throw coded('INVALID_MOVE_JSON', 'parse_move', {
      recoverable: true,
      nextAction: 'reevaluate_legal_moves',
      cause: error,
    });
  }
  if (
    typeof body?.turnId !== 'string'
    || typeof body?.moveUci !== 'string'
    || !UCI_PATTERN.test(body.moveUci)
  ) {
    throw coded('INVALID_MOVE_JSON', 'parse_move', {
      recoverable: true,
      nextAction: 'reevaluate_legal_moves',
    });
  }
  const result = await requestJson(`${session.serverUrl}/api/agent/move`, {
    token: session.sessionToken,
    method: 'POST',
    body,
    phase: 'submit_move',
  });
  await saveSession({
    ...session,
    lastSuccessfulStep: 'move_accepted',
    lastTurnId: body.turnId,
  });
  emit({ type: 'move.accepted', matchId, ...result });
}

async function runStatus() {
  const matchId = safeMatchId(requireArg('--match', 'load_session'));
  const { session } = await readSession(matchId);
  const [result, snapshot] = await Promise.all([
    requestJson(`${session.serverUrl}/api/agent/result`, {
      token: session.sessionToken,
      phase: 'authenticate_session',
    }),
    requestJson(`${session.serverUrl}/api/matches/${encodeURIComponent(matchId)}`, {
      phase: 'read_match',
    }),
  ]);
  const activeAgentTurn = (
    snapshot.status === 'active'
    && snapshot.activeTurn?.seatKind === 'agent'
    && snapshot.activeTurn?.activeColor === session.color
  );
  const sameReadyTurn = activeAgentTurn
    && session.lastSuccessfulStep === 'legal_moves_received'
    && session.lastTurnId === snapshot.activeTurn.turnId;
  emit({
    type: 'session.status',
    matchId,
    seat: session.color,
    session: 'valid',
    match: snapshot.status,
    turnId: snapshot.activeTurn?.turnId ?? null,
    waitingOn: snapshot.status !== 'active' ? 'none' : activeAgentTurn ? 'agent' : 'server',
    deadline: snapshot.activeTurn?.deadline ?? null,
    lastSuccessfulStep: session.lastSuccessfulStep,
    nextAction: terminalResult(result)
      ? 'read_result'
      : sameReadyTurn ? 'submit_move'
        : activeAgentTurn ? 'fetch_turn'
          : 'retry_turn',
    error: diagnosticCode(result),
  });
}

async function runResult() {
  const matchId = safeMatchId(requireArg('--match', 'load_session'));
  const { session, paths } = await readSession(matchId);
  const result = await requestJson(`${session.serverUrl}/api/agent/result`, {
    token: session.sessionToken,
    phase: 'read_result',
  });
  emit({
    type: terminalResult(result) ? 'game.end' : 'match.result',
    matchId,
    ...result,
    diagnosticCode: diagnosticCode(result),
    nextAction: terminalResult(result) ? 'complete' : 'run_turn',
  });
  if (terminalResult(result)) await rm(paths.directory, { recursive: true, force: true });
}

async function runWebSocket() {
  const { joinUrl } = parseArgs(process.argv);
  const socket = new WebSocket(await resolveSocket(joinUrl));
  let activeTurn = null;
  let terminal = false;
  let inputBuffer = '';

  function retry(error) {
    emit({
      type: 'connector.error',
      code: errorCode(error),
      recoverable: true,
      turnId: activeTurn?.turnId ?? null,
    });
  }

  function send(message) {
    socket.send(JSON.stringify(message));
  }

  function publish(trace) {
    if (trace?.summary && activeTurn?.mode !== 'private_eval') {
      send({
        type: 'trace.publish',
        turnId: activeTurn.turnId,
        source: trace.source,
        kind: 'status',
        phase: trace.phase,
        summary: trace.summary,
      });
    }
  }

  function submit(action) {
    if (!activeTurn) throw new Error('NO_ACTIVE_TURN');
    if (action.probeSquare) {
      if (activeTurn.probeResults[action.probeSquare]) throw new Error('REPEATED_PROBE');
      publish(action.trace);
      send({ type: 'moves.list', turnId: activeTurn.turnId, square: action.probeSquare });
      return;
    }
    if (action.requestAllMoves) {
      if (activeTurn.allMoves) throw new Error('REPEATED_FULL_MOVE_LIST');
      publish(action.trace);
      send({ type: 'moves.list_all', turnId: activeTurn.turnId });
      return;
    }
    if (!cachedMoves(activeTurn).some((move) => move.uci === action.moveUci)) {
      throw new Error('MOVE_NOT_LEGAL');
    }
    send({
      type: 'move.submit',
      turnId: activeTurn.turnId,
      moveUci: action.moveUci,
      ...(action.trace && activeTurn.mode !== 'private_eval'
        ? { publicTrace: { ...action.trace, selectedMove: action.moveUci } }
        : {}),
    });
  }

  function acceptInput(line) {
    if (!line.trim()) return;
    try {
      submit(parseAction(line));
    } catch (error) {
      retry(error);
    }
  }

  function onInput(chunk) {
    inputBuffer += chunk;
    const lines = inputBuffer.split(/\r?\n/);
    inputBuffer = lines.pop() ?? '';
    lines.forEach(acceptInput);
  }

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onInput);
  socket.addEventListener('open', () => emit({ type: 'connector.status', state: 'online' }));
  socket.addEventListener('error', () => {
    emit({ type: 'connector.error', code: 'CONNECT_FAILED', recoverable: false, turnId: activeTurn?.turnId ?? null });
    process.exitCode = 1;
  });
  socket.addEventListener('close', (event) => {
    process.stdin.off('data', onInput);
    process.stdin.pause();
    emit({ type: 'connector.status', state: terminal ? 'complete' : 'offline', code: event.code });
    if (!terminal && event.code !== 1000) process.exitCode = 1;
  });
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      retry('INVALID_SERVER_MESSAGE');
      return;
    }
    if (message.type === 'turn.start') {
      activeTurn = { ...message, probeResults: {} };
      emit(message);
      send({ type: 'moves.list_all', turnId: message.turnId });
      return;
    }
    if (message.type === 'moves.list.result' && activeTurn?.turnId === message.turnId) {
      activeTurn.probeResults[message.square] = { square: message.square, moves: message.moves };
      emit(message);
      return;
    }
    if (message.type === 'moves.list_all.result' && activeTurn?.turnId === message.turnId) {
      activeTurn.allMoves = message.moves;
      emit(message);
      return;
    }
    if (message.type === 'move.accepted') activeTurn = null;
    if (message.type === 'move.rejected') {
      emit({ ...message, recoverable: true });
      return;
    }
    if (message.type === 'error' && message.recoverable !== false) {
      emit(message);
      return;
    }
    if (message.type === 'game.end') {
      terminal = true;
      emit(message);
      if (message.status === 'failed') process.exitCode = 1;
      socket.close(
        1000,
        message.status === 'failed' ? 'match failed' : 'game complete',
      );
      return;
    }
    emit(message);
  });
}

const command = commandName();
const context = {
  matchId: argValue('--match'),
  turnId: null,
};

const selectedRun = command === 'join' ? runJoin
  : command === 'turn' ? runTurn
    : command === 'move' ? runMove
      : command === 'status' ? runStatus
        : command === 'result' ? runResult
          : runWebSocket;

selectedRun().catch((error) => {
  if (command) {
    emit(publicFailure(error, context));
  } else {
    emit({ type: 'connector.error', code: errorCode(error), recoverable: false, turnId: null });
  }
  process.exitCode = command && error?.recoverable ? 1 : 2;
});
