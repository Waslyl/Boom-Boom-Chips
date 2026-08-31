/**
 * Bot tests.
 *
 * The headline test is `no cheating`: the same redacted view, over every hidden
 * layout consistent with it, must yield the same decision. A strategy that
 * peeked at the bombs waiting in its own plate would fail it instantly.
 *
 * The strength tests are deliberately paired. A bot is only allowed to look
 * good against the population it claims to model; against a genuinely uniform
 * opponent every difficulty must collapse to the same coin-flip, because with
 * 3 bombs among 9 chips and no behavioural signal there is nothing to know.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_CONFIGS,
  BOMB_COUNT,
  BOT_DIFFICULTIES,
  bombProbabilities,
  createBot,
  createBotMemory,
  createGame,
  createPlayer,
  createSeededRng,
  eatChip,
  HUMAN_BELIEF,
  HUMAN_EAT_AFFINITY,
  observe,
  plantBombs,
  rememberGame,
  sampleConfig,
  toPlayerView,
  UNIFORM_BELIEF,
  type BotDifficulty,
  type BotMemory,
  type ChipIndex,
  type GameState,
  type PlayerView,
  type Rng,
  type Slot,
} from '@bbc/shared';

/** `p1Plants` ends up in P2's plate, and vice versa. The bot always sits in P2. */
function armed(p1Plants: readonly number[], p2Plants: readonly number[], first: Slot = 'P1'): GameState {
  const base = createGame({
    gameId: 'g',
    mode: 'BOT',
    p1: createPlayer({ id: 'a', name: 'Ada' }),
    p2: createPlayer({ id: 'b', name: 'Bot', isBot: true }),
    firstTurn: first,
    now: 0,
  });
  const a = plantBombs(base, 'P1', [...p1Plants], 0);
  if (!a.ok) throw new Error('bad fixture');
  const b = plantBombs(a.value.state, 'P2', [...p2Plants], 0);
  if (!b.ok) throw new Error('bad fixture');
  return b.value.state;
}

function playGame(
  difficulty: BotDifficulty,
  humanPlants: readonly number[],
  humanEats: (view: PlayerView, rng: Rng) => ChipIndex,
  rng: Rng,
  memory: BotMemory = createBotMemory(),
  first: Slot = 'P1',
): GameState {
  const bot = createBot(difficulty);
  let state = armed(humanPlants, bot.plantBombs(rng, memory), first);

  let guard = 0;
  while (state.phase === 'PLAYING' && guard < 40) {
    guard += 1;
    const slot: Slot = state.currentTurn;
    const view = toPlayerView(state, slot);
    const index = slot === 'P2' ? bot.chooseMove(view, rng, memory) : humanEats(view, rng);
    const result = eatChip(state, slot, index, 0);
    if (!result.ok) throw new Error(`bot produced an illegal bite: ${result.code}`);
    state = result.value.state;
  }
  expect(state.phase).toBe('ENDED');
  return state;
}

const uniformEater = (view: PlayerView, rng: Rng): ChipIndex => rng.pick(observe(view).hidden);

/** Reaches for the chips that look appetising, which is what the model predicts. */
const humanEater = (view: PlayerView, rng: Rng): ChipIndex => {
  const hidden = observe(view).hidden;
  const total = hidden.reduce((sum, i) => sum + (HUMAN_EAT_AFFINITY[i] ?? 1), 0);
  let cursor = rng.next() * total;
  for (const index of hidden) {
    cursor -= HUMAN_EAT_AFFINITY[index] ?? 1;
    if (cursor <= 0) return index;
  }
  return hidden[hidden.length - 1] as ChipIndex;
};

describe.each(BOT_DIFFICULTIES)('%s bot', (difficulty) => {
  const bot = createBot(difficulty);

  it('reports its own difficulty', () => {
    expect(bot.difficulty).toBe(difficulty);
  });

  it('always plants exactly 3 distinct, in-range bombs', () => {
    const rng = createSeededRng(1234);
    for (let i = 0; i < 400; i += 1) {
      const bombs = bot.plantBombs(rng, createBotMemory());
      expect(bombs).toHaveLength(BOMB_COUNT);
      expect(new Set(bombs).size).toBe(BOMB_COUNT);
      expect(bombs.every((index) => index >= 0 && index <= 8)).toBe(true);
    }
  });

  it('uses many trap patterns, so it cannot be memorised', () => {
    const rng = createSeededRng(4321);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) seen.add(bot.plantBombs(rng, createBotMemory()).join(','));
    expect(seen.size).toBeGreaterThan(8);
  });

  it('only ever eats a chip still on its own plate', () => {
    const rng = createSeededRng(77);
    for (let game = 0; game < 60; game += 1) playGame(difficulty, [0, 4, 8], uniformEater, rng);
  });

  it('finishes every game it starts, from all 84 layouts against it', () => {
    const rng = createSeededRng(2024);
    for (const config of ALL_CONFIGS) {
      expect(playGame(difficulty, config, uniformEater, rng).winner).not.toBeNull();
    }
  });

  it('asks for a plausible thinking time', () => {
    const rng = createSeededRng(5);
    for (let i = 0; i < 100; i += 1) {
      const think = bot.thinkTimeMs(rng);
      expect(think).toBeGreaterThanOrEqual(400);
      expect(think).toBeLessThanOrEqual(2_000);
    }
  });
});

describe('no cheating', () => {
  /**
   * Build one view, then check the decision is stable across every hidden
   * layout that produces that same view. The bot has eaten chips 0 and 4 and
   * survived, so any layout the human could have planted that avoids 0 and 4
   * is still possible — and every one of them must look identical.
   */
  it.each(BOT_DIFFICULTIES)('%s decides from the view alone', (difficulty) => {
    const bot = createBot(difficulty);
    const consistent = ALL_CONFIGS.filter((c) => !c.includes(0) && !c.includes(4));
    const decisions = new Set<ChipIndex>();
    const views = new Set<string>();

    for (const againstBot of consistent) {
      // The bot's own traps are held fixed at 1/3/5, so the human's bites below
      // are all safe and the public half of the view never varies either.
      let state = armed([...againstBot], [1, 3, 5]);
      const script: Array<[Slot, number]> = [
        ['P1', 8],
        ['P2', 0],
        ['P1', 7],
        ['P2', 4],
        ['P1', 6],
      ];
      for (const [slot, index] of script) {
        const step = eatChip(state, slot, index, 0);
        if (!step.ok) throw new Error(`fixture: ${step.code}`);
        state = step.value.state;
      }
      if (state.phase !== 'PLAYING') continue;

      const view = toPlayerView(state, 'P2');
      views.add(JSON.stringify(view));
      // A fresh RNG per iteration: identical seed, identical view.
      decisions.add(bot.chooseMove(view, createSeededRng(42), createBotMemory()));
    }

    expect(views.size).toBe(1); // the fixture really is one single view
    expect(decisions.size).toBe(1); // therefore exactly one decision is possible
  });

  it('is handed a plate with no bomb list in it at all', () => {
    const view = toPlayerView(armed([0, 1, 2], [6, 7, 8]), 'P2');
    expect(Object.keys(view.yourPlate).sort()).toEqual(['cells', 'lives', 'livesLost']);
  });

  /**
   * The decisive fairness check. Against an opponent who really is uniform,
   * behavioural modelling has nothing to grip: every difficulty must land on
   * the same coin-flip.
   */
  it('gains nothing at all against a genuinely random opponent', () => {
    const games = 1_500;
    const rates = BOT_DIFFICULTIES.map((difficulty) => {
      const rng = createSeededRng(2_202);
      let wins = 0;
      for (let i = 0; i < games; i += 1) {
        const plants = sampleConfig(UNIFORM_BELIEF, rng);
        // Eating first is a handicap, so alternate it and let skill show alone.
        const first: Slot = i % 2 === 0 ? 'P1' : 'P2';
        const finished = playGame(
          difficulty,
          plants,
          uniformEater,
          rng,
          createBotMemory(),
          first,
        );
        if (finished.winner === 'P2') wins += 1;
      }
      return wins / games;
    });

    for (const rate of rates) {
      expect(rate).toBeGreaterThan(0.44);
      expect(rate).toBeLessThan(0.56);
    }
    // No difficulty pulls meaningfully ahead: the spread stays inside noise.
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThan(0.07);
  });
});

describe('inference', () => {
  it('treats every remaining chip as equally likely when nothing is known', () => {
    const view = toPlayerView(armed([0, 1, 2], [6, 7, 8]), 'P1');
    const probabilities = bombProbabilities(observe(view), UNIFORM_BELIEF);
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(probabilities[index]).toBeCloseTo(3 / 9, 10);
    }
  });

  it('rules out chips already eaten safely and locks in the ones that went off', () => {
    let state = armed([0, 1, 2], [6, 7, 8]);
    // P1's plate is rigged at 6, 7, 8 (planted by P2).
    for (const [slot, index] of [
      ['P1', 6], // bomb
      ['P2', 0], // bomb (P1 planted 0,1,2)
      ['P1', 0], // safe for P1
    ] as Array<[Slot, number]>) {
      const step = eatChip(state, slot, index, 0);
      if (!step.ok) throw new Error('fixture');
      state = step.value.state;
    }

    const probabilities = bombProbabilities(observe(toPlayerView(state, 'P1')), UNIFORM_BELIEF);
    expect(probabilities[6]).toBeCloseTo(1, 10); // known bomb
    expect(probabilities[0]).toBeCloseTo(0, 10); // known safe
    expect(probabilities[3]).toBeCloseTo(2 / 7, 10); // two bombs across seven chips
  });

  it('probabilities over remaining chips always sum to the bombs still buried', () => {
    const rng = createSeededRng(808);
    let state = armed([0, 1, 2], [2, 4, 6]);
    for (let move = 0; move < 5; move += 1) {
      if (state.phase !== 'PLAYING') break;
      const observations = observe(toPlayerView(state, state.currentTurn));
      const probabilities = bombProbabilities(observations, HUMAN_BELIEF);
      const remaining = BOMB_COUNT - observations.bombs.length;
      const total = observations.hidden.reduce((sum, i) => sum + (probabilities[i] ?? 0), 0);
      expect(total).toBeCloseTo(remaining, 8);

      const next = eatChip(state, state.currentTurn, rng.pick(observations.hidden), 0);
      if (!next.ok) throw new Error('fixture');
      state = next.value.state;
    }
  });

  it('a belief bends the odds without inventing certainty', () => {
    const view = toPlayerView(armed([0, 1, 2], [6, 7, 8]), 'P1');
    const biased = bombProbabilities(observe(view), HUMAN_BELIEF);
    // Corners are modelled as favoured hiding spots, the centre as avoided.
    expect(biased[0]!).toBeGreaterThan(biased[4]!);
    // But nothing is ever ruled in or out on belief alone.
    expect(Math.max(...biased)).toBeLessThan(0.9);
    expect(Math.min(...biased)).toBeGreaterThan(0.05);
    expect(biased.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 8);
  });
});

describe('relative strength', () => {
  /**
   * The same opponents, in the same order, for every rung. Comparing
   * difficulties on independent random streams buries a real 3-point gap in
   * noise; pairing the scenarios means any difference is the bot's doing.
   */
  interface Scenario {
    plants: number[];
    seed: number;
    first: Slot;
  }

  function scenarios(count: number, seed: number): Scenario[] {
    const rng = createSeededRng(seed);
    return Array.from({ length: count }, (_, i) => ({
      plants: sampleConfig(HUMAN_BELIEF, rng),
      seed: Math.floor(rng.next() * 2 ** 31),
      // Eating first is a handicap, so alternate it and let skill show alone.
      first: (i % 2 === 0 ? 'P1' : 'P2') as Slot,
    }));
  }

  function survivalRate(
    difficulty: BotDifficulty,
    cases: readonly Scenario[],
    memory?: BotMemory,
  ): number {
    let wins = 0;
    for (const scenario of cases) {
      const finished = playGame(
        difficulty,
        scenario.plants,
        humanEater,
        createSeededRng(scenario.seed),
        memory ?? createBotMemory(),
        scenario.first,
      );
      if (finished.winner === 'P2') wins += 1;
      if (memory) rememberGame(memory, toPlayerView(finished, 'P2'));
    }
    return wins / cases.length;
  }

  it('gets monotonically stronger up the ladder', () => {
    const cases = scenarios(3_000, 101);
    const easy = survivalRate('EASY', cases);
    const normal = survivalRate('NORMAL', cases);
    const hard = survivalRate('HARD', cases);
    const expert = survivalRate('EXPERT', cases);

    expect(normal).toBeGreaterThan(easy + 0.01);
    expect(hard).toBeGreaterThan(normal + 0.02);
    // EXPERT matches HARD against a population HARD's prior already nails; its
    // edge shows up against an opponent the prior does not predict.
    expect(expert).toBeGreaterThanOrEqual(hard - 0.02);

    // Even the best bot stays beatable: this is a game of hidden information.
    expect(expert).toBeLessThan(0.72);
    // And the weakest is a genuine coin flip, not a pushover.
    expect(easy).toBeGreaterThan(0.44);
    expect(easy).toBeLessThan(0.56);
  });

  it('EXPERT learns an opponent whose habits the population prior gets wrong', () => {
    // This person always plants down the middle column and always eats corners
    // first. The static prior expects the opposite on both counts, so only the
    // per-opponent memory can catch it.
    const quirkyPlants = (rng: Rng): number[] => [1, 4, 7].slice(0, 3).sort(() => rng.next() - 0.5);
    const quirkyEater = (view: PlayerView, rng: Rng): ChipIndex => {
      const hidden = observe(view).hidden;
      const corners = hidden.filter((index) => [0, 2, 6, 8].includes(index));
      return rng.pick(corners.length > 0 ? corners : hidden);
    };

    function rate(useMemory: boolean): number {
      const rng = createSeededRng(9_090);
      const memory = createBotMemory();
      let wins = 0;
      const games = 600;
      for (let i = 0; i < games; i += 1) {
        const active = useMemory ? memory : createBotMemory();
        const first: Slot = i % 2 === 0 ? 'P1' : 'P2';
        const finished = playGame('EXPERT', quirkyPlants(rng), quirkyEater, rng, active, first);
        if (finished.winner === 'P2') wins += 1;
        if (useMemory) rememberGame(memory, toPlayerView(finished, 'P2'));
      }
      return wins / games;
    }

    expect(rate(true)).toBeGreaterThan(rate(false) + 0.03);
  });
});

describe('memory hygiene', () => {
  it('only records a finished game', () => {
    const memory = createBotMemory();
    rememberGame(memory, toPlayerView(armed([0, 1, 2], [6, 7, 8]), 'P2'));
    expect(memory.gamesObserved).toBe(0);
    expect(memory.plantAffinity.every((value) => value === 0)).toBe(true);
  });

  it('records only what both players could already see', () => {
    const rng = createSeededRng(64);
    const finished = playGame('HARD', [0, 4, 8], uniformEater, rng);
    const memory = createBotMemory();
    rememberGame(memory, toPlayerView(finished, 'P2'));
    expect(memory.gamesObserved).toBe(1);
    // The human planted at 0, 4 and 8, and that layout is public once a game ends.
    expect(memory.plantAffinity[0]).toBe(1);
    expect(memory.plantAffinity[4]).toBe(1);
    expect(memory.plantAffinity[8]).toBe(1);
    expect(memory.plantAffinity.reduce((a, b) => a + b, 0)).toBe(3);
  });
});
