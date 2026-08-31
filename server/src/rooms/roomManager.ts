import { randomUUID } from 'node:crypto';
import {
  createSecureRng,
  err,
  generatePartyCode,
  ok,
  type BotDifficulty,
  type ErrorCode,
  type Result,
  type Slot,
} from '@bbc/shared';
import { config } from '../config.js';
import type { ClientLink } from '../net/connection.js';
import { Room } from './room.js';
import { verifySessionToken } from './sessionToken.js';

const rng = createSecureRng();

export interface Seating {
  readonly room: Room;
  readonly slot: Slot;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly byCode = new Map<string, Room>();
  private readonly partiesByAddress = new Map<string, number>();
  private readonly roomAddress = new Map<string, string>();

  get size(): number {
    return this.rooms.size;
  }

  private register(room: Room, address: string): void {
    this.rooms.set(room.id, room);
    this.roomAddress.set(room.id, address);
    if (room.code) this.byCode.set(room.code, room);
    this.partiesByAddress.set(address, (this.partiesByAddress.get(address) ?? 0) + 1);
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const code = generatePartyCode(rng);
      if (!this.byCode.has(code)) return code;
    }
    // Astronomically unlikely; fall back to a unique-by-construction suffix.
    return generatePartyCode(rng);
  }

  createParty(link: ClientLink, name: string): Result<Seating, ErrorCode> {
    if ((this.partiesByAddress.get(link.address) ?? 0) >= config.maxPartiesPerAddress) {
      return err('RATE_LIMITED', 'Too many parties open from here.');
    }
    const room = new Room({
      id: randomUUID(),
      code: this.freshCode(),
      mode: 'FRIEND',
      onEmpty: (closing) => this.remove(closing),
    });
    room.addHuman('P1', randomUUID(), name, link);
    this.register(room, link.address);
    return ok({ room, slot: 'P1' });
  }

  joinParty(code: string, link: ClientLink, name: string): Result<Seating, ErrorCode> {
    const room = this.byCode.get(code);
    if (!room) return err('PARTY_NOT_FOUND', 'PARTY NOT FOUND');
    if (room.hasStarted) return err('GAME_ALREADY_STARTED', 'GAME ALREADY STARTED');
    const slot = room.freeSlot();
    if (!slot) return err('PARTY_FULL', 'PARTY FULL');

    room.addHuman(slot, randomUUID(), name, link);
    return ok({ room, slot });
  }

  startBotGame(
    link: ClientLink,
    name: string,
    difficulty: BotDifficulty,
  ): Result<Seating, ErrorCode> {
    if ((this.partiesByAddress.get(link.address) ?? 0) >= config.maxPartiesPerAddress) {
      return err('RATE_LIMITED', 'Too many games open from here.');
    }
    const room = new Room({
      id: randomUUID(),
      code: null,
      mode: 'BOT',
      onEmpty: (closing) => this.remove(closing),
    });
    room.addHuman('P1', randomUUID(), name, link);
    room.addBot('P2', difficulty);
    this.register(room, link.address);
    return ok({ room, slot: 'P1' });
  }

  /** Reclaim a seat after a reload. The ticket proves which seat, nothing else. */
  resume(token: string, link: ClientLink): Result<Seating, ErrorCode> {
    const claims = verifySessionToken(token);
    if (!claims) return err('SESSION_INVALID', 'Your session has expired.');
    const room = this.rooms.get(claims.roomId);
    if (!room) return err('PARTY_NOT_FOUND', 'That party is no longer around.');
    const seat = room.seat(claims.slot);
    if (!seat || seat.playerId !== claims.playerId) {
      return err('SESSION_INVALID', 'That seat is no longer yours.');
    }
    room.attach(claims.slot, link);
    return ok({ room, slot: claims.slot });
  }

  findByCode(code: string): Room | undefined {
    return this.byCode.get(code);
  }

  remove(room: Room): void {
    if (!this.rooms.has(room.id)) return;
    this.rooms.delete(room.id);
    if (room.code) this.byCode.delete(room.code);
    const address = this.roomAddress.get(room.id);
    this.roomAddress.delete(room.id);
    if (address) this.releaseAddress(address);
    room.dispose();
  }

  private releaseAddress(address: string): void {
    const current = this.partiesByAddress.get(address);
    if (current === undefined) return;
    if (current <= 1) this.partiesByAddress.delete(address);
    else this.partiesByAddress.set(address, current - 1);
  }

  shutdown(): void {
    for (const room of this.rooms.values()) room.dispose('Server shutting down');
    this.rooms.clear();
    this.byCode.clear();
    this.roomAddress.clear();
    this.partiesByAddress.clear();
  }
}
