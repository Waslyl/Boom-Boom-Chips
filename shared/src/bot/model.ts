/**
 * The opponent model.
 *
 * A note on why this exists at all: with three bombs among nine chips and no
 * other information, EVERY unbitten chip is exactly equally likely to be a
 * bomb. Board analysis alone therefore cannot make a bot safer — the maths is
 * symmetric. Skill in Boom Boom Chips comes from predicting where a *person*
 * plants, and from planting where a person is going to bite.
 *
 * So the model here is explicitly a model of human behaviour, applied through
 * exact Bayesian inference over all 84 possible bomb configurations. Nothing in
 * this file reads hidden state; it only consumes a `PlayerView`.
 *
 * Two distinct beliefs live here, and conflating them makes a bot measurably
 * worse:
 *   PLANTING belief — where a person hides bombs. Used to decide what to eat.
 *   EATING belief   — where a person bites first. Used to decide where to plant.
 */
import { areOrthogonallyAdjacent, CHIP_INDICES, type ChipIndex } from '../types/core.js';
import type { PlayerView } from '../types/game.js';
import type { Rng } from '../game/rng.js';

export type Config = readonly [ChipIndex, ChipIndex, ChipIndex];

/** All C(9,3) = 84 ways to place three bombs. Enumerated once at module load. */
export const ALL_CONFIGS: readonly Config[] = (() => {
  const out: Config[] = [];
  for (let a = 0; a < 9; a += 1) {
    for (let b = a + 1; b < 9; b += 1) {
      for (let c = b + 1; c < 9; c += 1) {
        out.push([a as ChipIndex, b as ChipIndex, c as ChipIndex]);
      }
    }
  }
  return out;
})();

const LINES: readonly (readonly ChipIndex[])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
];

const DIAGONALS: readonly (readonly ChipIndex[])[] = [
  [0, 4, 8],
  [2, 4, 6],
];

/**
 * How the modelled opponent chooses where to plant.
 *
 * `cellAffinity` is per-cell taste; the three factors are shape effects applied
 * to a whole configuration. All values are relative weights, not probabilities.
 */
export interface PlacementBelief {
  readonly cellAffinity: readonly number[];
  /** Applied when all three bombs sit on one row or column. */
  readonly straightLineFactor: number;
  /** Applied when all three sit on a diagonal. */
  readonly diagonalFactor: number;
  /** Applied once per orthogonally touching pair. */
  readonly adjacencyFactor: number;
}

const FLAT_AFFINITY: readonly number[] = [1, 1, 1, 1, 1, 1, 1, 1, 1];

/** No beliefs at all: the honest posterior when you know nothing about anyone. */
export const UNIFORM_BELIEF: PlacementBelief = {
  cellAffinity: FLAT_AFFINITY,
  straightLineFactor: 1,
  diagonalFactor: 1,
  adjacencyFactor: 1,
};

/**
 * Where a person plants bombs in someone else's plate. Corners feel like good
 * traps, the centre feels too obvious, three in a straight line feels too neat,
 * and a diagonal feels clever — which is why it is over-played.
 * These are heuristics, deliberately mild, and they are the bot's *belief*
 * about a person, never a claim about the real distribution.
 */
export const HUMAN_CELL_AFFINITY: readonly number[] = [
  1.3, 1.0, 1.3, //
  1.0, 0.75, 1.0, //
  1.3, 1.0, 1.3,
];

export const HUMAN_BELIEF: PlacementBelief = {
  cellAffinity: HUMAN_CELL_AFFINITY,
  straightLineFactor: 0.5,
  diagonalFactor: 1.35,
  adjacencyFactor: 0.78,
};

/**
 * Where a person bites first on their own plate. Distinct from where they
 * plant: reaching for a corner is a different instinct from booby-trapping one,
 * and people gravitate to the centre when the choice is theirs to eat.
 */
export const HUMAN_EAT_AFFINITY: readonly number[] = [
  1.15, 0.95, 1.15, //
  0.95, 1.25, 0.95, //
  1.15, 0.95, 1.15,
];

/** Pull a belief part-way back toward uniform. `strength` of 0 returns uniform. */
export function dampenBelief(belief: PlacementBelief, strength: number): PlacementBelief {
  const soften = (value: number): number => Math.pow(value, strength);
  return {
    cellAffinity: belief.cellAffinity.map(soften),
    straightLineFactor: soften(belief.straightLineFactor),
    diagonalFactor: soften(belief.diagonalFactor),
    adjacencyFactor: soften(belief.adjacencyFactor),
  };
}

export function withCellAffinity(
  belief: PlacementBelief,
  cellAffinity: readonly number[],
): PlacementBelief {
  return { ...belief, cellAffinity };
}

function isSameSet(config: Config, line: readonly ChipIndex[]): boolean {
  return line.every((cell) => config.includes(cell));
}

/** Relative likelihood that the modelled opponent plants this exact layout. */
export function configPrior(config: Config, belief: PlacementBelief): number {
  let weight = 1;
  for (const cell of config) weight *= belief.cellAffinity[cell] ?? 1;
  for (const line of LINES) if (isSameSet(config, line)) weight *= belief.straightLineFactor;
  for (const diagonal of DIAGONALS) if (isSameSet(config, diagonal)) weight *= belief.diagonalFactor;
  for (let i = 0; i < config.length; i += 1) {
    for (let j = i + 1; j < config.length; j += 1) {
      if (areOrthogonallyAdjacent(config[i] as ChipIndex, config[j] as ChipIndex)) {
        weight *= belief.adjacencyFactor;
      }
    }
  }
  return weight;
}

export interface Observations {
  /** Cells confirmed to hold a bomb — already bitten, already paid for. */
  readonly bombs: readonly ChipIndex[];
  /** Cells confirmed safe. */
  readonly safe: readonly ChipIndex[];
  /** Chips still on the plate. */
  readonly hidden: readonly ChipIndex[];
}

/**
 * Read the public facts about the plate the bot has to eat from. This is the
 * plate whose bombs the OPPONENT planted, which is the only thing the bot has
 * to reason about when deciding what is safe to bite.
 */
export function observe(view: PlayerView): Observations {
  const bombs: ChipIndex[] = [];
  const safe: ChipIndex[] = [];
  const hidden: ChipIndex[] = [];
  for (const index of CHIP_INDICES) {
    const cell = view.yourPlate.cells[index];
    if (cell?.state === 'BOMB') bombs.push(index);
    else if (cell?.state === 'SAFE') safe.push(index);
    else hidden.push(index);
  }
  return { bombs, safe, hidden };
}

/**
 * Exact posterior P(cell holds a bomb | everything bitten so far), under the
 * supplied belief. 84 configurations is small enough to enumerate every turn
 * without measurable cost.
 *
 * Under `UNIFORM_BELIEF` this reduces to the hypergeometric answer: remaining
 * bombs spread evenly over remaining chips. That is the honest baseline.
 */
export function bombProbabilities(
  observations: Observations,
  belief: PlacementBelief = UNIFORM_BELIEF,
): number[] {
  const totals = new Array<number>(9).fill(0);
  let normaliser = 0;

  for (const config of ALL_CONFIGS) {
    // Consistency: must contain every bomb already bitten, and no known-safe cell.
    let consistent = true;
    for (const bomb of observations.bombs) {
      if (!config.includes(bomb)) {
        consistent = false;
        break;
      }
    }
    if (consistent) {
      for (const safe of observations.safe) {
        if (config.includes(safe)) {
          consistent = false;
          break;
        }
      }
    }
    if (!consistent) continue;

    const weight = configPrior(config, belief);
    normaliser += weight;
    for (const cell of config) totals[cell] = (totals[cell] ?? 0) + weight;
  }

  if (normaliser <= 0) {
    // Should be unreachable: at least one configuration always survives.
    return CHIP_INDICES.map((index) => (observations.hidden.includes(index) ? 1 / 9 : 0));
  }
  return totals.map((total) => total / normaliser);
}

/** Laplace smoothing: a cell nobody has touched yet is weak evidence, not proof. */
const ALPHA = 0.5;

function share(counts: readonly number[], total: number, index: number): number {
  return total > 0 ? (((counts[index] ?? 0) + ALPHA) / (total + 9 * ALPHA)) * 9 : 1;
}

/**
 * Where this particular person seems to PLANT, used to decide what to eat.
 *
 * Two public signals feed it. Across games, the layouts they actually planted,
 * revealed to both players at the end. Within a game, the order they bite their
 * own plate: people plant where they themselves would reach, so their appetite
 * leaks their intent. The second signal is deliberately weak — it is a
 * correlation, not a tell.
 */
export function plantingAffinity(
  view: PlayerView,
  eatAffinity: readonly number[],
  plantAffinity: readonly number[],
  strength = 1,
): number[] {
  const liveEating = [...eatAffinity];
  for (const index of CHIP_INDICES) {
    const cell = view.theirPlate.cells[index];
    if (!cell || cell.state === 'HIDDEN' || cell.order === undefined) continue;
    // Earlier bites are stronger evidence of instinct than late ones.
    liveEating[index] = (liveEating[index] ?? 0) + 1 / cell.order;
  }

  const eatTotal = liveEating.reduce((sum, value) => sum + value, 0);
  const plantTotal = plantAffinity.reduce((sum, value) => sum + value, 0);

  // Shrinkage: two data points are not a personality. Each signal earns its
  // influence as evidence accumulates, so a cold bot falls back exactly onto
  // the population prior instead of chasing noise on the first turn.
  const eatWeight = 0.25 * strength * (eatTotal / (eatTotal + 4));
  const plantWeight = 0.75 * strength * (plantTotal / (plantTotal + 10));

  return CHIP_INDICES.map((index) => {
    const base = HUMAN_CELL_AFFINITY[index] ?? 1;
    const eating = share(liveEating, eatTotal, index);
    const planting = share(plantAffinity, plantTotal, index);
    // Geometric blend keeps every factor multiplicative and bounded.
    return base * Math.pow(eating, eatWeight) * Math.pow(planting, plantWeight);
  });
}

/** Where this person seems to BITE, used to decide where to plant. */
export function eatingAffinity(eatAffinity: readonly number[], strength = 1): number[] {
  const total = eatAffinity.reduce((sum, value) => sum + value, 0);
  const weight = 0.8 * strength * (total / (total + 5));
  return CHIP_INDICES.map((index) => {
    const base = HUMAN_EAT_AFFINITY[index] ?? 1;
    return base * Math.pow(share(eatAffinity, total, index), weight);
  });
}

/* ------------------------------------------------------------------ */
/* Planting — a different question from predicting a layout           */
/* ------------------------------------------------------------------ */

/**
 * Structure applied to our OWN layout. Even when planting where they will bite,
 * three in a row is worth avoiding: an opponent who hits two of them starts
 * guessing the third instead of choosing blind.
 */
export const PLANT_STRUCTURE: PlacementBelief = {
  cellAffinity: FLAT_AFFINITY,
  straightLineFactor: 0.55,
  diagonalFactor: 0.6,
  adjacencyFactor: 0.9,
};

/**
 * How good `config` is as a trap against an opponent whose per-cell appetite is
 * `appetite` (higher = they bite there more often). Planting is the mirror of
 * eating: you want your bombs exactly where their hand is going.
 */
export function plantWeight(
  config: Config,
  appetite: readonly number[],
  structure: PlacementBelief = PLANT_STRUCTURE,
): number {
  let weight = configPrior(config, structure);
  for (const cell of config) weight *= Math.max(appetite[cell] ?? 1, 1e-9);
  return weight;
}

/** Pick the highest-scoring candidate, breaking ties at random so play is not readable. */
export function argmaxWithRandomTies(
  candidates: readonly ChipIndex[],
  score: (index: ChipIndex) => number,
  rng: Rng,
): ChipIndex {
  let best: ChipIndex[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const value = score(candidate);
    if (value > bestScore + 1e-9) {
      bestScore = value;
      best = [candidate];
    } else if (Math.abs(value - bestScore) <= 1e-9) {
      best.push(candidate);
    }
  }
  if (best.length === 0) throw new RangeError('argmax over an empty candidate set');
  return rng.pick(best);
}

/** The safest bite: lowest probability of a bomb, ties broken at random. */
export function argminWithRandomTies(
  candidates: readonly ChipIndex[],
  score: (index: ChipIndex) => number,
  rng: Rng,
): ChipIndex {
  return argmaxWithRandomTies(candidates, (index) => -score(index), rng);
}

/** Sample proportionally to `weight ** (1 / temperature)`. Higher temperature = looser play. */
export function sampleWeighted<T>(
  items: readonly T[],
  weight: (item: T) => number,
  rng: Rng,
  temperature = 1,
): T {
  if (items.length === 0) throw new RangeError('sampleWeighted over an empty set');
  const exponent = 1 / Math.max(temperature, 1e-6);
  const weights = items.map((item) => Math.pow(Math.max(weight(item), 0), exponent));
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || !Number.isFinite(total)) return rng.pick(items);
  let cursor = rng.next() * total;
  for (let i = 0; i < items.length; i += 1) {
    cursor -= weights[i] as number;
    if (cursor <= 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

/** Draw a layout from a belief — used to simulate an opponent in tests. */
export function sampleConfig(belief: PlacementBelief, rng: Rng, temperature = 1): ChipIndex[] {
  const config = sampleWeighted(ALL_CONFIGS, (c) => configPrior(c, belief), rng, temperature);
  return [...config].sort((a, b) => a - b);
}
