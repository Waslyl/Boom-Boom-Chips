/**
 * Reconnection tickets.
 *
 * A ticket names a seat and is signed with an HMAC the client never sees, so a
 * player can reclaim their seat after a reload without the server trusting any
 * client-supplied identity. The ticket carries no secret game information —
 * losing one lets someone take over a seat, nothing more, and it expires.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Slot } from '@bbc/shared';
import { config } from '../config.js';

export interface SessionClaims {
  readonly roomId: string;
  readonly slot: Slot;
  readonly playerId: string;
  readonly expiresAt: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sign(payload: string): string {
  return base64url(createHmac('sha256', config.sessionSecret).update(payload).digest());
}

export function issueSessionToken(
  claims: Omit<SessionClaims, 'expiresAt'>,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const expiresAt = now + config.sessionTtlMs;
  const payload = base64url(
    JSON.stringify({ r: claims.roomId, s: claims.slot, p: claims.playerId, e: expiresAt }),
  );
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifySessionToken(token: string, now = Date.now()): SessionClaims | null {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = sign(payload);

  // Constant-time compare, so a forged token cannot be refined byte by byte.
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) return null;
  if (!timingSafeEqual(providedBytes, expectedBytes)) return null;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof decoded !== 'object' || decoded === null) return null;
    const bag = decoded as Record<string, unknown>;
    const roomId = bag['r'];
    const slot = bag['s'];
    const playerId = bag['p'];
    const expiresAt = bag['e'];
    if (typeof roomId !== 'string' || typeof playerId !== 'string') return null;
    if (slot !== 'P1' && slot !== 'P2') return null;
    if (typeof expiresAt !== 'number' || expiresAt < now) return null;
    return { roomId, slot, playerId, expiresAt };
  } catch {
    return null;
  }
}
