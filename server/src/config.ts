import { randomBytes } from 'node:crypto';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * A missing secret is generated per boot: sessions then survive a reload but
 * not a server restart, which is a safe default. Set BBC_SESSION_SECRET in
 * production so reconnection keeps working across deploys and replicas.
 */
function sessionSecret(): string {
  const provided = process.env['BBC_SESSION_SECRET'];
  if (provided && provided.length >= 16) return provided;
  if (process.env['NODE_ENV'] === 'production') {
    console.warn('[bbc] BBC_SESSION_SECRET is unset: reconnection will not survive a restart.');
  }
  return randomBytes(32).toString('hex');
}

export const config = {
  host: process.env['BBC_HOST'] ?? '0.0.0.0',
  port: envInt('PORT', envInt('BBC_PORT', 8080)),

  /** Empty means "allow any origin", which is the right default for local dev. */
  allowedOrigins: envList('BBC_ALLOWED_ORIGINS'),

  sessionSecret: sessionSecret(),
  /** How long a reconnection ticket stays valid. */
  sessionTtlMs: envInt('BBC_SESSION_TTL_MS', 30 * 60 * 1000),

  /** Grace period before a disconnected player forfeits an in-progress match. */
  disconnectGraceMs: envInt('BBC_DISCONNECT_GRACE_MS', 60_000),
  /** How long an idle lobby waits for a second player before it is reaped. */
  emptyPartyTtlMs: envInt('BBC_EMPTY_PARTY_TTL_MS', 15 * 60 * 1000),
  /** How long a finished match is kept around so a rematch can be agreed. */
  finishedPartyTtlMs: envInt('BBC_FINISHED_PARTY_TTL_MS', 5 * 60 * 1000),

  heartbeatIntervalMs: envInt('BBC_HEARTBEAT_MS', 15_000),
  /** Missed heartbeats before the socket is considered dead. */
  heartbeatMisses: envInt('BBC_HEARTBEAT_MISSES', 2),

  /** Token bucket: burst size and refill rate per connection. */
  rateLimitBurst: envInt('BBC_RATE_BURST', 24),
  rateLimitPerSecond: envInt('BBC_RATE_PER_SECOND', 12),

  maxPartiesPerAddress: envInt('BBC_MAX_PARTIES_PER_IP', 12),
  maxConnectionsPerAddress: envInt('BBC_MAX_CONNS_PER_IP', 24),

  /** Directory of the built client, served alongside the socket. */
  clientDir: process.env['BBC_CLIENT_DIR'] ?? null,
} as const;

export type Config = typeof config;
