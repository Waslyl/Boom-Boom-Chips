/**
 * The gateway routes one connection's messages to the right place.
 *
 * It is deliberately transport-agnostic: it takes a `ClientLink`, not a
 * WebSocket. That is what lets the multiplayer tests drive two "players"
 * through the exact production code path with no sockets involved.
 */
import {
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  ERROR_MESSAGES,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type Slot,
} from '@bbc/shared';
import { config } from '../config.js';
import { RateLimiter, type ClientLink } from './connection.js';
import type { RoomManager } from '../rooms/roomManager.js';
import type { Room } from '../rooms/room.js';

export class Session {
  readonly limiter: RateLimiter;
  room: Room | null = null;
  slot: Slot | null = null;
  /** Heartbeat bookkeeping, owned by the socket layer. */
  missedBeats = 0;

  constructor(readonly link: ClientLink) {
    this.limiter = new RateLimiter(config.rateLimitBurst, config.rateLimitPerSecond);
  }
}

export class Gateway {
  constructor(private readonly rooms: RoomManager) {}

  open(session: Session): void {
    session.link.send({ t: 'HELLO', protocolVersion: PROTOCOL_VERSION, serverTime: Date.now() });
  }

  /** Raw frame in. Everything is validated before it reaches a room. */
  receive(session: Session, raw: string): void {
    if (raw.length > MAX_MESSAGE_BYTES) {
      return this.reject(session, null, 'BAD_REQUEST');
    }
    if (!session.limiter.take()) {
      return this.reject(session, null, 'RATE_LIMITED');
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return this.reject(session, null, 'BAD_REQUEST');
    }

    const parsed = parseClientMessage(decoded);
    if (!parsed.ok) {
      const reqId =
        typeof (decoded as { reqId?: unknown })?.reqId === 'string'
          ? ((decoded as { reqId: string }).reqId satisfies string)
          : null;
      return this.reject(session, reqId, parsed.code);
    }

    this.dispatch(session, parsed.value);
  }

  private dispatch(session: Session, message: ClientMessage): void {
    switch (message.t) {
      case 'PING':
        session.link.send({
          t: 'PONG',
          reqId: message.reqId,
          clientTime: message.clientTime,
          serverTime: Date.now(),
        });
        return;

      case 'CREATE_PARTY':
        return this.createParty(session, message.reqId, message.name);

      case 'JOIN_PARTY':
        return this.joinParty(session, message.reqId, message.code, message.name);

      case 'START_BOT_GAME':
        return this.startBotGame(session, message.reqId, message.name, message.difficulty);

      case 'RESUME_SESSION':
        return this.resume(session, message.reqId, message.token);

      case 'LEAVE_PARTY':
        return this.leave(session, message.reqId);

      default: {
        const { room, slot } = session;
        if (!room || !slot) return this.reject(session, message.reqId, 'NOT_IN_PARTY');
        session.link.send({ t: 'ACK', reqId: message.reqId });
        room.handle(slot, message);
        return;
      }
    }
  }

  /** One player may only occupy one seat per socket. */
  private detachFromCurrent(session: Session): void {
    if (session.room && session.slot) session.room.detach(session.slot, session.link);
    session.room = null;
    session.slot = null;
  }

  private createParty(session: Session, reqId: string, name: string): void {
    this.detachFromCurrent(session);
    const created = this.rooms.createParty(session.link, name);
    if (!created.ok) return this.reject(session, reqId, created.code);

    session.room = created.value.room;
    session.slot = created.value.slot;
    session.link.send({ t: 'ACK', reqId });
    created.value.room.sendParty(created.value.slot, true);
  }

  private joinParty(session: Session, reqId: string, code: string, name: string): void {
    this.detachFromCurrent(session);
    const joined = this.rooms.joinParty(code, session.link, name);
    if (!joined.ok) return this.reject(session, reqId, joined.code);

    session.room = joined.value.room;
    session.slot = joined.value.slot;
    session.link.send({ t: 'ACK', reqId });
    joined.value.room.sendParty(joined.value.slot, true);
    joined.value.room.broadcastParty();
  }

  private startBotGame(
    session: Session,
    reqId: string,
    name: string,
    difficulty: Parameters<RoomManager['startBotGame']>[2],
  ): void {
    this.detachFromCurrent(session);
    const started = this.rooms.startBotGame(session.link, name, difficulty);
    if (!started.ok) return this.reject(session, reqId, started.code);

    session.room = started.value.room;
    session.slot = started.value.slot;
    session.link.send({ t: 'ACK', reqId });
    started.value.room.sendParty(started.value.slot, true);
    started.value.room.startGame();
  }

  private resume(session: Session, reqId: string, token: string): void {
    const resumed = this.rooms.resume(token, session.link);
    if (!resumed.ok) return this.reject(session, reqId, resumed.code);

    session.room = resumed.value.room;
    session.slot = resumed.value.slot;
    session.link.send({ t: 'ACK', reqId });
    resumed.value.room.resend(resumed.value.slot);
  }

  private leave(session: Session, reqId: string): void {
    const room = session.room;
    this.detachFromCurrent(session);
    session.link.send({ t: 'ACK', reqId });
    if (room?.isEmptyOfHumans) this.rooms.remove(room);
  }

  /** The socket went away for any reason. */
  close(session: Session): void {
    this.detachFromCurrent(session);
  }

  private reject(session: Session, reqId: string | null, code: ErrorCode): void {
    session.link.send({ t: 'ERROR', reqId, code, message: ERROR_MESSAGES[code] });
  }
}
