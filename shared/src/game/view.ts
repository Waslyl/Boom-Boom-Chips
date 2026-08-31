/**
 * THE SECURITY BOUNDARY.
 *
 * `toPlayerView` is the only function allowed to turn a `GameState` into
 * something that crosses the network. It is built by construction rather than
 * by deletion: we assemble a brand-new object out of explicitly permitted
 * fields, so a future field added to `GameState` can never leak by accident.
 *
 * The asymmetry to keep straight: the bombs in YOUR plate were planted by your
 * opponent and must stay hidden from you, while the bombs in THEIR plate are
 * yours and you are entitled to see them. Getting that backwards would hand
 * each player the answer sheet, so the two projections are built separately and
 * the tests attack both directions.
 */
import { CHIP_INDICES, otherSlot, STARTING_LIVES, type ChipIndex, type Slot } from '../types/core.js';
import type {
  CellView,
  GameState,
  PlayerView,
  TheirPlateView,
  YourPlateView,
} from '../types/game.js';

function cellsFor(
  eaten: readonly ChipIndex[],
  isBombAt: (index: ChipIndex) => boolean,
): CellView[] {
  return CHIP_INDICES.map((index) => {
    const order = eaten.indexOf(index);
    if (order === -1) return { state: 'HIDDEN' };
    return { state: isBombAt(index) ? 'BOMB' : 'SAFE', order: order + 1 };
  });
}

/**
 * The plate `slot` eats from. Its bombs belong to the opponent, so this
 * projection deliberately has no bomb list at all — an unbitten chip is
 * described as HIDDEN and the secret array is never read for it.
 */
function yourPlateView(state: GameState, slot: Slot): YourPlateView {
  const plate = state.plates[slot];
  const cells = cellsFor(plate.eaten, (index) => plate.bombs.includes(index));
  const livesLost = cells.filter((cell) => cell.state === 'BOMB').length;
  return { cells, livesLost, lives: Math.max(0, STARTING_LIVES - livesLost) };
}

/** The opponent's plate, which `slot` sabotaged and may therefore read. */
function theirPlateView(state: GameState, slot: Slot): TheirPlateView {
  const plate = state.plates[otherSlot(slot)];
  const cells = cellsFor(plate.eaten, (index) => plate.bombs.includes(index));
  const livesLost = cells.filter((cell) => cell.state === 'BOMB').length;
  return {
    cells,
    yourBombs: [...plate.bombs],
    livesLost,
    lives: Math.max(0, STARTING_LIVES - livesLost),
  };
}

/**
 * Project the full server state down to what exactly one player may know.
 * `slot` is the recipient.
 */
export function toPlayerView(state: GameState, slot: Slot): PlayerView {
  const foe = otherSlot(slot);
  const me = state.players[slot];
  const them = state.players[foe];
  const ended = state.phase === 'ENDED';

  const opponent: PlayerView['opponent'] = {
    name: them.name,
    isBot: them.isBot,
    connected: them.connected,
    ...(them.botDifficulty ? { botDifficulty: them.botDifficulty } : {}),
    ...(them.disconnectedUntil !== undefined ? { disconnectedUntil: them.disconnectedUntil } : {}),
  };

  return {
    gameId: state.gameId,
    mode: state.mode,
    phase: state.phase,
    you: slot,
    yourName: me.name,
    opponent,
    yourPlate: yourPlateView(state, slot),
    theirPlate: theirPlateView(state, slot),
    bombsPlanted: { you: state.bombsPlanted[slot], opponent: state.bombsPlanted[foe] },
    currentTurn: state.currentTurn,
    isYourTurn: state.phase === 'PLAYING' && state.currentTurn === slot,
    turnNumber: state.turnNumber,
    deadline: state.deadline,
    winner: state.winner,
    youWon: state.winner === null ? null : state.winner === slot,
    endReason: state.endReason,
    rematch: { you: state.rematch[slot], opponent: state.rematch[foe] },
    // The trap laid for you opens only once the match is over, which is exactly
    // when the brief asks for the double reveal.
    finalReveal: ended
      ? {
          bombsAgainstYou: [...state.plates[slot].bombs],
          bombsYouPlanted: [...state.plates[foe].bombs],
        }
      : null,
  };
}

/**
 * Every key a `PlayerView` is allowed to contain, at every depth.
 * The test-suite walks a generated view against this allowlist, so adding a
 * secret-bearing field anywhere in the projection turns the build red.
 */
export const PLAYER_VIEW_KEY_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  $root: [
    'gameId',
    'mode',
    'phase',
    'you',
    'yourName',
    'opponent',
    'yourPlate',
    'theirPlate',
    'bombsPlanted',
    'currentTurn',
    'isYourTurn',
    'turnNumber',
    'deadline',
    'winner',
    'youWon',
    'endReason',
    'rematch',
    'finalReveal',
  ],
  opponent: ['name', 'isBot', 'botDifficulty', 'connected', 'disconnectedUntil'],
  // Note the absence of any bomb field here. That is the whole game.
  yourPlate: ['cells', 'livesLost', 'lives'],
  theirPlate: ['cells', 'yourBombs', 'livesLost', 'lives'],
  bombsPlanted: ['you', 'opponent'],
  rematch: ['you', 'opponent'],
  finalReveal: ['bombsAgainstYou', 'bombsYouPlanted'],
  cell: ['state', 'order'],
};
