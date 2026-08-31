/**
 * End-to-end over real sockets.
 *
 * A real HTTP server on a real port, two real WebSocket clients, the real
 * protocol. This is the test that proves the transport layer — framing,
 * upgrade handling, ordering, close semantics — and not just the logic behind
 * it. The unit suites run in microseconds; this one earns its slower seconds.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { CHIP_INDICES, type ChipIndex, type PlayerView, type ServerMessage } from '@bbc/shared';
import { createGameServer, type GameServer } from '../server/src/app.js';

let server: GameServer;
let port = 0;

beforeAll(async () => {
  server = createGameServer(null);
  port = await server.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await server.close();
});

class LiveClient {
  private readonly socket: WebSocket;
  readonly received: ServerMessage[] = [];
  private counter = 0;
  session: string | null = null;

  constructor(readonly name: string) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (message.t === 'PARTY' && message.session) this.session = message.session.token;
      this.received.push(message);
    });
  }

  ready(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
  }

  send(message: Record<string, unknown>): void {
    this.counter += 1;
    this.socket.send(JSON.stringify({ reqId: `${this.name}-${this.counter}`, ...message }));
  }

  close(): void {
    this.socket.close();
  }

  terminate(): void {
    this.socket.terminate();
  }

  /**
   * A point in the message log to wait from. Without one, a wait can be
   * satisfied by a message that arrived BEFORE the action under test, which
   * silently turns a polling loop into a no-op. Take a mark, then wait from it.
   */
  mark(): number {
    return this.received.length;
  }

  /** Wait until a message satisfying `match` arrives, or fail loudly. */
  async waitFor<T extends ServerMessage['t']>(
    type: T,
    match: (message: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    timeoutMs = 4_000,
    from = 0,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = from; i < this.received.length; i += 1) {
        const message = this.received[i] as ServerMessage;
        if (message.t === type && match(message as Extract<ServerMessage, { t: T }>)) {
          return message as Extract<ServerMessage, { t: T }>;
        }
      }
      if (Date.now() > deadline) {
        throw new Error(
          `${this.name}: timed out waiting for ${type}. Saw: ${this.received.map((m) => m.t).join(', ')}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  view(): PlayerView {
    const states = this.received.filter((m) => m.t === 'STATE');
    const last = states.at(-1);
    if (!last || last.t !== 'STATE') throw new Error(`${this.name} has no state`);
    return last.view;
  }

  async waitForView(
    predicate: (view: PlayerView) => boolean,
    timeoutMs = 4_000,
    from = 0,
  ): Promise<PlayerView> {
    const state = await this.waitFor('STATE', (m) => predicate(m.view), timeoutMs, from);
    return state.view;
  }
}

async function pair(): Promise<{ host: LiveClient; guest: LiveClient; code: string }> {
  const host = new LiveClient('host');
  await host.ready();
  host.send({ t: 'CREATE_PARTY', name: 'Ada' });
  const created = await host.waitFor('PARTY', (m) => m.party.code !== null);
  const code = created.party.code as string;

  const guest = new LiveClient('guest');
  await guest.ready();
  guest.send({ t: 'JOIN_PARTY', code, name: 'Bo' });
  await guest.waitFor('PARTY', (m) => m.party.members.length === 2);

  host.send({ t: 'SET_READY', ready: true });
  guest.send({ t: 'SET_READY', ready: true });
  await host.waitFor('STATE');
  await guest.waitFor('STATE');
  return { host, guest, code };
}

describe('a real server on a real port', () => {
  it('answers the health check', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('404s an unknown path when no client bundle is configured', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(response.status).toBe(404);
  });

  it('greets a socket with HELLO', async () => {
    const client = new LiveClient('greeter');
    await client.ready();
    const hello = await client.waitFor('HELLO');
    expect(hello.protocolVersion).toBe(1);
    client.close();
  });

  it('refuses an upgrade on the wrong path', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/not-the-socket`);
    await expect(
      new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      }),
    ).rejects.toBeDefined();
  });
});

describe('two clients play a full match over the wire', () => {
  it('runs setup, turns, a win, and a rematch', async () => {
    const { host, guest } = await pair();

    expect(host.view().phase).toBe('SETUP');
    expect(guest.view().phase).toBe('SETUP');

    host.send({ t: 'PLACE_BOMBS', positions: [0, 1, 2] });
    guest.send({ t: 'PLACE_BOMBS', positions: [6, 7, 8] });
    await host.waitForView((view) => view.phase === 'PLAYING');
    await guest.waitForView((view) => view.phase === 'PLAYING');

    // Neither client has ever been sent what is buried in their own plate.
    for (const client of [host, guest]) {
      for (const message of client.received) {
        if (message.t !== 'STATE' || message.view.phase === 'ENDED') continue;
        expect(message.view.yourPlate).not.toHaveProperty('bombs');
        expect(message.view.yourPlate).not.toHaveProperty('yourBombs');
        expect(message.view.finalReveal).toBeNull();
      }
    }

    // The host planted 0/1/2, so those are fatal for the GUEST, and vice versa.
    const doomed = host.view().isYourTurn ? host : guest;
    const survivor = doomed === host ? guest : host;
    const fatal = doomed === host ? [6, 7, 8] : [0, 1, 2];
    const harmless = [3, 4, 5];

    for (let i = 0; i < 3; i += 1) {
      const before = doomed.view().turnNumber;
      doomed.send({ t: 'MAKE_MOVE', index: fatal[i]! });
      const after = await doomed.waitForView(
        (view) => view.turnNumber > before || view.phase === 'ENDED',
      );
      if (after.phase === 'ENDED') break;

      const otherBefore = survivor.view().turnNumber;
      survivor.send({ t: 'MAKE_MOVE', index: harmless[i]! });
      await survivor.waitForView((view) => view.turnNumber > otherBefore || view.phase === 'ENDED');
    }

    const lost = await doomed.waitForView((view) => view.phase === 'ENDED');
    expect(lost.youWon).toBe(false);
    expect(lost.yourPlate.lives).toBe(0);
    expect(lost.finalReveal).not.toBeNull();

    const won = await survivor.waitForView((view) => view.phase === 'ENDED');
    expect(won.youWon).toBe(true);
    expect(won.yourPlate.lives).toBe(3);
    expect(won.finalReveal!.bombsYouPlanted).toEqual(lost.finalReveal!.bombsAgainstYou);

    // Rematch, over the same sockets.
    doomed.send({ t: 'REQUEST_REMATCH' });
    survivor.send({ t: 'REQUEST_REMATCH' });
    const fresh = await host.waitForView((view) => view.phase === 'SETUP' && view.turnNumber === 0);
    expect(fresh.theirPlate.yourBombs).toEqual([]);
    expect(fresh.finalReveal).toBeNull();

    host.close();
    guest.close();
  });

  it('rejects a move from the player who is not on turn', async () => {
    const { host, guest } = await pair();
    host.send({ t: 'PLACE_BOMBS', positions: [0, 4, 8] });
    guest.send({ t: 'PLACE_BOMBS', positions: [1, 3, 5] });
    await host.waitForView((view) => view.phase === 'PLAYING');

    const offTurn = host.view().isYourTurn ? guest : host;
    offTurn.send({ t: 'MAKE_MOVE', index: 0 });
    const error = await offTurn.waitFor('ERROR');
    expect(error.code).toBe('NOT_YOUR_TURN');

    host.close();
    guest.close();
  });
});

describe('reconnection over the wire', () => {
  it('restores a seat after the socket is killed outright', async () => {
    const { host, guest } = await pair();
    host.send({ t: 'PLACE_BOMBS', positions: [0, 4, 8] });
    guest.send({ t: 'PLACE_BOMBS', positions: [1, 3, 5] });
    await guest.waitForView((view) => view.phase === 'PLAYING');

    const token = guest.session;
    expect(token).toBeTruthy();
    const before = guest.view();

    // Not a clean close: yank the connection the way a lost network does.
    guest.terminate();
    await host.waitForView((view) => view.opponent.connected === false, 4_000);

    const returning = new LiveClient('guest-again');
    await returning.ready();
    returning.send({ t: 'RESUME_SESSION', token: token as string });

    const restored = await returning.waitForView((view) => view.phase === 'PLAYING');
    expect(restored.you).toBe(before.you);
    expect(restored.theirPlate.yourBombs).toEqual([1, 3, 5]);
    await host.waitForView((view) => view.opponent.connected === true);

    // And play continues normally from there.
    const eater = restored.isYourTurn ? returning : host;
    const target = CHIP_INDICES.find(
      (index) => eater.view().yourPlate.cells[index]!.state === 'HIDDEN',
    ) as ChipIndex;
    const turnBefore = eater.view().turnNumber;
    eater.send({ t: 'MAKE_MOVE', index: target });
    await eater.waitForView((view) => view.turnNumber > turnBefore);

    host.close();
    returning.close();
  });
});

describe('a full bot match over the wire', () => {
  it('plays itself to a finish', async () => {
    const player = new LiveClient('solo');
    await player.ready();
    player.send({ t: 'START_BOT_GAME', name: 'Ada', difficulty: 'HARD' });
    await player.waitForView((view) => view.phase === 'SETUP');

    player.send({ t: 'PLACE_BOMBS', positions: [0, 4, 8] });
    await player.waitForView((view) => view.phase === 'PLAYING');

    let guard = 0;
    while (player.view().phase === 'PLAYING' && guard < 24) {
      guard += 1;
      const mark = player.mark();
      if (player.view().isYourTurn) {
        const target = CHIP_INDICES.find(
          (index) => player.view().yourPlate.cells[index]!.state === 'HIDDEN',
        ) as ChipIndex;
        const before = player.view().turnNumber;
        player.send({ t: 'MAKE_MOVE', index: target });
        await player.waitForView(
          (view) => view.turnNumber > before || view.phase === 'ENDED',
          5_000,
          mark,
        );
      } else {
        // The bot takes a human-like pause; wait it out rather than mocking it.
        await player.waitForView((view) => view.isYourTurn || view.phase === 'ENDED', 6_000, mark);
      }
    }

    const final = player.view();
    expect(final.phase).toBe('ENDED');
    expect(final.winner).not.toBeNull();
    expect(final.finalReveal!.bombsAgainstYou).toHaveLength(3);
    player.close();
  }, 30_000);
});
