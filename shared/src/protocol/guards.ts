/**
 * Inbound message validation.
 *
 * The client is hostile until proven otherwise: every field is checked for
 * type, range and length before the server looks at it. Hand-rolled on
 * purpose — the surface is ten messages wide and a schema library would be a
 * dependency, a bundle and a supply-chain risk for no gain.
 */
import { BOMB_COUNT, isBotDifficulty } from '../types/core.js';
import { err, ok, type Result } from '../types/result.js';
import type { ErrorCode } from './codes.js';
import type { ClientMessage } from './messages.js';
import { isValidPartyCode, normalisePartyCode } from './partyCode.js';

export const MAX_MESSAGE_BYTES = 4 * 1024;
export const MAX_NAME_LENGTH = 14;
export const MAX_TOKEN_LENGTH = 512;
export const MAX_REQ_ID_LENGTH = 64;

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(bag: Bag, key: string, maxLength: number): string | null {
  const value = bag[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
  return value;
}

/**
 * Code points that must never reach another player's screen: C0/C1 controls,
 * zero-width joiners and the bidirectional overrides used to disguise text.
 * Expressed as ranges rather than a regex literal so the intent stays readable.
 */
function isUnsafeCodePoint(code: number): boolean {
  if (code < 0x20) return true; // C0 controls
  if (code >= 0x7f && code <= 0x9f) return true; // DEL and C1 controls
  if (code >= 0x200b && code <= 0x200f) return true; // zero-width and marks
  if (code >= 0x2028 && code <= 0x202e) return true; // separators and bidi overrides
  if (code >= 0x2066 && code <= 0x2069) return true; // isolate overrides
  return code === 0xfeff; // byte order mark
}

/** Names are shown to another human, so they are sanitised, never trusted. */
export function sanitiseName(raw: unknown, fallback = 'Player'): string {
  if (typeof raw !== 'string') return fallback;
  const kept: string[] = [];
  for (const char of raw) {
    if (!isUnsafeCodePoint(char.codePointAt(0) ?? 0)) kept.push(char);
  }
  const cleaned = kept.join('').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : fallback;
}

function intIn(value: unknown, min: number, maxExclusive: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < min || value >= maxExclusive) return null;
  return value;
}

/** Parse and validate one inbound frame. Never throws. */
export function parseClientMessage(raw: unknown): Result<ClientMessage, ErrorCode> {
  if (!isBag(raw)) return err('BAD_REQUEST', 'Message must be an object.');

  const type = raw['t'];
  if (typeof type !== 'string') return err('BAD_REQUEST', 'Missing message type.');

  const reqId = str(raw, 'reqId', MAX_REQ_ID_LENGTH);
  if (reqId === null) return err('BAD_REQUEST', 'Missing request id.');

  switch (type) {
    case 'PING': {
      const clientTime = typeof raw['clientTime'] === 'number' ? raw['clientTime'] : 0;
      return ok({ t: 'PING', reqId, clientTime });
    }

    case 'CREATE_PARTY':
      return ok({ t: 'CREATE_PARTY', reqId, name: sanitiseName(raw['name']) });

    case 'JOIN_PARTY': {
      const rawCode = raw['code'];
      if (typeof rawCode !== 'string' || rawCode.length > 32) {
        return err('INVALID_CODE', 'That code does not look right.');
      }
      const code = normalisePartyCode(rawCode);
      if (!isValidPartyCode(code)) return err('INVALID_CODE', 'That code does not look right.');
      return ok({ t: 'JOIN_PARTY', reqId, code, name: sanitiseName(raw['name']) });
    }

    case 'LEAVE_PARTY':
      return ok({ t: 'LEAVE_PARTY', reqId });

    case 'SET_READY': {
      const ready = raw['ready'];
      if (typeof ready !== 'boolean') return err('BAD_REQUEST', 'ready must be a boolean.');
      return ok({ t: 'SET_READY', reqId, ready });
    }

    case 'START_BOT_GAME': {
      const difficulty: unknown = raw['difficulty'];
      if (!isBotDifficulty(difficulty)) return err('BAD_REQUEST', 'Unknown difficulty.');
      return ok({ t: 'START_BOT_GAME', reqId, name: sanitiseName(raw['name'], 'You'), difficulty });
    }

    case 'PLACE_BOMBS': {
      const positions = raw['positions'];
      if (!Array.isArray(positions) || positions.length !== BOMB_COUNT) {
        return err('INVALID_BOMB_PLACEMENT', `Pick exactly ${BOMB_COUNT} different chips.`);
      }
      const parsed: number[] = [];
      for (const entry of positions) {
        const index = intIn(entry, 0, 9);
        if (index === null) return err('INVALID_BOMB_PLACEMENT', 'Chips must be 0..8.');
        parsed.push(index);
      }
      if (new Set(parsed).size !== BOMB_COUNT) {
        return err('INVALID_BOMB_PLACEMENT', 'Chips must be different.');
      }
      return ok({ t: 'PLACE_BOMBS', reqId, positions: parsed });
    }

    case 'MAKE_MOVE': {
      const index = intIn(raw['index'], 0, 9);
      if (index === null) return err('INVALID_CHIP', 'Chip must be 0..8.');
      return ok({ t: 'MAKE_MOVE', reqId, index });
    }

    case 'REQUEST_REMATCH':
      return ok({ t: 'REQUEST_REMATCH', reqId });

    case 'RESUME_SESSION': {
      const token = str(raw, 'token', MAX_TOKEN_LENGTH);
      if (token === null) return err('SESSION_INVALID', 'Your session has expired.');
      return ok({ t: 'RESUME_SESSION', reqId, token });
    }

    default:
      return err('BAD_REQUEST', `Unknown message type "${type.slice(0, 24)}".`);
  }
}
