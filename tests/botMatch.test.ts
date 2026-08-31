/**
 * Bot matches run on the server, through the same rooms, engine and protocol
 * as a friend match. That is what makes the bot provably unable to cheat and
 * keeps the bomb layout out of the browser entirely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOT_DIFFICULTIES, CHIP_INDICES, type ChipIndex } from '@bbc/shared';
import { config } from '../server/src/config.js';
import { createHarness, type Harness, type TestClient } from './harness.js';

let harness: Harness;

beforeEach(() => {
  vi.useFakeTimers();
  harness = createHarness();
});

afterEach(() => {
  harness.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function startBotGame(difficulty = 'NORMAL'): TestClient {
  const player = harness.client('player');
  player.send({ t: 'START_BOT_GAME', name: 'Ada', difficulty });
  return player;
}

/** Let every pending bot think-timer fire. */
function letBotThink(): void {
  vi.advanceTimersByTime(3_000);
}

/** The next chip still on the player's own plate. */
function firstUneaten(player: TestClient): ChipIndex {
  const index = CHIP_INDICES.find((i) => player.view().yourPlate.cells[i]!.state === 'HIDDEN');
  if (index === undefined) throw new Error('no chips left');
  return index;
}

describe('starting a bot match', () => {
  it.each(BOT_DIFFICULTIES)('opens straight into setup against the %s bot', (difficulty) => {
    const player = startBotGame(difficulty);
    const view = player.view();
    expect(view.mode).toBe('BOT');
    expect(view.phase).toBe('SETUP');
    expect(view.opponent.isBot).toBe(true);
    expect(view.opponent.botDifficulty).toBe(difficulty);
    // The bot has already rigged the player's plate, secretly.
    expect(view.bombsPlanted).toEqual({ you: false, opponent: true });
    expect(player.party().code).toBeNull();
  });

  it('rejects an unknown difficulty', () => {
    const player = harness.client('player');
    player.send({ t: 'START_BOT_GAME', name: 'Ada', difficulty: 'IMPOSSIBLE' });
    expect(player.lastError()?.code).toBe('BAD_REQUEST');
  });

  it('runs without any turn clock, so a player can think', () => {
    const player = startBotGame();
    player.send({ t: 'PLACE_BOMBS', positions: [0, 1, 2] });
    expect(player.view().deadline).toBeNull();

    vi.advanceTimersByTime(120_000);
    letBotThink();
    // Time passing never forces the human's hand.
    expect(player.view().phase).toBe('PLAYING');
  });

  it('never sends the bombs waiting in your plate to the browser', () => {
    const player = startBotGame('EXPERT');
    player.send({ t: 'PLACE_BOMBS', positions: [0, 1, 2] });
    letBotThink();

    for (const message of player.messages('STATE')) {
      if (message.view.phase === 'ENDED') continue;
      expect(message.view.yourPlate).not.toHaveProperty('bombs');
      expect(message.view.yourPlate).not.toHaveProperty('yourBombs');
      expect(message.view.finalReveal).toBeNull();
    }
  });
});

describe('playing the bot', () => {
  it('lets the bot take its own turn, after a pause', () => {
    const player = startBotGame();
    player.send({ t: 'PLACE_BOMBS', positions: [0, 1, 2] });

    // Make sure the human has moved, so it is definitely the bot's turn.
    if (player.view().isYourTurn) player.send({ t: 'MAKE_MOVE', index: firstUneaten(player) });
    expect(player.view().isYourTurn).toBe(false);

    const eatenBefore = player.view().theirPlate.cells.filter((c) => c.state !== 'HIDDEN').length;
    letBotThink();
    const eatenAfter = player.view().theirPlate.cells.filter((c) => c.state !== 'HIDDEN').length;

    expect(eatenAfter).toBe(eatenBefore + 1);
    expect(player.view().isYourTurn).toBe(true);
  });

  it('plays a whole match to a real result', () => {
    const player = startBotGame('HARD');
    player.send({ t: 'PLACE_BOMBS', positions: [0, 4, 8] });

    let guard = 0;
    while (player.view().phase === 'PLAYING' && guard < 30) {
      guard += 1;
      if (player.view().isYourTurn) player.send({ t: 'MAKE_MOVE', index: firstUneaten(player) });
      else letBotThink();
    }

    const view = player.view();
    expect(view.phase).toBe('ENDED');
    expect(view.winner).not.toBeNull();
    expect(view.youWon).toBe(view.winner === view.you);
    expect(view.finalReveal!.bombsYouPlanted).toEqual([0, 4, 8]);
    expect(view.finalReveal!.bombsAgainstYou).toHaveLength(3);
    // Whoever lost, they ate all three of the bombs laid for them.
    const loserLives = view.youWon ? view.theirPlate.lives : view.yourPlate.lives;
    expect(loserLives).toBe(0);
  });

  it('refuses a move made during the bot turn', () => {
    const player = startBotGame();
    player.send({ t: 'PLACE_BOMBS', positions: [0, 1, 2] });
    if (player.view().isYourTurn) player.send({ t: 'MAKE_MOVE', index: firstUneaten(player) });

    player.send({ t: 'MAKE_MOVE', index: firstUneaten(player) });
    expect(player.lastError()?.code).toBe('NOT_YOUR_TURN');
  });

  it('does not let a queued bot move land on a board that has moved on', () => {
    const player = startBotGame();
    player.send({ t: 'PLACE_BOMBS', positions: [0, 1, 2] });
    if (player.view().isYourTurn) player.send({ t: 'MAKE_MOVE', index: firstUneaten(player) });

    // The player walks out while the bot is mid-think.
    player.disconnect();
    letBotThink(); // the bot resolves its move into an empty room without throwing

    // The seat is held open for the grace period, so a refresh can reclaim it.
    expect(harness.rooms.size).toBe(1);

    vi.advanceTimersByTime(config.disconnectGraceMs + 1_000);
    expect(harness.rooms.size).toBe(0);
  });
});

describe('bot rematch', () => {
  function playOut(player: TestClient): void {
    let guard = 0;
    while (player.view().phase === 'PLAYING' && guard < 30) {
      guard += 1;
      if (player.view().isYourTurn) player.send({ t: 'MAKE_MOVE', index: firstUneaten(player) });
      else letBotThink();
    }
  }

  it('restarts immediately, because a bot always accepts', () => {
    const player = startBotGame('EXPERT');
    player.send({ t: 'PLACE_BOMBS', positions: [0, 4, 8] });
    playOut(player);
    expect(player.view().phase).toBe('ENDED');

    player.send({ t: 'REQUEST_REMATCH' });
    const view = player.view();
    expect(view.phase).toBe('SETUP');
    expect(view.theirPlate.yourBombs).toEqual([]);
    expect(view.bombsPlanted).toEqual({ you: false, opponent: true });
    expect(view.finalReveal).toBeNull();
  });

  it('plays the second game through to an end as well', () => {
    const player = startBotGame('NORMAL');
    player.send({ t: 'PLACE_BOMBS', positions: [0, 4, 8] });
    playOut(player);
    player.send({ t: 'REQUEST_REMATCH' });
    player.send({ t: 'PLACE_BOMBS', positions: [2, 3, 7] });
    playOut(player);

    expect(player.view().phase).toBe('ENDED');
    expect(player.view().finalReveal!.bombsYouPlanted).toEqual([2, 3, 7]);
  });

  it('rigs your plate differently each game', () => {
    const layouts = new Set<string>();
    for (let game = 0; game < 12; game += 1) {
      const player = startBotGame('HARD');
      player.send({ t: 'PLACE_BOMBS', positions: [0, 1, 2] });
      playOut(player);
      layouts.add(player.view().finalReveal!.bombsAgainstYou.join(','));
      player.disconnect();
      vi.advanceTimersByTime(100);
    }
    expect(layouts.size).toBeGreaterThan(1);
  });
});
