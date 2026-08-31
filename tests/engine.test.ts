import { describe, expect, it } from 'vitest';
import {
  applySetupTimeout,
  applyTurnTimeout,
  BOMB_COUNT,
  bothWantRematch,
  CHIP_COUNT,
  CHIP_INDICES,
  createGame,
  createPlayer,
  createRematch,
  createSeededRng,
  DEFAULT_MULTIPLAYER_RULES,
  eatChip,
  endGame,
  getLives,
  getLivesLost,
  getNextPlayer,
  getRemainingChips,
  getWinner,
  isBomb,
  isEliminated,
  isGameOver,
  isValidBombPlacement,
  plantBombs,
  randomBombPositions,
  requestRematch,
  SAFE_COUNT,
  STARTING_LIVES,
  validateMove,
  type ChipIndex,
  type GameState,
  type Slot,
} from '@bbc/shared';

const human = createPlayer({ id: 'a', name: 'Ada' });
const rival = createPlayer({ id: 'b', name: 'Bo' });

function newGame(overrides: Partial<Parameters<typeof createGame>[0]> = {}): GameState {
  return createGame({
    gameId: 'g1',
    mode: 'FRIEND',
    p1: human,
    p2: rival,
    firstTurn: 'P1',
    now: 1_000,
    ...overrides,
  });
}

/**
 * `p1Plants` is where P1 hides bombs — which means those bombs end up in P2's
 * PLATE. Keeping that straight is the whole point of the game, so the fixture
 * names it explicitly rather than saying "P1's bombs".
 */
function armed(p1Plants: number[], p2Plants: number[], overrides = {}): GameState {
  let state = newGame(overrides);
  const first = plantBombs(state, 'P1', p1Plants, 1_000);
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error('unreachable');
  state = first.value.state;
  const second = plantBombs(state, 'P2', p2Plants, 1_000);
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error('unreachable');
  return second.value.state;
}

function bite(state: GameState, slot: Slot, index: number, now = 2_000): GameState {
  const result = eatChip(state, slot, index, now);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`bite rejected: ${result.code}`);
  return result.value.state;
}

describe('board shape', () => {
  it('is a 3x3 plate of 9 chips holding 3 bombs and 6 safe chips', () => {
    expect(CHIP_COUNT).toBe(9);
    expect(CHIP_INDICES).toHaveLength(9);
    expect(BOMB_COUNT).toBe(3);
    expect(SAFE_COUNT).toBe(6);
    expect(STARTING_LIVES).toBe(3);
    expect(BOMB_COUNT + SAFE_COUNT).toBe(CHIP_COUNT);
  });

  it('generates exactly 3 distinct in-range bombs, every time', () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 500; i += 1) {
      const bombs = randomBombPositions(rng);
      expect(bombs).toHaveLength(BOMB_COUNT);
      expect(new Set(bombs).size).toBe(BOMB_COUNT);
      expect(bombs.every((index) => index >= 0 && index < CHIP_COUNT)).toBe(true);
    }
  });

  it('spreads random placement across every cell', () => {
    const rng = createSeededRng(11);
    const counts = new Array<number>(9).fill(0);
    for (let i = 0; i < 6_000; i += 1) {
      for (const index of randomBombPositions(rng)) counts[index] += 1;
    }
    for (const count of counts) expect(count).toBeGreaterThan(1_700);
    for (const count of counts) expect(count).toBeLessThan(2_300);
  });
});

describe('planting', () => {
  it('puts YOUR bombs in the OPPONENT plate, never your own', () => {
    const result = plantBombs(newGame(), 'P1', [0, 4, 8]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const state = result.value.state;
    // P1 planted, so P2 is the one who will be eating them.
    expect(state.plates.P2.bombs).toEqual([0, 4, 8]);
    expect(state.plates.P1.bombs).toEqual([]);
    expect(state.bombsPlanted).toEqual({ P1: true, P2: false });
    expect(result.value.events).toEqual([{ type: 'BOMBS_PLANTED', by: 'P1' }]);
  });

  it('gives each player a plate rigged only by the other', () => {
    const state = armed([0, 1, 2], [6, 7, 8]);
    expect(state.plates.P2.bombs).toEqual([0, 1, 2]); // P1 planted these
    expect(state.plates.P1.bombs).toEqual([6, 7, 8]); // P2 planted these
  });

  it.each([
    ['too few', [0, 1]],
    ['too many', [0, 1, 2, 3]],
    ['duplicated', [0, 0, 1]],
    ['out of range high', [0, 1, 9]],
    ['out of range low', [-1, 1, 2]],
    ['fractional', [0.5, 1, 2]],
  ])('rejects %s placements', (_label, positions) => {
    expect(isValidBombPlacement(positions)).toBe(false);
    const result = plantBombs(newGame(), 'P1', positions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_BOMB_PLACEMENT');
  });

  it('refuses a second planting from the same player', () => {
    const once = plantBombs(newGame(), 'P1', [0, 1, 2]);
    if (!once.ok) throw new Error('unreachable');
    const twice = plantBombs(once.value.state, 'P1', [3, 4, 5]);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.code).toBe('BOMBS_ALREADY_PLACED');
  });

  it('starts the match only once both plates are rigged', () => {
    const first = plantBombs(newGame(), 'P1', [0, 1, 2], 5_000);
    if (!first.ok) throw new Error('unreachable');
    expect(first.value.state.phase).toBe('SETUP');

    const second = plantBombs(first.value.state, 'P2', [6, 7, 8], 5_000);
    if (!second.ok) throw new Error('unreachable');
    expect(second.value.state.phase).toBe('PLAYING');
    expect(second.value.state.turnNumber).toBe(1);
    expect(second.value.events.map((event) => event.type)).toEqual([
      'BOMBS_PLANTED',
      'GAME_START',
      'TURN_CHANGED',
    ]);
    expect(second.value.state.deadline).toBe(5_000 + DEFAULT_MULTIPLAYER_RULES.turnTimeLimitMs!);
  });

  it('cannot plant once the game is running', () => {
    const late = plantBombs(armed([0, 1, 2], [6, 7, 8]), 'P1', [3, 4, 5]);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.code).toBe('WRONG_PHASE');
  });
});

describe('move validation', () => {
  it('accepts an untouched chip on your turn', () => {
    expect(validateMove(armed([0, 1, 2], [6, 7, 8]), 'P1', 3).ok).toBe(true);
  });

  it('rejects a bite taken out of turn', () => {
    const result = validateMove(armed([0, 1, 2], [6, 7, 8]), 'P2', 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_YOUR_TURN');
  });

  it.each([-1, 9, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects chip index %s', (index) => {
    const result = validateMove(armed([0, 1, 2], [6, 7, 8]), 'P1', index);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_CHIP');
  });

  it('rejects a chip that has already been eaten', () => {
    let state = armed([0, 1, 2], [6, 7, 8]);
    state = bite(state, 'P1', 3);
    state = bite(state, 'P2', 3);
    const result = validateMove(state, 'P1', 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ALREADY_REVEALED');
  });

  it('rejects moves before setup finishes and after the game ends', () => {
    const early = validateMove(newGame(), 'P1', 0);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe('WRONG_PHASE');

    const finished = endGame(armed([0, 1, 2], [6, 7, 8]), 'P1', 'ELIMINATED').state;
    const late = validateMove(finished, 'P1', 0);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.code).toBe('GAME_IS_OVER');
  });

  it('eats from your OWN plate, never the opponent one', () => {
    // P2 planted at 6,7,8, so those are the bombs in P1's plate.
    const state = armed([0, 1, 2], [6, 7, 8]);
    const result = eatChip(state, 'P1', 6);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.state.plates.P1.eaten).toEqual([6]);
    expect(result.value.state.plates.P2.eaten).toEqual([]);
    // And it was a bomb, because P2 put one there.
    expect(result.value.events[0]).toMatchObject({ type: 'CHIP_EATEN', by: 'P1', isBomb: true });
  });
});

describe('eating', () => {
  it('reports a safe chip and passes the turn', () => {
    const state = armed([0, 1, 2], [6, 7, 8]);
    const result = eatChip(state, 'P1', 3, 9_000);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.events[0]).toEqual({
      type: 'CHIP_EATEN',
      by: 'P1',
      index: 3,
      isBomb: false,
    });
    expect(result.value.state.currentTurn).toBe('P2');
    expect(result.value.state.turnNumber).toBe(2);
    expect(getLives(result.value.state, 'P1')).toBe(3);
  });

  it('costs a life on a bomb, and STILL passes the turn', () => {
    const state = armed([0, 1, 2], [6, 7, 8]);
    const result = eatChip(state, 'P1', 6);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.events.map((event) => event.type)).toEqual([
      'CHIP_EATEN',
      'BOMB_HIT',
      'TURN_CHANGED',
    ]);
    expect(result.value.events[1]).toEqual({
      type: 'BOMB_HIT',
      victim: 'P1',
      index: 6,
      livesLeft: 2,
    });
    expect(getLives(result.value.state, 'P1')).toBe(2);
    expect(getLivesLost(result.value.state, 'P1')).toBe(1);
    expect(result.value.state.currentTurn).toBe('P2');
  });

  it('tracks each player lives independently', () => {
    let state = armed([0, 1, 2], [6, 7, 8]);
    state = bite(state, 'P1', 6); // P1 bites a bomb P2 planted
    state = bite(state, 'P2', 0); // P2 bites a bomb P1 planted
    state = bite(state, 'P1', 7); // P1 again
    expect(getLives(state, 'P1')).toBe(1);
    expect(getLives(state, 'P2')).toBe(2);
  });

  it('shrinks the plate as chips are eaten', () => {
    let state = armed([0, 1, 2], [6, 7, 8]);
    expect(getRemainingChips(state, 'P1')).toHaveLength(9);
    state = bite(state, 'P1', 3);
    expect(getRemainingChips(state, 'P1')).toHaveLength(8);
    expect(getRemainingChips(state, 'P1')).not.toContain(3);
    expect(getRemainingChips(state, 'P2')).toHaveLength(9);
  });

  it('exposes truth helpers only to the server side', () => {
    const state = armed([0, 1, 2], [6, 7, 8]);
    expect(isBomb(state, 'P1', 6)).toBe(true); // P2 planted 6 in P1's plate
    expect(isBomb(state, 'P1', 0)).toBe(false);
    expect(getNextPlayer(state)).toBe('P2');
  });

  it('records history entries for every bite', () => {
    let state = armed([0, 1, 2], [6, 7, 8]);
    state = bite(state, 'P1', 6, 11_000);
    state = bite(state, 'P2', 5, 12_000);
    expect(state.history).toEqual([
      { turnNumber: 1, by: 'P1', index: 6, wasBomb: true, at: 11_000 },
      { turnNumber: 2, by: 'P2', index: 5, wasBomb: false, at: 12_000 },
    ]);
  });
});

describe('elimination', () => {
  it('ends the game when a player eats their third bomb, and the OTHER one wins', () => {
    let state = armed([0, 1, 2], [6, 7, 8]);
    state = bite(state, 'P1', 6);
    state = bite(state, 'P2', 3);
    state = bite(state, 'P1', 7);
    state = bite(state, 'P2', 4);
    expect(isGameOver(state)).toBe(false);
    expect(getLives(state, 'P1')).toBe(1);

    const final = eatChip(state, 'P1', 8);
    if (!final.ok) throw new Error('unreachable');
    expect(isGameOver(final.value.state)).toBe(true);
    // P1 blew themselves up, so P2 takes it.
    expect(getWinner(final.value.state)).toBe('P2');
    expect(isEliminated(final.value.state, 'P1')).toBe(true);
    expect(getLives(final.value.state, 'P1')).toBe(0);
    expect(final.value.state.endReason).toBe('ELIMINATED');
    expect(final.value.events.at(-1)).toEqual({
      type: 'GAME_OVER',
      winner: 'P2',
      reason: 'ELIMINATED',
    });
    // No TURN_CHANGED after the fatal bite.
    expect(final.value.events.map((event) => event.type)).not.toContain('TURN_CHANGED');
  });

  it('lets the second player be eliminated too', () => {
    let state = armed([0, 1, 2], [6, 7, 8]);
    state = bite(state, 'P1', 3);
    state = bite(state, 'P2', 0);
    state = bite(state, 'P1', 4);
    state = bite(state, 'P2', 1);
    state = bite(state, 'P1', 5);
    state = bite(state, 'P2', 2);
    expect(getWinner(state)).toBe('P1');
  });

  it('always resolves within 9 bites each, because 9 chips hold 3 bombs', () => {
    let state = armed([0, 4, 8], [1, 3, 5]);
    let moves = 0;
    let turn: Slot = 'P1';
    while (!isGameOver(state) && moves < 40) {
      const remaining = getRemainingChips(state, turn);
      state = bite(state, turn, remaining[0] as ChipIndex);
      turn = state.currentTurn;
      moves += 1;
    }
    expect(isGameOver(state)).toBe(true);
    expect(moves).toBeLessThanOrEqual(18);
  });

  it('ends by forfeit when an opponent leaves', () => {
    const ended = endGame(armed([0, 1, 2], [6, 7, 8]), 'P2', 'OPPONENT_LEFT', 50_000);
    expect(ended.state.phase).toBe('ENDED');
    expect(ended.state.winner).toBe('P2');
    expect(ended.state.endedAt).toBe(50_000);
    expect(ended.state.deadline).toBeNull();
    expect(endGame(ended.state, 'P1', 'OPPONENT_LEFT').events).toEqual([]);
  });
});

describe('timeouts', () => {
  it('takes a random remaining chip when the turn clock runs out', () => {
    const rng = createSeededRng(3);
    const state = armed([0, 1, 2], [6, 7, 8], { now: 0 });
    expect(applyTurnTimeout(state, rng, 1_000)).toBeNull();

    const timed = applyTurnTimeout(state, rng, 999_999);
    expect(timed).not.toBeNull();
    expect(timed!.events[0]).toEqual({ type: 'TURN_TIMEOUT', slot: 'P1' });
    // The forced bite comes off the idle player's OWN plate.
    expect(timed!.state.plates.P1.eaten).toHaveLength(1);
    expect(timed!.state.plates.P2.eaten).toHaveLength(0);
    expect(timed!.state.currentTurn).toBe('P2');
  });

  it('auto-plants missing bombs when the setup clock runs out', () => {
    const rng = createSeededRng(5);
    const timed = applySetupTimeout(newGame({ now: 0 }), rng, 999_999);
    expect(timed).not.toBeNull();
    expect(timed!.state.phase).toBe('PLAYING');
    expect(timed!.state.plates.P1.bombs).toHaveLength(3);
    expect(timed!.state.plates.P2.bombs).toHaveLength(3);
  });

  it('has no clocks at all in bot mode', () => {
    const state = createGame({ gameId: 'g', mode: 'BOT', p1: human, p2: rival });
    expect(state.rules.turnTimeLimitMs).toBeNull();
    expect(state.deadline).toBeNull();
    expect(applyTurnTimeout(state, createSeededRng(1), 10 ** 12)).toBeNull();
  });
});

describe('rematch', () => {
  it('needs both players to agree', () => {
    const finished = endGame(armed([0, 1, 2], [6, 7, 8]), 'P1', 'ELIMINATED').state;
    const first = requestRematch(finished, 'P1');
    if (!first.ok) throw new Error('unreachable');
    expect(bothWantRematch(first.value)).toBe(false);

    const second = requestRematch(first.value, 'P2');
    if (!second.ok) throw new Error('unreachable');
    expect(bothWantRematch(second.value)).toBe(true);
  });

  it('is idempotent, so a double click cannot break it', () => {
    const finished = endGame(armed([0, 1, 2], [6, 7, 8]), 'P1', 'ELIMINATED').state;
    const once = requestRematch(finished, 'P1');
    if (!once.ok) throw new Error('unreachable');
    const twice = requestRematch(once.value, 'P1');
    if (!twice.ok) throw new Error('unreachable');
    expect(twice.value.rematch).toEqual({ P1: true, P2: false });
  });

  it('refuses a rematch while the game is still running', () => {
    const result = requestRematch(armed([0, 1, 2], [6, 7, 8]), 'P1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_PHASE');
  });

  it('creates a clean game and hands the first bite to the WINNER', () => {
    const finished = endGame(armed([0, 1, 2], [6, 7, 8]), 'P2', 'ELIMINATED').state;
    const next = createRematch(finished, 'g2', 100_000);
    expect(next.gameId).toBe('g2');
    expect(next.phase).toBe('SETUP');
    expect(next.plates.P1.bombs).toEqual([]);
    expect(next.plates.P2.bombs).toEqual([]);
    expect(next.history).toEqual([]);
    expect(next.rematch).toEqual({ P1: false, P2: false });
    // Eating first is the weaker seat, so the winner takes it as a handicap.
    expect(next.currentTurn).toBe('P2');
    expect(next.players.P1.name).toBe('Ada');
  });
});

describe('immutability', () => {
  it('never mutates the state handed to it', () => {
    const state = armed([0, 1, 2], [6, 7, 8]);
    const snapshot = JSON.stringify(state);
    eatChip(state, 'P1', 6);
    plantBombs(state, 'P1', [3, 4, 5]);
    requestRematch(state, 'P1');
    endGame(state, 'P1', 'OPPONENT_LEFT');
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
