/**
 * The Boom Boom Chips rules engine.
 *
 * The rule that shapes everything else: you PLANT your bombs in your
 * opponent's plate, and you EAT from your own. So the mines you walk through
 * were laid by them, and the mines you laid are waiting for them. A bomb is a
 * lost life, not a scored point — the last player still standing wins.
 *
 * Pure and UI-free: no React, no Node, no I/O, no clock of its own (the caller
 * passes `now`). Every mutation returns a brand-new state plus the public
 * events it produced.
 *
 * Turn rule: the turn ALWAYS passes after a bite, bomb or not.
 */
import {
  BOMB_COUNT,
  CHIP_COUNT,
  CHIP_INDICES,
  isChipIndex,
  otherSlot,
  SLOTS,
  STARTING_LIVES,
  type ChipIndex,
  type EpochMs,
  type GameId,
  type MatchMode,
  type Slot,
} from '../types/core.js';
import type {
  EndReason,
  GameRules,
  GameState,
  MoveRecord,
  Plate,
  PlayerInfo,
} from '../types/game.js';
import { err, ok, type Result } from '../types/result.js';
import type { ErrorCode } from '../protocol/codes.js';
import type { GameEvent, Transition } from './events.js';
import type { Rng } from './rng.js';

export const DEFAULT_MULTIPLAYER_RULES: GameRules = {
  turnTimeLimitMs: 30_000,
  setupTimeLimitMs: 90_000,
};

export const DEFAULT_BOT_RULES: GameRules = {
  turnTimeLimitMs: null,
  setupTimeLimitMs: null,
};

const EMPTY_PLATE: Plate = { bombs: [], eaten: [] };

export interface CreatePlayerOptions {
  id: string;
  name: string;
  isBot?: boolean;
  botDifficulty?: PlayerInfo['botDifficulty'];
  connected?: boolean;
}

export function createPlayer(options: CreatePlayerOptions): PlayerInfo {
  const player: PlayerInfo = {
    id: options.id,
    name: options.name,
    isBot: options.isBot ?? false,
    connected: options.connected ?? true,
  };
  return options.botDifficulty ? { ...player, botDifficulty: options.botDifficulty } : player;
}

export interface CreateGameOptions {
  gameId: GameId;
  mode: MatchMode;
  p1: PlayerInfo;
  p2: PlayerInfo;
  rules?: GameRules;
  now?: EpochMs;
  /** Who eats first once both plates are armed. Random when omitted. */
  firstTurn?: Slot;
  rng?: Rng;
}

export function createGame(options: CreateGameOptions): GameState {
  const now = options.now ?? Date.now();
  const rules =
    options.rules ?? (options.mode === 'BOT' ? DEFAULT_BOT_RULES : DEFAULT_MULTIPLAYER_RULES);
  const firstTurn = options.firstTurn ?? (options.rng ? options.rng.pick(SLOTS) : 'P1');
  return {
    gameId: options.gameId,
    mode: options.mode,
    rules,
    phase: 'SETUP',
    players: { P1: options.p1, P2: options.p2 },
    plates: { P1: EMPTY_PLATE, P2: EMPTY_PLATE },
    bombsPlanted: { P1: false, P2: false },
    currentTurn: firstTurn,
    turnNumber: 0,
    deadline: rules.setupTimeLimitMs === null ? null : now + rules.setupTimeLimitMs,
    winner: null,
    endReason: null,
    history: [],
    rematch: { P1: false, P2: false },
    createdAt: now,
    startedAt: null,
    endedAt: null,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/** Is there a bomb at `index` in `owner`'s plate? Server-side truth only. */
export function isBomb(state: GameState, owner: Slot, index: ChipIndex): boolean {
  return state.plates[owner].bombs.includes(index);
}

/** How many bombs `victim` has bitten into, i.e. how many lives they have lost. */
export function getLivesLost(state: GameState, victim: Slot): number {
  const plate = state.plates[victim];
  return plate.eaten.filter((index) => plate.bombs.includes(index)).length;
}

export function getLives(state: GameState, victim: Slot): number {
  return Math.max(0, STARTING_LIVES - getLivesLost(state, victim));
}

export function isEliminated(state: GameState, victim: Slot): boolean {
  return getLivesLost(state, victim) >= STARTING_LIVES;
}

/** Chips `player` has not eaten yet, from their own plate. */
export function getRemainingChips(state: GameState, player: Slot): ChipIndex[] {
  const plate = state.plates[player];
  return CHIP_INDICES.filter((index) => !plate.eaten.includes(index));
}

export function isGameOver(state: GameState): boolean {
  return state.phase === 'ENDED';
}

export function getWinner(state: GameState): Slot | null {
  return state.winner;
}

/** Whose turn it becomes after the current one resolves. */
export function getNextPlayer(state: GameState): Slot {
  return otherSlot(state.currentTurn);
}

/* ------------------------------------------------------------------ */
/* Planting                                                            */
/* ------------------------------------------------------------------ */

/** Pick BOMB_COUNT distinct cells uniformly at random. */
export function randomBombPositions(rng: Rng): ChipIndex[] {
  return rng
    .shuffled(CHIP_INDICES)
    .slice(0, BOMB_COUNT)
    .sort((a, b) => a - b);
}

/** Structural check: exactly 3 distinct in-range indices. */
export function isValidBombPlacement(positions: readonly unknown[]): positions is ChipIndex[] {
  if (!Array.isArray(positions) || positions.length !== BOMB_COUNT) return false;
  if (!positions.every(isChipIndex)) return false;
  return new Set(positions).size === BOMB_COUNT;
}

/**
 * `planter` hides bombs in the OPPOSING plate. This is the inversion that makes
 * the game work: nobody ever chooses what is under their own chips.
 */
export function plantBombs(
  state: GameState,
  planter: Slot,
  positions: readonly number[],
  now: EpochMs = Date.now(),
): Result<Transition, ErrorCode> {
  if (state.phase !== 'SETUP') return err('WRONG_PHASE', 'Bombs can only be planted during setup.');
  if (state.bombsPlanted[planter]) {
    return err('BOMBS_ALREADY_PLACED', 'Your bombs are already planted.');
  }
  if (!isValidBombPlacement(positions)) {
    return err('INVALID_BOMB_PLACEMENT', `Pick exactly ${BOMB_COUNT} different chips.`);
  }

  const victim = otherSlot(planter);
  const sorted = [...positions].sort((a, b) => a - b);
  const armed: GameState = {
    ...state,
    plates: {
      ...state.plates,
      [victim]: { bombs: sorted, eaten: [] },
    } as GameState['plates'],
    bombsPlanted: { ...state.bombsPlanted, [planter]: true } as GameState['bombsPlanted'],
  };
  const events: GameEvent[] = [{ type: 'BOMBS_PLANTED', by: planter }];

  if (armed.bombsPlanted.P1 && armed.bombsPlanted.P2) {
    return ok(startPlaying(armed, events, now));
  }
  return ok({ state: armed, events });
}

function startPlaying(state: GameState, events: GameEvent[], now: EpochMs): Transition {
  const deadline = state.rules.turnTimeLimitMs === null ? null : now + state.rules.turnTimeLimitMs;
  const playing: GameState = {
    ...state,
    phase: 'PLAYING',
    turnNumber: 1,
    deadline,
    startedAt: now,
  };
  return {
    state: playing,
    events: [
      ...events,
      { type: 'GAME_START', firstTurn: playing.currentTurn },
      { type: 'TURN_CHANGED', turn: playing.currentTurn, turnNumber: 1, deadline },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Eating                                                              */
/* ------------------------------------------------------------------ */

/** Every reason a bite can be refused, in the order the server reports them. */
export function validateMove(
  state: GameState,
  slot: Slot,
  index: number,
): Result<ChipIndex, ErrorCode> {
  if (state.phase === 'ENDED') return err('GAME_IS_OVER', 'This game is already over.');
  if (state.phase !== 'PLAYING') return err('WRONG_PHASE', 'The game has not started yet.');
  if (state.currentTurn !== slot) return err('NOT_YOUR_TURN', 'It is not your turn.');
  if (!isChipIndex(index)) return err('INVALID_CHIP', `Chip must be 0..${CHIP_COUNT - 1}.`);
  if (state.plates[slot].eaten.includes(index)) {
    return err('ALREADY_REVEALED', 'That chip is already gone.');
  }
  return ok(index);
}

/**
 * `slot` eats one chip from their OWN plate.
 * Validation happens here too, so no caller can bypass it.
 */
export function eatChip(
  state: GameState,
  slot: Slot,
  index: number,
  now: EpochMs = Date.now(),
): Result<Transition, ErrorCode> {
  const validated = validateMove(state, slot, index);
  if (!validated.ok) return validated;

  const chip = validated.value;
  const plate = state.plates[slot];
  const wasBomb = plate.bombs.includes(chip);

  const record: MoveRecord = {
    turnNumber: state.turnNumber,
    by: slot,
    index: chip,
    wasBomb,
    at: now,
  };
  let next: GameState = {
    ...state,
    plates: {
      ...state.plates,
      [slot]: { ...plate, eaten: [...plate.eaten, chip] },
    } as GameState['plates'],
    history: [...state.history, record],
  };

  const events: GameEvent[] = [{ type: 'CHIP_EATEN', by: slot, index: chip, isBomb: wasBomb }];

  if (wasBomb) {
    events.push({ type: 'BOMB_HIT', victim: slot, index: chip, livesLeft: getLives(next, slot) });
  }

  // Out of lives: the survivor takes the match.
  if (isEliminated(next, slot)) {
    const survivor = otherSlot(slot);
    next = {
      ...next,
      phase: 'ENDED',
      winner: survivor,
      endReason: 'ELIMINATED',
      deadline: null,
      endedAt: now,
    };
    events.push({ type: 'GAME_OVER', winner: survivor, reason: 'ELIMINATED' });
    return ok({ state: next, events });
  }

  // The turn always passes, bomb or not.
  const deadline = next.rules.turnTimeLimitMs === null ? null : now + next.rules.turnTimeLimitMs;
  const turnNumber = next.turnNumber + 1;
  next = { ...next, currentTurn: otherSlot(slot), turnNumber, deadline };
  events.push({ type: 'TURN_CHANGED', turn: otherSlot(slot), turnNumber, deadline });
  return ok({ state: next, events });
}

/* ------------------------------------------------------------------ */
/* Timeouts and terminations                                           */
/* ------------------------------------------------------------------ */

/**
 * Turn clock expired: the server takes a random remaining chip for the idle
 * player so a match can never stall. Returns null when nothing was due.
 */
export function applyTurnTimeout(
  state: GameState,
  rng: Rng,
  now: EpochMs = Date.now(),
): Transition | null {
  if (state.phase !== 'PLAYING' || state.deadline === null || now < state.deadline) return null;
  const remaining = getRemainingChips(state, state.currentTurn);
  if (remaining.length === 0) return null;
  const idle = state.currentTurn;
  const forced = eatChip(state, idle, rng.pick(remaining), now);
  if (!forced.ok) return null;
  return {
    state: forced.value.state,
    events: [{ type: 'TURN_TIMEOUT', slot: idle }, ...forced.value.events],
  };
}

/** Setup clock expired: plant any missing bombs at random rather than killing the match. */
export function applySetupTimeout(
  state: GameState,
  rng: Rng,
  now: EpochMs = Date.now(),
): Transition | null {
  if (state.phase !== 'SETUP' || state.deadline === null || now < state.deadline) return null;
  let current = state;
  const events: GameEvent[] = [];
  for (const slot of SLOTS) {
    if (current.bombsPlanted[slot]) continue;
    const planted = plantBombs(current, slot, randomBombPositions(rng), now);
    if (!planted.ok) return null;
    current = planted.value.state;
    events.push(...planted.value.events);
  }
  return { state: current, events };
}

/** End the match without an elimination (opponent left, grace period expired). */
export function endGame(
  state: GameState,
  winner: Slot | null,
  reason: EndReason,
  now: EpochMs = Date.now(),
): Transition {
  if (state.phase === 'ENDED') return { state, events: [] };
  const ended: GameState = {
    ...state,
    phase: 'ENDED',
    winner,
    endReason: reason,
    deadline: null,
    endedAt: now,
  };
  return { state: ended, events: [{ type: 'GAME_OVER', winner, reason }] };
}

/* ------------------------------------------------------------------ */
/* Rematch                                                             */
/* ------------------------------------------------------------------ */

export function requestRematch(state: GameState, slot: Slot): Result<GameState, ErrorCode> {
  if (state.phase !== 'ENDED') return err('WRONG_PHASE', 'The game is still running.');
  if (state.rematch[slot]) return ok(state);
  return ok({ ...state, rematch: { ...state.rematch, [slot]: true } as GameState['rematch'] });
}

export function bothWantRematch(state: GameState): boolean {
  return state.rematch.P1 && state.rematch.P2;
}

/**
 * Fresh match, same seats, fresh secret bombs.
 *
 * The WINNER eats first, which is a handicap rather than a reward: whoever bites
 * first reaches their third bomb first if both plates run equally badly, so
 * moving first is the weaker seat. Giving it to the winner keeps a rematch
 * chain fair without anyone having to think about it.
 */
export function createRematch(state: GameState, gameId: GameId, now: EpochMs = Date.now()): GameState {
  const firstTurn: Slot = state.winner ?? state.currentTurn;
  return createGame({
    gameId,
    mode: state.mode,
    p1: { ...state.players.P1 },
    p2: { ...state.players.P2 },
    rules: state.rules,
    firstTurn,
    now,
  });
}

/* ------------------------------------------------------------------ */
/* Connection bookkeeping                                              */
/* ------------------------------------------------------------------ */

export function setConnected(
  state: GameState,
  slot: Slot,
  connected: boolean,
  disconnectedUntil?: EpochMs,
): GameState {
  const base = state.players[slot];
  const player: PlayerInfo = connected
    ? { ...base, connected: true, disconnectedUntil: undefined }
    : { ...base, connected: false, disconnectedUntil };
  return { ...state, players: { ...state.players, [slot]: player } as GameState['players'] };
}
