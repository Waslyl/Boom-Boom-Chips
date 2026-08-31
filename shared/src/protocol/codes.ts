/** Every rejection the server can produce. Clients map these to friendly copy. */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'RATE_LIMITED',
  'INTERNAL',
  'SESSION_INVALID',
  'NOT_IN_PARTY',
  'PARTY_NOT_FOUND',
  'PARTY_FULL',
  'GAME_ALREADY_STARTED',
  'INVALID_CODE',
  'WRONG_PHASE',
  'NOT_YOUR_TURN',
  'INVALID_CHIP',
  'ALREADY_REVEALED',
  'BOMBS_ALREADY_PLACED',
  'INVALID_BOMB_PLACEMENT',
  'GAME_IS_OVER',
  'OPPONENT_GONE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  BAD_REQUEST: 'That request could not be understood.',
  RATE_LIMITED: 'Slow down a moment.',
  INTERNAL: 'Something went wrong on our side.',
  SESSION_INVALID: 'Your session has expired.',
  NOT_IN_PARTY: 'You are not in a party.',
  PARTY_NOT_FOUND: 'PARTY NOT FOUND',
  PARTY_FULL: 'PARTY FULL',
  GAME_ALREADY_STARTED: 'GAME ALREADY STARTED',
  INVALID_CODE: 'That code does not look right.',
  WRONG_PHASE: 'You cannot do that right now.',
  NOT_YOUR_TURN: "It is not your turn.",
  INVALID_CHIP: 'That chip does not exist.',
  ALREADY_REVEALED: 'That chip is already gone.',
  BOMBS_ALREADY_PLACED: 'Your bombs are already planted.',
  INVALID_BOMB_PLACEMENT: 'Pick exactly 3 different chips.',
  GAME_IS_OVER: 'This game is already over.',
  OPPONENT_GONE: 'Your opponent left the game.',
};
