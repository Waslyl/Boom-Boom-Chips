/**
 * The four difficulties.
 *
 * The ladder is NOT "how much the bot is allowed to see" — every rung gets the
 * identical redacted `PlayerView`. It is "how good the bot's model of a person
 * is", on both sides of the game:
 *
 *   EASY    no model. Bites at random, plants at random.
 *   NORMAL  a softened model, sampled rather than maximised. It plays the odds
 *           but drifts, so it is beatable without feeling silly.
 *   HARD    full model, exact inference. Eats the chip least likely to be
 *           trapped, and plants where people reach.
 *   EXPERT  the same, but the model is updated from THIS opponent's behaviour
 *           within the game and across a rematch chain.
 */
import { BOMB_COUNT, CHIP_INDICES, type ChipIndex } from '../types/core.js';
import type { PlayerView } from '../types/game.js';
import type { Rng } from '../game/rng.js';
import {
  argminWithRandomTies,
  bombProbabilities,
  eatingAffinity,
  HUMAN_BELIEF,
  HUMAN_EAT_AFFINITY,
  observe,
  plantingAffinity,
  plantWeight,
  sampleWeighted,
  UNIFORM_BELIEF,
  withCellAffinity,
  ALL_CONFIGS,
} from './model.js';
import type { BotStrategy } from './types.js';

function thinkRange(rng: Rng, min: number, max: number): number {
  return Math.round(min + rng.next() * (max - min));
}

/**
 * Plant where the modelled opponent is most likely to bite, sampled rather than
 * fixed. A deterministic "best" trap would be learned in two games.
 */
function plantAgainst(appetite: readonly number[], rng: Rng, temperature: number): ChipIndex[] {
  const config = sampleWeighted(ALL_CONFIGS, (c) => plantWeight(c, appetite), rng, temperature);
  return [...config].sort((a, b) => a - b);
}

function remainingChips(view: PlayerView): readonly ChipIndex[] {
  const { hidden } = observe(view);
  if (hidden.length === 0) throw new Error('bot asked to eat with an empty plate');
  return hidden;
}

const easy: BotStrategy = {
  difficulty: 'EASY',
  plantBombs: (rng) =>
    rng
      .shuffled(CHIP_INDICES)
      .slice(0, BOMB_COUNT)
      .sort((a, b) => a - b),
  chooseMove: (view, rng) => rng.pick(remainingChips(view)),
  thinkTimeMs: (rng) => thinkRange(rng, 550, 1150),
};

const normal: BotStrategy = {
  difficulty: 'NORMAL',
  plantBombs: (rng) => plantAgainst(HUMAN_EAT_AFFINITY, rng, 2.6),
  chooseMove: (view, rng) => {
    const observations = observe(view);
    const probabilities = bombProbabilities(observations, HUMAN_BELIEF);
    // Inverse risk, not (1 - risk): probabilities cluster near 1/3, so the
    // complement barely separates them while the reciprocal does.
    return sampleWeighted(
      observations.hidden,
      (index) => 1 / ((probabilities[index] ?? 0) + 0.02),
      rng,
      0.8,
    );
  },
  thinkTimeMs: (rng) => thinkRange(rng, 600, 1300),
};

const hard: BotStrategy = {
  difficulty: 'HARD',
  plantBombs: (rng) => plantAgainst(HUMAN_EAT_AFFINITY, rng, 1.25),
  chooseMove: (view, rng) => {
    const observations = observe(view);
    const probabilities = bombProbabilities(observations, HUMAN_BELIEF);
    return argminWithRandomTies(observations.hidden, (index) => probabilities[index] ?? 0, rng);
  },
  thinkTimeMs: (rng) => thinkRange(rng, 700, 1500),
};

const expert: BotStrategy = {
  difficulty: 'EXPERT',
  plantBombs: (rng, memory) => plantAgainst(eatingAffinity(memory.eatAffinity), rng, 1.15),
  chooseMove: (view, rng, memory) => {
    const observations = observe(view);
    const belief = withCellAffinity(
      HUMAN_BELIEF,
      plantingAffinity(view, memory.eatAffinity, memory.plantAffinity),
    );
    const probabilities = bombProbabilities(observations, belief);
    return argminWithRandomTies(observations.hidden, (index) => probabilities[index] ?? 0, rng);
  },
  thinkTimeMs: (rng) => thinkRange(rng, 800, 1600),
};

export const STRATEGIES = { EASY: easy, NORMAL: normal, HARD: hard, EXPERT: expert } as const;

/** Exposed so tests can assert EASY really is the no-information baseline. */
export const BASELINE_BELIEF = UNIFORM_BELIEF;
