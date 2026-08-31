/**
 * The socket.
 *
 * Responsibilities kept deliberately narrow: stay connected, frame messages,
 * estimate the server clock. It knows nothing about the game — everything it
 * receives goes straight to the store, and everything it sends was decided
 * there. That separation is what lets the UI be swapped or tested freely.
 */
import type { ClientMessage, ServerMessage } from '@bbc/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'offline';

export interface TransportHandlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  /** Fired after a reconnect so the store can try to reclaim its seat. */
  onReopen: () => void;
}

/**
 * Omit must be distributed across the union, or TypeScript collapses ten
 * distinct messages into their common fields and every payload stops checking.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type Outbound = DistributiveOmit<ClientMessage, 'reqId'> & { reqId?: string };

const PING_INTERVAL_MS = 10_000;
const MAX_BACKOFF_MS = 8_000;

function socketUrl(): string {
  const override = import.meta.env['VITE_WS_URL'];
  if (typeof override === 'string' && override.length > 0) return override;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export class GameTransport {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = 'offline';
  private attempt = 0;
  private counter = 0;
  private hasConnectedOnce = false;
  private closing = false;

  /** Messages sent before the socket opened, replayed in order once it does. */
  private readonly backlog: ClientMessage[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** serverTime - clientTime, so a deadline can be rendered against a local clock. */
  clockOffsetMs = 0;
  latencyMs = 0;

  constructor(private readonly handlers: TransportHandlers) {}

  connect(): void {
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;
    this.closing = false;
    this.setStatus(this.hasConnectedOnce ? 'reconnecting' : 'connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      const returning = this.hasConnectedOnce;
      this.hasConnectedOnce = true;
      this.setStatus('open');
      this.startPinging();
      for (const message of this.backlog.splice(0)) this.raw(message);
      if (returning) this.handlers.onReopen();
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(event.data) as ServerMessage;
      } catch {
        return; // a frame we cannot read is never worth crashing over
      }
      if (parsed.t === 'PONG') {
        const now = Date.now();
        this.latencyMs = Math.max(0, now - parsed.clientTime);
        this.clockOffsetMs = parsed.serverTime - (parsed.clientTime + this.latencyMs / 2);
      }
      this.handlers.onMessage(parsed);
    };

    socket.onerror = () => {
      // `onclose` always follows; retrying is handled there.
    };

    socket.onclose = () => {
      this.stopPinging();
      this.socket = null;
      if (this.closing) {
        this.setStatus('offline');
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    this.setStatus(this.hasConnectedOnce ? 'reconnecting' : 'connecting');
    if (this.retryTimer) return;
    this.attempt += 1;
    // Exponential backoff with jitter, so a server restart does not get a
    // synchronised stampede from every client at once.
    const base = Math.min(MAX_BACKOFF_MS, 400 * Math.pow(1.7, this.attempt - 1));
    const delay = base * (0.7 + Math.random() * 0.6);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private startPinging(): void {
    this.stopPinging();
    this.send({ t: 'PING', clientTime: Date.now() });
    this.pingTimer = setInterval(() => {
      this.send({ t: 'PING', clientTime: Date.now() });
    }, PING_INTERVAL_MS);
  }

  private stopPinging(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.handlers.onStatus(status);
  }

  private raw(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  send(message: Outbound): void {
    this.counter += 1;
    const framed = { ...message, reqId: message.reqId ?? `c${this.counter}` } as ClientMessage;
    if (this.socket?.readyState === WebSocket.OPEN) this.raw(framed);
    else if (this.backlog.length < 32) this.backlog.push(framed);
  }

  disconnect(): void {
    this.closing = true;
    this.stopPinging();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close(1000, 'Client left');
    this.socket = null;
    this.setStatus('offline');
  }
}
