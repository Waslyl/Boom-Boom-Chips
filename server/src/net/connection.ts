import type { ServerMessage } from '@bbc/shared';

/**
 * The room layer talks to this, not to a WebSocket. Keeping the transport
 * behind an interface is what lets the whole room/match/bot stack be tested in
 * process, with no sockets and no ports.
 */
export interface ClientLink {
  readonly id: string;
  readonly address: string;
  readonly isOpen: boolean;
  send(message: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

/**
 * Token bucket. Absorbs the honest burst of a player double-tapping a chip
 * while still cutting off a script hammering the socket.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
    now = Date.now(),
  ) {
    this.tokens = burst;
    this.lastRefill = now;
  }

  /** Returns false when the caller should be rejected. */
  take(now = Date.now(), cost = 1): boolean {
    const elapsed = Math.max(0, now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.perSecond);
    this.lastRefill = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
