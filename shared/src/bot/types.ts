import type { BotDifficulty, ChipIndex } from '../types/core.js';
import type { PlayerView } from '../types/game.js';
import type { Rng } from '../game/rng.js';

/**
 * THE ANTI-CHEAT GUARANTEE IS THE TYPE SIGNATURE.
 *
 * A strategy receives a `PlayerView` — byte for byte the same redacted object
 * a human client receives over the socket — and nothing else. It has no route
 * to `GameState`, so it cannot see the bombs waiting in its own plate even if
 * it wanted to. `bot.test.ts` pins this down empirically as well: identical
 * views over different hidden truths must produce identical decisions.
 */
export interface BotStrategy {
  readonly difficulty: BotDifficulty;
  /** Where to plant 3 bombs in the OPPONENT's plate. Called before anything is known. */
  plantBombs(rng: Rng, memory: BotMemory): ChipIndex[];
  /** Which chip to eat from its OWN plate. Must return a cell that is still there. */
  chooseMove(view: PlayerView, rng: Rng, memory: BotMemory): ChipIndex;
  /** How long the bot should appear to hesitate, in milliseconds. */
  thinkTimeMs(rng: Rng): number;
}

/**
 * What the bot is allowed to remember between games of the same rematch chain.
 * Everything in here is derived from information both players could see.
 */
export interface BotMemory {
  /** Where the human reaches on their own plate, weighted by how early. */
  readonly eatAffinity: number[];
  /** Where the human was seen planting bombs, from completed games. */
  readonly plantAffinity: number[];
  gamesObserved: number;
}

export function createBotMemory(): BotMemory {
  return {
    eatAffinity: new Array<number>(9).fill(0),
    plantAffinity: new Array<number>(9).fill(0),
    gamesObserved: 0,
  };
}
