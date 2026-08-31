/**
 * Party codes.
 *
 * 6 characters from a 26-symbol alphabet with every look-alike removed
 * (no O/0, I/1, S/5, B/8, Z/2), which is ~309 million combinations — plenty
 * against guessing when codes also expire, while staying easy to read out loud.
 */
import type { Rng } from '../game/rng.js';

export const PARTY_CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679';
export const PARTY_CODE_LENGTH = 6;

/** Characters users commonly type instead of the real one. */
const CONFUSABLES: Readonly<Record<string, string>> = {
  '0': 'D',
  O: 'D',
  Q: 'Q',
  '1': 'L',
  I: 'L',
  '5': 'F',
  S: 'F',
  '8': 'W',
  B: 'W',
  '2': 'V',
  Z: 'V',
};

export function generatePartyCode(rng: Rng): string {
  let code = '';
  for (let i = 0; i < PARTY_CODE_LENGTH; i += 1) {
    code += PARTY_CODE_ALPHABET[rng.int(PARTY_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Make a typed code canonical: upper-case, strip separators, and fold the
 * classic look-alikes so "party-k7x4p9" and "K7X4P9" reach the same room.
 */
export function normalisePartyCode(input: string): string {
  const stripped = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, PARTY_CODE_LENGTH);
  let out = '';
  for (const char of stripped) {
    if (PARTY_CODE_ALPHABET.includes(char)) out += char;
    else out += CONFUSABLES[char] ?? char;
  }
  return out;
}

export function isValidPartyCode(code: string): boolean {
  if (code.length !== PARTY_CODE_LENGTH) return false;
  return [...code].every((char) => PARTY_CODE_ALPHABET.includes(char));
}
