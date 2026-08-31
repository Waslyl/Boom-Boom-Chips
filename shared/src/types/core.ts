/**
 * Core primitives for Boom Boom Chips.
 *
 * The whole game is a 3x3 grid of 9 chips per player, of which exactly 3 are
 * bombs. These constants are the single source of truth; nothing in the code
 * base is allowed to hard-code `9` or `3`.
 */

export const GRID_SIDE = 3;
export const CHIP_COUNT = 9;
export const BOMB_COUNT = 3;
export const SAFE_COUNT = CHIP_COUNT - BOMB_COUNT;

/**
 * Lives are bombs: each player survives exactly BOMB_COUNT - 1 explosions.
 * Named separately because the UI counts down lives while the engine counts up
 * detonations, and conflating the two is how off-by-one bugs get in.
 */
export const STARTING_LIVES = BOMB_COUNT;

/** A cell of the 3x3 grid, row-major: 0..8. */
export type ChipIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const CHIP_INDICES: readonly ChipIndex[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export function isChipIndex(value: unknown): value is ChipIndex {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CHIP_COUNT;
}

/** Seat inside a match. `P1` is whoever created/was assigned first. */
export type Slot = 'P1' | 'P2';

export const SLOTS: readonly Slot[] = ['P1', 'P2'];

export function otherSlot(slot: Slot): Slot {
  return slot === 'P1' ? 'P2' : 'P1';
}

/** Absolute wall-clock milliseconds (server authoritative). */
export type EpochMs = number;

export type GameId = string;
export type PartyCode = string;
export type PlayerId = string;

export type MatchMode = 'BOT' | 'FRIEND';

export type BotDifficulty = 'EASY' | 'NORMAL' | 'HARD' | 'EXPERT';

export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['EASY', 'NORMAL', 'HARD', 'EXPERT'];

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return typeof value === 'string' && (BOT_DIFFICULTIES as readonly string[]).includes(value);
}

/** Row/column helpers used by the placement heuristics and the UI. */
export function rowOf(index: ChipIndex): number {
  return Math.floor(index / GRID_SIDE);
}

export function colOf(index: ChipIndex): number {
  return index % GRID_SIDE;
}

export function areOrthogonallyAdjacent(a: ChipIndex, b: ChipIndex): boolean {
  const dr = Math.abs(rowOf(a) - rowOf(b));
  const dc = Math.abs(colOf(a) - colOf(b));
  return dr + dc === 1;
}
