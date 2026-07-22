const KINDS = new Set(['human', 'agent', 'engine']);

function cleanSeat(seat, fallbackName) {
  if (!seat || !KINDS.has(seat.kind)) throw new Error('INVALID_SEAT');
  return {
    kind: seat.kind,
    name: String(seat.name ?? fallbackName).trim().slice(0, 80),
    traceRequirement: seat.kind === 'agent'
      ? (seat.traceRequirement === 'structured_required' ? 'structured_required' : 'optional')
      : null,
  };
}

function shorthandSeats(body, random) {
  const requested = body.color ?? 'random';
  const resolved = requested === 'random'
    ? (random() < 0.5 ? 'white' : 'black')
    : requested;

  if (!['white', 'black'].includes(resolved)) throw new Error('INVALID_COLOR');

  return {
    seats: {
      [resolved]: cleanSeat({ kind: 'human', ...body.human }, 'Human'),
      [resolved === 'white' ? 'black' : 'white']: cleanSeat(body.opponent, 'Opponent'),
    },
    colorSelection: { requested, resolved },
  };
}

export function validateSeatCombination(config) {
  const seatList = Object.values(config.seats ?? {});
  const kinds = seatList.map((seat) => seat.kind);
  const humanCount = kinds.filter((kind) => kind === 'human').length;

  if (config.mode === 'private_eval' && config.visibility !== 'private') {
    throw new Error('PRIVATE_EVAL_REQUIRES_PRIVATE_VISIBILITY');
  }

  if (config.visibility === 'public' && !config.compatibility) {
    for (const seat of seatList) {
      if (seat.kind === 'agent') seat.traceRequirement = 'structured_required';
    }
  }

  if (config.mode !== 'exhibition' || config.visibility !== 'public') return config;

  if (humanCount > 0 && humanCount !== 1) throw new Error('UNSUPPORTED_SEAT_COMBINATION');

  const supported = [
    ['agent', 'engine'],
    ['engine', 'human'],
    ['agent', 'human'],
  ].some((pair) => pair.every((kind) => kinds.includes(kind)) && pair.length === kinds.length);
  if (!supported) throw new Error('UNSUPPORTED_SEAT_COMBINATION');

  return config;
}

export function normalizeMatchConfig(body = {}, { random = Math.random } = {}) {
  const shorthand = !body.seats && body.human && body.opponent;
  const legacy = !body.seats && !shorthand;
  const agentColor = body.agentColor === 'black' ? 'black' : 'white';
  const shorthandConfig = shorthand ? shorthandSeats(body, random) : null;
  const seats = shorthand ? shorthandConfig.seats : legacy ? {
    [agentColor]: cleanSeat({ kind: 'agent', name: body.agentName ?? 'Local Agent' }, 'Local Agent'),
    [agentColor === 'white' ? 'black' : 'white']: cleanSeat({ kind: 'engine', name: 'Stockfish' }, 'Stockfish'),
  } : {
    white: cleanSeat(body.seats.white, 'White'),
    black: cleanSeat(body.seats.black, 'Black'),
  };
  const config = {
    mode: body.mode === 'private_eval' ? 'private_eval' : 'exhibition',
    visibility: body.visibility === 'private' ? 'private' : 'public',
    rated: false,
    steeringMode: body.steeringMode === 'trainer' ? 'trainer' : 'locked',
    clock: { kind: 'none' },
    seats,
    engine: {
      provider: 'stockfish',
      skillLevel: Math.max(0, Math.min(20, Number(body.engine?.skillLevel ?? body.skillLevel ?? 5))),
      movetimeMs: Math.max(25, Math.min(5000, Number(body.engine?.movetimeMs ?? body.movetimeMs ?? 150))),
    },
    compatibility: legacy ? { legacyAgentColor: agentColor } : null,
    ...(shorthand ? { colorSelection: shorthandConfig.colorSelection } : {}),
  };
  validateSeatCombination(config);
  return config;
}

export function activeSeatFor(gameTurn, seats) {
  const color = gameTurn === 'w' || gameTurn === 'white' ? 'white' : 'black';
  return { ...seats[color], color };
}

export function publicSeat(seat) {
  const result = {
    kind: seat.kind,
    name: seat.name,
  };
  if (seat.kind === 'agent') result.traceRequirement = seat.traceRequirement;
  return result;
}
