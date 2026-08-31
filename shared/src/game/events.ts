import type { ChipIndex, EpochMs, Slot } from '../types/core.js';
import type { EndReason, GameState } from '../types/game.js';

/**
 * Animation cues. Events carry only information that has just become public,
 * so they are safe to broadcast verbatim to both players.
 */
export type GameEvent =
  | { readonly type: 'BOMBS_PLANTED'; readonly by: Slot }
  | { readonly type: 'GAME_START'; readonly firstTurn: Slot }
  | {
      /** `by` ate a chip from their own plate. */
      readonly type: 'CHIP_EATEN';
      readonly by: Slot;
      readonly index: ChipIndex;
      readonly isBomb: boolean;
    }
  | {
      readonly type: 'BOMB_HIT';
      /** The player who bit into it. */
      readonly victim: Slot;
      readonly index: ChipIndex;
      readonly livesLeft: number;
    }
  | {
      readonly type: 'TURN_CHANGED';
      readonly turn: Slot;
      readonly turnNumber: number;
      readonly deadline: EpochMs | null;
    }
  | { readonly type: 'TURN_TIMEOUT'; readonly slot: Slot }
  | { readonly type: 'GAME_OVER'; readonly winner: Slot | null; readonly reason: EndReason };

export interface Transition {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}
