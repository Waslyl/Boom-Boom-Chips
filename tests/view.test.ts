/**
 * Redaction tests.
 *
 * These are the tests that matter most. The asymmetry is the whole game: the
 * bombs in YOUR plate were planted by your opponent and must stay invisible,
 * while the bombs you planted in THEIRS are yours to see. Getting that backwards
 * either way ruins the game, so both directions are attacked here — by
 * structure (an exhaustive key allowlist), by information content (many
 * different hidden truths must produce one identical payload), and by brute
 * force over every legal layout.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_CONFIGS,
  CHIP_INDICES,
  createGame,
  createPlayer,
  createSeededRng,
  eatChip,
  endGame,
  PLAYER_VIEW_KEY_ALLOWLIST,
  plantBombs,
  toPlayerView,
  type ChipIndex,
  type GameState,
  type PlayerView,
  type Slot,
} from '@bbc/shared';

/** `p1Plants` lands in P2's plate, and vice versa. */
function armed(p1Plants: number[], p2Plants: number[]): GameState {
  const base = createGame({
    gameId: 'g',
    mode: 'FRIEND',
    p1: createPlayer({ id: 'a', name: 'Ada' }),
    p2: createPlayer({ id: 'b', name: 'Bo' }),
    firstTurn: 'P1',
    now: 0,
  });
  const first = plantBombs(base, 'P1', p1Plants, 0);
  if (!first.ok) throw new Error('bad fixture');
  const second = plantBombs(first.value.state, 'P2', p2Plants, 0);
  if (!second.ok) throw new Error('bad fixture');
  return second.value.state;
}

function bite(state: GameState, slot: Slot, index: number): GameState {
  const result = eatChip(state, slot, index, 0);
  if (!result.ok) throw new Error(`bad fixture: ${result.code}`);
  return result.value.state;
}

/** Walk every key of the projection against the allowlist, at every depth. */
function collectIllegalKeys(value: unknown, scope: string, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => collectIllegalKeys(item, scope, `${path}[${i}]`));
  }
  if (typeof value !== 'object' || value === null) return [];

  const allowed = PLAYER_VIEW_KEY_ALLOWLIST[scope];
  const problems: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (!allowed || !allowed.includes(key)) {
      problems.push(`${path}.${key} (scope: ${scope})`);
      continue;
    }
    const childScope = PLAYER_VIEW_KEY_ALLOWLIST[key] ? key : key === 'cells' ? 'cell' : null;
    if (childScope) problems.push(...collectIllegalKeys(child, childScope, `${path}.${key}`));
  }
  return problems;
}

describe('projection shape', () => {
  it('emits only allowlisted keys, at every depth and in every phase', () => {
    const setup = createGame({
      gameId: 'g',
      mode: 'FRIEND',
      p1: createPlayer({ id: 'a', name: 'Ada' }),
      p2: createPlayer({ id: 'b', name: 'Bo', isBot: true, botDifficulty: 'EXPERT' }),
      now: 0,
    });
    let playing = armed([0, 1, 2], [6, 7, 8]);
    playing = bite(playing, 'P1', 6);
    const ended = endGame(playing, 'P2', 'ELIMINATED', 0).state;

    for (const state of [setup, playing, ended]) {
      for (const slot of ['P1', 'P2'] as const) {
        expect(collectIllegalKeys(toPlayerView(state, slot), '$root')).toEqual([]);
      }
    }
  });

  it('survives a JSON round trip unchanged, which is what the socket does', () => {
    const view = toPlayerView(armed([0, 4, 8], [1, 3, 5]), 'P1');
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});

describe('what a player may know', () => {
  it('shows you the traps you laid in their plate', () => {
    const view = toPlayerView(armed([0, 4, 8], [1, 3, 5]), 'P1');
    expect(view.theirPlate.yourBombs).toEqual([0, 4, 8]);
  });

  it('NEVER shows what is under your own chips', () => {
    const view = toPlayerView(armed([0, 4, 8], [1, 3, 5]), 'P1');
    // P2 planted 1, 3 and 5 in P1's plate. P1 must not be able to tell.
    expect(view.yourPlate).not.toHaveProperty('bombs');
    expect(view.yourPlate).not.toHaveProperty('yourBombs');
    expect(view.finalReveal).toBeNull();
    expect(view.yourPlate.cells.every((cell) => cell.state === 'HIDDEN')).toBe(true);
    expect(view.yourPlate.lives).toBe(3);
  });

  it('reveals one of your own chips only once you have actually eaten it', () => {
    let state = armed([0, 4, 8], [1, 3, 5]);
    state = bite(state, 'P1', 1); // a bomb P2 planted
    state = bite(state, 'P2', 2); // safe
    const p1 = toPlayerView(state, 'P1');

    expect(p1.yourPlate.cells[1]).toEqual({ state: 'BOMB', order: 1 });
    expect(p1.yourPlate.lives).toBe(2);
    expect(p1.yourPlate.livesLost).toBe(1);
    // The other two bombs waiting for P1 (3 and 5) are still dark.
    expect(p1.yourPlate.cells[3]!.state).toBe('HIDDEN');
    expect(p1.yourPlate.cells[5]!.state).toBe('HIDDEN');
    // And P1 can watch P2 nibbling around the traps P1 set.
    expect(p1.theirPlate.cells[2]).toEqual({ state: 'SAFE', order: 1 });
    expect(p1.theirPlate.lives).toBe(3);
  });

  it('counts the opponent lives from the traps you planted', () => {
    let state = armed([0, 4, 8], [1, 3, 5]);
    state = bite(state, 'P1', 2); // safe for P1
    state = bite(state, 'P2', 0); // P2 bites one of P1's bombs
    const p1 = toPlayerView(state, 'P1');
    expect(p1.theirPlate.lives).toBe(2);
    expect(p1.theirPlate.livesLost).toBe(1);
    expect(toPlayerView(state, 'P2').yourPlate.lives).toBe(2);
  });

  it('opens both plates once, and only once, the match is over', () => {
    const finished = endGame(armed([0, 4, 8], [1, 3, 5]), 'P1', 'ELIMINATED', 0).state;
    const p1 = toPlayerView(finished, 'P1');
    expect(p1.finalReveal).toEqual({
      bombsAgainstYou: [1, 3, 5], // what P2 had waiting for P1
      bombsYouPlanted: [0, 4, 8], // what P1 laid for P2
    });
    expect(p1.youWon).toBe(true);
    expect(toPlayerView(finished, 'P2').youWon).toBe(false);
  });

  it('mirrors the two seats consistently', () => {
    let state = armed([0, 4, 8], [1, 3, 5]);
    state = bite(state, 'P1', 1);
    const p1 = toPlayerView(state, 'P1');
    const p2 = toPlayerView(state, 'P2');
    expect(p1.you).toBe('P1');
    expect(p2.you).toBe('P2');
    expect(p1.isYourTurn).toBe(false);
    expect(p2.isYourTurn).toBe(true);
    // P1's plate as P1 sees it, and as P2 sees it, agree on what is public.
    expect(p1.yourPlate.cells).toEqual(p2.theirPlate.cells);
    expect(p1.theirPlate.cells).toEqual(p2.yourPlate.cells);
    expect(p1.yourPlate.lives).toBe(p2.theirPlate.lives);
    // But only P2 knows what is still armed in P1's plate.
    expect(p2.theirPlate.yourBombs).toEqual([1, 3, 5]);
  });
});

/**
 * The strongest statement available: serialise the view, then check the bytes
 * are compatible with EVERY hidden layout that has not been contradicted.
 */
describe('information leakage', () => {
  it('produces an identical payload for every layout consistent with what is eaten', () => {
    // P1 has eaten chips 0 and 2 and both were safe, so any layout P2 could
    // have planted that avoids 0 and 2 is still possible — and all of them must
    // look exactly the same to P1.
    const consistent = ALL_CONFIGS.filter((config) => !config.includes(0) && !config.includes(2));
    expect(consistent.length).toBeGreaterThan(20);

    const payloads = new Set<string>();
    for (const againstP1 of consistent) {
      // P1's own planting is held fixed: that part of the payload is meant to vary.
      let state = armed([4, 6, 8], [...againstP1]);
      state = bite(state, 'P1', 0);
      state = bite(state, 'P2', 3);
      state = bite(state, 'P1', 2);
      payloads.add(JSON.stringify(toPlayerView(state, 'P1')));
    }
    expect(payloads.size).toBe(1);
  });

  it('leaks nothing across every legal layout, at every depth of play', () => {
    const rng = createSeededRng(99);
    for (const againstP1 of ALL_CONFIGS) {
      let state = armed([0, 1, 2], [...againstP1]);
      const order = rng.shuffled(CHIP_INDICES);
      for (const target of order) {
        if (state.phase !== 'PLAYING') break;
        if (state.currentTurn !== 'P1') state = bite(state, 'P2', target);
        if (state.phase !== 'PLAYING') break;
        state = bite(state, 'P1', target);

        const view = toPlayerView(state, 'P1');
        if (view.phase === 'ENDED') break;
        for (const index of CHIP_INDICES) {
          const cell = view.yourPlate.cells[index]!;
          const wasEaten = state.plates.P1.eaten.includes(index);
          // A chip is described exactly when it has been eaten, never before.
          expect(cell.state === 'HIDDEN').toBe(!wasEaten);
          if (!wasEaten) expect(cell.order).toBeUndefined();
        }
      }
    }
  });

  it('keeps your plate dark even when you are down to your last life', () => {
    let state = armed([0, 1, 2], [3, 4, 5]);
    state = bite(state, 'P1', 3);
    state = bite(state, 'P2', 8);
    state = bite(state, 'P1', 4);
    const view = toPlayerView(state, 'P1');
    expect(view.yourPlate.lives).toBe(1);
    const hidden = CHIP_INDICES.filter((i) => view.yourPlate.cells[i]!.state === 'HIDDEN');
    // Seven chips left, exactly one of them fatal — and the view says nothing
    // about which. Even a perfect player faces a 1-in-7 bite.
    expect(hidden).toEqual([0, 1, 2, 5, 6, 7, 8]);
    expect(view.finalReveal).toBeNull();
  });
});

describe('the payload cannot be mined', () => {
  it('carries no positional data about the bombs waiting for you', () => {
    let state = armed([0, 1, 2], [2, 5, 7]);
    state = bite(state, 'P1', 2); // set one off on purpose
    const view: PlayerView = toPlayerView(state, 'P1');

    const own = JSON.parse(JSON.stringify(view.yourPlate)) as unknown;
    const numbers: number[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'number') numbers.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(own);
    // Only counters and eat-order survive; there is no positional payload.
    expect(numbers.every((value) => value >= 0 && value <= 9)).toBe(true);
    expect(view.yourPlate.cells.filter((cell) => cell.state !== 'HIDDEN')).toHaveLength(1);
    expect(Object.keys(view.yourPlate).sort()).toEqual(['cells', 'lives', 'livesLost']);
  });

  it('does hand you your own traps, because those are yours to know', () => {
    const view = toPlayerView(armed([1, 5, 6], [0, 3, 8]), 'P1');
    expect(view.theirPlate.yourBombs).toEqual([1, 5, 6]);
    const chipIndices: ChipIndex[] = [1, 5, 6];
    expect(view.theirPlate.yourBombs).toEqual(chipIndices);
  });
});
