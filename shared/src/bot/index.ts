import { CHIP_INDICES, type BotDifficulty } from '../types/core.js';
import type { PlayerView } from '../types/game.js';
import { STRATEGIES } from './strategies.js';
import { createBotMemory, type BotMemory, type BotStrategy } from './types.js';

export function createBot(difficulty: BotDifficulty): BotStrategy {
  return STRATEGIES[difficulty];
}

/**
 * Fold a finished game into the bot's memory, for rematches.
 *
 * Everything consumed here is public at that moment: the order the human ate
 * their own plate was visible all game, and both layouts are revealed to both
 * players once the match ends. Nothing secret is retained.
 */
export function rememberGame(memory: BotMemory, finishedView: PlayerView): BotMemory {
  if (finishedView.phase !== 'ENDED') return memory;

  for (const index of CHIP_INDICES) {
    const cell = finishedView.theirPlate.cells[index];
    if (cell && cell.state !== 'HIDDEN' && cell.order !== undefined) {
      memory.eatAffinity[index] = (memory.eatAffinity[index] ?? 0) + 1 / cell.order;
    }
  }
  // The bombs that were waiting in the bot's own plate are the human's layout.
  for (const index of finishedView.finalReveal?.bombsAgainstYou ?? []) {
    memory.plantAffinity[index] = (memory.plantAffinity[index] ?? 0) + 1;
  }
  memory.gamesObserved += 1;
  return memory;
}

export { createBotMemory };
export type { BotMemory, BotStrategy };
export * from './model.js';
export { STRATEGIES } from './strategies.js';
