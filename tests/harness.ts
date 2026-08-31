/**
 * In-process multiplayer harness.
 *
 * Drives the REAL gateway, room manager, engine and bots through a fake
 * `ClientLink`. No sockets, no ports, no timers left running — but every byte
 * a browser would receive passes through the same code, so these tests catch
 * protocol and authority bugs, not just engine bugs.
 */
import { expect } from 'vitest';
import type { ChipIndex, PlayerView, ServerMessage } from '@bbc/shared';
import type { ClientLink } from '../server/src/net/connection.js';
import { Gateway, Session } from '../server/src/net/gateway.js';
import { RoomManager } from '../server/src/rooms/roomManager.js';

class FakeLink implements ClientLink {
  readonly received: ServerMessage[] = [];
  isOpen = true;

  constructor(
    readonly id: string,
    readonly address: string,
  ) {}

  send(message: ServerMessage): void {
    // Round-trip through JSON exactly like the socket does, so a test can never
    // observe something that would not survive serialisation.
    this.received.push(JSON.parse(JSON.stringify(message)) as ServerMessage);
  }

  close(): void {
    this.isOpen = false;
  }
}

export class TestClient {
  readonly link: FakeLink;
  readonly session: Session;
  private counter = 0;

  constructor(
    private readonly gateway: Gateway,
    id: string,
    address = '10.0.0.1',
  ) {
    this.link = new FakeLink(id, address);
    this.session = new Session(this.link);
    this.gateway.open(this.session);
  }

  send(message: Record<string, unknown>): this {
    this.counter += 1;
    const framed = { reqId: `${this.link.id}-${this.counter}`, ...message };
    this.gateway.receive(this.session, JSON.stringify(framed));
    return this;
  }

  /** Raw frame, for testing malformed input. */
  sendRaw(raw: string): this {
    this.gateway.receive(this.session, raw);
    return this;
  }

  /** Simulate the socket dropping. */
  disconnect(): void {
    this.link.isOpen = false;
    this.gateway.close(this.session);
  }

  messages<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }>[] {
    return this.link.received.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === type);
  }

  last<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }> | undefined {
    return this.messages(type).at(-1);
  }

  /** The latest authoritative projection this client received. */
  view(): PlayerView {
    const state = this.last('STATE');
    if (!state) throw new Error(`${this.link.id} has never received a STATE`);
    return state.view;
  }

  hasView(): boolean {
    return this.last('STATE') !== undefined;
  }

  party() {
    const party = this.last('PARTY');
    if (!party) throw new Error(`${this.link.id} has never received a PARTY`);
    return party.party;
  }

  sessionToken(): string {
    for (const message of [...this.link.received].reverse()) {
      if (message.t === 'PARTY' && message.session) return message.session.token;
    }
    throw new Error(`${this.link.id} was never issued a session`);
  }

  errors() {
    return this.messages('ERROR');
  }

  lastError() {
    return this.last('ERROR');
  }

  clear(): void {
    this.link.received.length = 0;
  }
}

export interface Harness {
  readonly gateway: Gateway;
  readonly rooms: RoomManager;
  client(id: string, address?: string): TestClient;
  dispose(): void;
}

export function createHarness(): Harness {
  const rooms = new RoomManager();
  const gateway = new Gateway(rooms);
  const clients: TestClient[] = [];

  return {
    gateway,
    rooms,
    client(id: string, address = '10.0.0.1'): TestClient {
      const client = new TestClient(gateway, id, address);
      clients.push(client);
      return client;
    },
    dispose(): void {
      for (const client of clients) client.disconnect();
      rooms.shutdown();
    },
  };
}

/** Seat two clients in one party and get them both to READY. */
export function startFriendMatch(harness: Harness): {
  host: TestClient;
  guest: TestClient;
  code: string;
} {
  const host = harness.client('host', '10.0.0.1');
  host.send({ t: 'CREATE_PARTY', name: 'Ada' });
  const code = host.party().code;
  expect(code).toBeTruthy();

  const guest = harness.client('guest', '10.0.0.2');
  guest.send({ t: 'JOIN_PARTY', code, name: 'Bo' });

  host.send({ t: 'SET_READY', ready: true });
  guest.send({ t: 'SET_READY', ready: true });
  return { host, guest, code: code as string };
}

/**
 * Both players plant, and the match begins.
 *
 * Read the arguments carefully: hostPlants are the cells the HOST rigs, which
 * means those bombs land in the GUEST plate. Eating hostPlants is fatal for the
 * guest, not the host.
 */
export function armMatch(
  host: TestClient,
  guest: TestClient,
  hostPlants: ChipIndex[] = [0, 1, 2],
  guestPlants: ChipIndex[] = [6, 7, 8],
): void {
  host.send({ t: 'PLACE_BOMBS', positions: hostPlants });
  guest.send({ t: 'PLACE_BOMBS', positions: guestPlants });
}

/** The chips that will kill this client, i.e. the ones the opponent planted. */
export const FATAL_FOR_HOST: ChipIndex[] = [6, 7, 8];
export const FATAL_FOR_GUEST: ChipIndex[] = [0, 1, 2];
export const SAFE_FOR_BOTH: ChipIndex[] = [3, 4, 5];

/** Whoever is on turn eats that chip from their own plate. */
export function bite(host: TestClient, guest: TestClient, index: number): TestClient {
  const eater = host.view().isYourTurn ? host : guest;
  eater.send({ t: 'MAKE_MOVE', index });
  return eater;
}
