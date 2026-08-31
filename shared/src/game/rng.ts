/**
 * Random number sources.
 *
 * Two implementations share one interface:
 *  - `createSecureRng()`  -> CSPRNG (WebCrypto, present in Node 20+ and browsers).
 *                            Used for real bomb placement so positions are not guessable.
 *  - `createSeededRng(n)` -> deterministic mulberry32. Used by tests and by bot
 *                            simulations, never for real bomb placement.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive), free of modulo bias. */
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffled<T>(items: readonly T[]): T[];
}

function fromFloat(next: () => number): Rng {
  const rng: Rng = {
    next,
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`int() needs a positive integer bound, got ${maxExclusive}`);
      }
      return Math.floor(next() * maxExclusive) % maxExclusive;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('pick() on empty array');
      return items[rng.int(items.length)] as T;
    },
    shuffled<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = rng.int(i + 1);
        const a = out[i] as T;
        out[i] = out[j] as T;
        out[j] = a;
      }
      return out;
    },
  };
  return rng;
}

/** Deterministic, fast, good enough for simulations. Never used for real bombs. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return fromFloat(() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

/** Structural type, so this module needs neither the DOM nor the Node lib. */
interface RandomSource {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

const cryptoSource: RandomSource | undefined = (globalThis as { crypto?: RandomSource }).crypto;

/**
 * Cryptographically secure source. Integers use rejection sampling so every
 * value in range is exactly equally likely — a modulo fold would bias bomb
 * placement, which is precisely the thing a competitive player could exploit.
 */
export function createSecureRng(): Rng {
  if (!cryptoSource?.getRandomValues) {
    throw new Error('WebCrypto unavailable: refusing to place bombs with a weak RNG');
  }
  const buf = new Uint32Array(1);
  const draw = (): number => {
    cryptoSource.getRandomValues(buf);
    return buf[0] as number;
  };
  const base = fromFloat(() => draw() / 4294967296);
  return {
    ...base,
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`int() needs a positive integer bound, got ${maxExclusive}`);
      }
      const limit = Math.floor(4294967296 / maxExclusive) * maxExclusive;
      let value = draw();
      while (value >= limit) value = draw();
      return value % maxExclusive;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('pick() on empty array');
      return items[this.int(items.length)] as T;
    },
    shuffled<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = this.int(i + 1);
        const a = out[i] as T;
        out[i] = out[j] as T;
        out[j] = a;
      }
      return out;
    },
  };
}
