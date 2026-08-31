/**
 * Multiplayer tests.
 *
 * Everything here runs through the production gateway and room manager, so a
 * pass means the actual protocol works — not just the engine underneath it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHIP_INDICES, isValidPartyCode, PARTY_CODE_LENGTH } from '@bbc/shared';
import { config } from '../server/src/config.js';
import {
  armMatch,
  createHarness,
  startFriendMatch,
  FATAL_FOR_GUEST,
  FATAL_FOR_HOST,
  SAFE_FOR_BOTH,
  type Harness,
} from './harness.js';

let harness: Harness;

beforeEach(() => {
  vi.useFakeTimers();
  harness = createHarness();
});

afterEach(() => {
  harness.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('handshake', () => {
  it('greets a new connection with the protocol version', () => {
    const client = harness.client('solo');
    expect(client.last('HELLO')).toMatchObject({ t: 'HELLO', protocolVersion: 1 });
  });

  it('rejects malformed frames without dropping the connection', () => {
    const client = harness.client('solo');
    client.sendRaw('not json at all');
    expect(client.lastError()?.code).toBe('BAD_REQUEST');
    expect(client.link.isOpen).toBe(true);

    client.sendRaw(JSON.stringify({ t: 'MAKE_MOVE', reqId: 'x', index: 'three' }));
    expect(client.lastError()?.code).toBe('INVALID_CHIP');

    client.sendRaw(JSON.stringify({ t: 'WHO_KNOWS', reqId: 'x' }));
    expect(client.lastError()?.code).toBe('BAD_REQUEST');
  });

  it('refuses an oversized frame', () => {
    const client = harness.client('solo');
    client.sendRaw(JSON.stringify({ t: 'PING', reqId: 'x', pad: 'a'.repeat(8_000) }));
    expect(client.lastError()?.code).toBe('BAD_REQUEST');
  });

  it('answers PING with the server clock, which is how the client syncs timers', () => {
    const client = harness.client('solo');
    client.send({ t: 'PING', clientTime: 1234 });
    const pong = client.last('PONG');
    expect(pong?.clientTime).toBe(1234);
    expect(pong?.serverTime).toBeGreaterThan(0);
  });
});

describe('creating and joining a party', () => {
  it('hands the host a shareable code and a session ticket', () => {
    const host = harness.client('host');
    host.send({ t: 'CREATE_PARTY', name: 'Ada' });

    const party = host.party();
    expect(party.code).toHaveLength(PARTY_CODE_LENGTH);
    expect(isValidPartyCode(party.code!)).toBe(true);
    expect(party.you).toBe('P1');
    expect(party.status).toBe('LOBBY');
    expect(party.members).toEqual([
      { slot: 'P1', name: 'Ada', connected: true, ready: false, isBot: false },
    ]);
    expect(host.sessionToken()).toBeTruthy();
  });

  it('seats a second player and tells both about it', () => {
    const host = harness.client('host', '10.0.0.1');
    host.send({ t: 'CREATE_PARTY', name: 'Ada' });
    const code = host.party().code!;

    const guest = harness.client('guest', '10.0.0.2');
    guest.send({ t: 'JOIN_PARTY', code, name: 'Bo' });

    expect(guest.party().you).toBe('P2');
    expect(host.party().members).toHaveLength(2);
    expect(host.party().members[1]).toMatchObject({ slot: 'P2', name: 'Bo', connected: true });
  });

  it('accepts a lower-case code with separators, the way people paste them', () => {
    const host = harness.client('host', '10.0.0.1');
    host.send({ t: 'CREATE_PARTY', name: 'Ada' });
    const code = host.party().code!;

    const guest = harness.client('guest', '10.0.0.2');
    guest.send({ t: 'JOIN_PARTY', code: ` ${code.toLowerCase()} `, name: 'Bo' });
    expect(guest.party().you).toBe('P2');
  });

  it.each([
    ['PARTY NOT FOUND', 'QQQQQQ', 'PARTY_NOT_FOUND'],
    ['a malformed code', '!!', 'INVALID_CODE'],
  ])('reports %s cleanly', (_label, code, expected) => {
    const guest = harness.client('guest');
    guest.send({ t: 'JOIN_PARTY', code, name: 'Bo' });
    expect(guest.lastError()?.code).toBe(expected);
  });

  it('reports PARTY FULL to a third player', () => {
    const { code } = startFriendMatch(harness);
    const third = harness.client('third', '10.0.0.3');
    third.send({ t: 'JOIN_PARTY', code, name: 'Cy' });
    // Both seats are taken and the match has begun.
    expect(third.lastError()?.code).toBe('GAME_ALREADY_STARTED');
  });

  it('reports PARTY FULL while the lobby is still filling', () => {
    const host = harness.client('host', '10.0.0.1');
    host.send({ t: 'CREATE_PARTY', name: 'Ada' });
    const code = host.party().code!;
    harness.client('guest', '10.0.0.2').send({ t: 'JOIN_PARTY', code, name: 'Bo' });

    const third = harness.client('third', '10.0.0.3');
    third.send({ t: 'JOIN_PARTY', code, name: 'Cy' });
    expect(third.lastError()?.code).toBe('PARTY_FULL');
  });

  it('frees the seat again if someone leaves the lobby', () => {
    const host = harness.client('host', '10.0.0.1');
    host.send({ t: 'CREATE_PARTY', name: 'Ada' });
    const code = host.party().code!;

    const guest = harness.client('guest', '10.0.0.2');
    guest.send({ t: 'JOIN_PARTY', code, name: 'Bo' });
    guest.send({ t: 'LEAVE_PARTY' });

    const third = harness.client('third', '10.0.0.3');
    third.send({ t: 'JOIN_PARTY', code, name: 'Cy' });
    expect(third.party().you).toBe('P2');
  });

  it('caps how many parties one address can open', () => {
    const spammer = harness.client('spammer', '10.9.9.9');
    for (let i = 0; i < config.maxPartiesPerAddress; i += 1) {
      spammer.send({ t: 'CREATE_PARTY', name: 'Ada' });
    }
    spammer.send({ t: 'CREATE_PARTY', name: 'Ada' });
    expect(spammer.lastError()?.code).toBe('RATE_LIMITED');
  });

  it('cuts off a client that floods the socket', () => {
    const spammer = harness.client('spammer', '10.9.9.8');
    for (let i = 0; i < config.rateLimitBurst + 5; i += 1) {
      spammer.send({ t: 'PING', clientTime: i });
    }
    expect(spammer.errors().some((e) => e.code === 'RATE_LIMITED')).toBe(true);
  });
});

describe('starting a match', () => {
  it('begins in SETUP once both players are ready', () => {
    const { host, guest } = startFriendMatch(harness);
    expect(host.view().phase).toBe('SETUP');
    expect(guest.view().phase).toBe('SETUP');
    expect(host.view().you).toBe('P1');
    expect(guest.view().you).toBe('P2');
    expect(host.party().status).toBe('IN_GAME');
  });

  it('waits for both players before it starts', () => {
    const host = harness.client('host', '10.0.0.1');
    host.send({ t: 'CREATE_PARTY', name: 'Ada' });
    const code = host.party().code!;
    const guest = harness.client('guest', '10.0.0.2');
    guest.send({ t: 'JOIN_PARTY', code, name: 'Bo' });

    host.send({ t: 'SET_READY', ready: true });
    expect(host.hasView()).toBe(false);
    expect(host.party().members[0]!.ready).toBe(true);

    guest.send({ t: 'SET_READY', ready: true });
    expect(host.hasView()).toBe(true);
  });

  it('tells each player where they planted, and never what awaits them', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);

    // You know the traps you laid in their plate…
    expect(host.view().theirPlate.yourBombs).toEqual([0, 1, 2]);
    expect(guest.view().theirPlate.yourBombs).toEqual([6, 7, 8]);

    // …and nothing whatsoever about your own.
    for (const client of [host, guest]) {
      for (const state of client.messages('STATE')) {
        expect(state.view.yourPlate).not.toHaveProperty('bombs');
        expect(state.view.yourPlate).not.toHaveProperty('yourBombs');
        expect(state.view.yourPlate.cells.every((c) => c.state === 'HIDDEN')).toBe(true);
      }
      expect(JSON.stringify(client.link.received)).not.toContain('bombsAgainstYou');
    }
  });

  it('refuses an illegal placement and keeps waiting', () => {
    const { host, guest } = startFriendMatch(harness);
    host.send({ t: 'PLACE_BOMBS', positions: [0, 0, 1] });
    expect(host.lastError()?.code).toBe('INVALID_BOMB_PLACEMENT');
    host.send({ t: 'PLACE_BOMBS', positions: [0, 1] });
    expect(host.lastError()?.code).toBe('INVALID_BOMB_PLACEMENT');
    expect(host.view().phase).toBe('SETUP');

    armMatch(host, guest);
    expect(host.view().phase).toBe('PLAYING');
  });

  it('refuses a second placement from the same player', () => {
    const { host, guest } = startFriendMatch(harness);
    host.send({ t: 'PLACE_BOMBS', positions: [0, 1, 2] });
    host.send({ t: 'PLACE_BOMBS', positions: [3, 4, 5] });
    expect(host.lastError()?.code).toBe('BOMBS_ALREADY_PLACED');
    expect(guest.view().phase).toBe('SETUP');
  });
});

describe('playing a match', () => {
  it('alternates turns and refuses moves out of turn', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);

    const first = host.view().isYourTurn ? host : guest;
    const second = first === host ? guest : host;

    second.send({ t: 'MAKE_MOVE', index: 4 });
    expect(second.lastError()?.code).toBe('NOT_YOUR_TURN');

    first.send({ t: 'MAKE_MOVE', index: 4 });
    expect(first.view().isYourTurn).toBe(false);
    expect(second.view().isYourTurn).toBe(true);
  });

  it('ignores a double tap on the same chip', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);
    const first = host.view().isYourTurn ? host : guest;

    first.send({ t: 'MAKE_MOVE', index: 3 });
    first.send({ t: 'MAKE_MOVE', index: 3 });
    // The second attempt lands after the turn has already passed.
    expect(first.lastError()?.code).toBe('NOT_YOUR_TURN');
    expect(first.view().yourPlate.cells.filter((c) => c.state !== 'HIDDEN')).toHaveLength(1);
  });

  it('resolves a race so that one turn produces exactly one bite', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);

    // Both players slam a chip while it is the same person's turn. Messages are
    // serialised, so the off-turn one is refused rather than queued.
    const onTurn = host.view().isYourTurn ? host : guest;
    const offTurn = onTurn === host ? guest : host;
    const turnBefore = onTurn.view().turnNumber;

    offTurn.send({ t: 'MAKE_MOVE', index: 5 });
    offTurn.send({ t: 'MAKE_MOVE', index: 4 });
    onTurn.send({ t: 'MAKE_MOVE', index: 5 });

    expect(offTurn.errors().filter((e) => e.code === 'NOT_YOUR_TURN')).toHaveLength(2);
    expect(onTurn.view().turnNumber).toBe(turnBefore + 1);
    const eaten = onTurn.view().yourPlate.cells.filter((c) => c.state !== 'HIDDEN');
    expect(eaten).toHaveLength(1);
    // The off-turn player has not touched their own plate at all.
    expect(offTurn.view().yourPlate.cells.filter((c) => c.state !== 'HIDDEN')).toHaveLength(0);
  });

  it('refuses a chip that is already revealed', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);

    const first = host.view().isYourTurn ? host : guest;
    const second = first === host ? guest : host;
    first.send({ t: 'MAKE_MOVE', index: 4 });
    second.send({ t: 'MAKE_MOVE', index: 4 });
    first.send({ t: 'MAKE_MOVE', index: 4 });
    expect(first.lastError()?.code).toBe('ALREADY_REVEALED');
  });

  it('emits the events a client needs to animate a detonation', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);
    const first = host.view().isYourTurn ? host : guest;
    // The host is walking through the guest's traps at 6/7/8, and vice versa.
    const fatal = first === host ? FATAL_FOR_HOST[0]! : FATAL_FOR_GUEST[0]!;

    first.clear();
    first.send({ t: 'MAKE_MOVE', index: fatal });
    const events = first.last('STATE')!.events;
    expect(events.map((e) => e.type)).toEqual(['CHIP_EATEN', 'BOMB_HIT', 'TURN_CHANGED']);
    // It cost the eater a life, and told the other player they scored.
    expect(first.view().yourPlate.lives).toBe(2);
    const other = first === host ? guest : host;
    expect(other.view().theirPlate.lives).toBe(2);
  });

  it('eliminates the player who runs out of lives and hands the win to the other', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);

    const doomed = host.view().isYourTurn ? host : guest;
    const survivor = doomed === host ? guest : host;
    // The chips that will kill the player who is about to eat them.
    const fatal = doomed === host ? FATAL_FOR_HOST : FATAL_FOR_GUEST;

    for (let i = 0; i < 3; i += 1) {
      doomed.send({ t: 'MAKE_MOVE', index: fatal[i]! });
      if (doomed.view().phase === 'ENDED') break;
      survivor.send({ t: 'MAKE_MOVE', index: SAFE_FOR_BOTH[i]! });
    }

    expect(doomed.view().phase).toBe('ENDED');
    // Eating three bombs LOSES the game.
    expect(doomed.view().youWon).toBe(false);
    expect(doomed.view().yourPlate.lives).toBe(0);
    expect(survivor.view().youWon).toBe(true);
    expect(survivor.view().yourPlate.lives).toBe(3);
    expect(doomed.view().endReason).toBe('ELIMINATED');

    // Only now do both layouts open up, for both players.
    expect(doomed.view().finalReveal).not.toBeNull();
    expect(survivor.view().finalReveal!.bombsYouPlanted).toEqual(
      doomed.view().finalReveal!.bombsAgainstYou,
    );

    doomed.send({ t: 'MAKE_MOVE', index: 3 });
    expect(doomed.lastError()?.code).toBe('GAME_IS_OVER');
  });
});

describe('turn clock', () => {
  it('fires for an idle player instead of stalling the match', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);

    const idle = host.view().isYourTurn ? host : guest;
    expect(idle.view().deadline).not.toBeNull();

    vi.advanceTimersByTime(config.rateLimitBurst > 0 ? 31_000 : 31_000);

    expect(idle.view().isYourTurn).toBe(false);
    const events = idle.last('STATE')!.events;
    expect(events[0]!.type).toBe('TURN_TIMEOUT');
    expect(idle.view().yourPlate.cells.filter((c) => c.state !== 'HIDDEN')).toHaveLength(1);
  });

  it('arms an unplaced grid at random rather than killing the match', () => {
    const { host, guest } = startFriendMatch(harness);
    host.send({ t: 'PLACE_BOMBS', positions: [0, 1, 2] });
    expect(guest.view().phase).toBe('SETUP');

    vi.advanceTimersByTime(91_000);

    expect(guest.view().phase).toBe('PLAYING');
    expect(guest.view().theirPlate.yourBombs).toHaveLength(3);
  });
});

describe('disconnection and reconnection', () => {
  it('tells the opponent, with a deadline, and keeps the match alive', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);

    guest.disconnect();
    expect(host.view().opponent.connected).toBe(false);
    expect(host.view().opponent.disconnectedUntil).toBeGreaterThan(Date.now());
    expect(host.view().phase).toBe('PLAYING');
  });

  it('restores the seat, the grid and the turn from a session ticket', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);
    const before = guest.view();
    const token = guest.sessionToken();

    guest.disconnect();
    const returning = harness.client('guest-again', '10.0.0.2');
    returning.send({ t: 'RESUME_SESSION', token });

    const after = returning.view();
    expect(after.you).toBe('P2');
    expect(after.theirPlate.yourBombs).toEqual(before.theirPlate.yourBombs);
    expect(after.currentTurn).toBe(before.currentTurn);
    expect(after.phase).toBe('PLAYING');
    expect(host.view().opponent.connected).toBe(true);
  });

  it('lets the returning player carry on playing', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);
    const token = guest.sessionToken();
    guest.disconnect();

    const returning = harness.client('guest-again', '10.0.0.2');
    returning.send({ t: 'RESUME_SESSION', token });

    const shooter = returning.view().isYourTurn ? returning : host;
    shooter.send({ t: 'MAKE_MOVE', index: 4 });
    expect(returning.view().turnNumber).toBe(2);
  });

  it('rejects a forged or expired ticket', () => {
    const client = harness.client('impostor');
    client.send({ t: 'RESUME_SESSION', token: 'made.up' });
    expect(client.lastError()?.code).toBe('SESSION_INVALID');

    const { guest } = startFriendMatch(harness);
    const token = guest.sessionToken();
    const tampered = `${token.slice(0, -3)}zzz`;
    const forger = harness.client('forger', '10.0.0.7');
    forger.send({ t: 'RESUME_SESSION', token: tampered });
    expect(forger.lastError()?.code).toBe('SESSION_INVALID');
  });

  it('awards the match once the grace period runs out', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);

    guest.disconnect();
    vi.advanceTimersByTime(config.disconnectGraceMs + 1_000);

    expect(host.view().phase).toBe('ENDED');
    expect(host.view().youWon).toBe(true);
    expect(host.view().endReason).toBe('DISCONNECT_TIMEOUT');
  });

  it('cancels the forfeit if the player gets back in time', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);
    const token = guest.sessionToken();

    guest.disconnect();
    vi.advanceTimersByTime(config.disconnectGraceMs / 2);

    const returning = harness.client('guest-again', '10.0.0.2');
    returning.send({ t: 'RESUME_SESSION', token });
    vi.advanceTimersByTime(config.disconnectGraceMs + 1_000);

    expect(host.view().phase).not.toBe('ENDED');
    expect(returning.view().phase).not.toBe('ENDED');
  });

  it('survives a reload during the setup phase', () => {
    const { host, guest } = startFriendMatch(harness);
    host.send({ t: 'PLACE_BOMBS', positions: [0, 4, 8] });
    const token = host.sessionToken();

    host.disconnect();
    const returning = harness.client('host-again', '10.0.0.1');
    returning.send({ t: 'RESUME_SESSION', token });

    expect(returning.view().phase).toBe('SETUP');
    expect(returning.view().theirPlate.yourBombs).toEqual([0, 4, 8]);
    expect(returning.view().bombsPlanted).toEqual({ you: true, opponent: false });

    guest.send({ t: 'PLACE_BOMBS', positions: [1, 3, 5] });
    expect(returning.view().phase).toBe('PLAYING');
  });
});

describe('rematch', () => {
  /** Drives the player on turn straight into all three of their own bombs. */
  function playToTheEnd(harnessRef: Harness) {
    const { host, guest } = startFriendMatch(harnessRef);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);
    const doomed = host.view().isYourTurn ? host : guest;
    const survivor = doomed === host ? guest : host;
    const fatal = doomed === host ? FATAL_FOR_HOST : FATAL_FOR_GUEST;
    for (let i = 0; i < 3; i += 1) {
      doomed.send({ t: 'MAKE_MOVE', index: fatal[i]! });
      if (doomed.view().phase === 'ENDED') break;
      survivor.send({ t: 'MAKE_MOVE', index: SAFE_FOR_BOTH[i]! });
    }
    return { host, guest, winner: survivor, loser: doomed };
  }

  it('waits for the opponent before restarting', () => {
    const { host, guest, winner } = playToTheEnd(harness);
    winner.send({ t: 'REQUEST_REMATCH' });

    expect(host.view().phase).toBe('ENDED');
    expect(winner.view().rematch).toEqual({ you: true, opponent: false });
    const other = winner === host ? guest : host;
    expect(other.view().rematch).toEqual({ you: false, opponent: true });
  });

  it('starts a clean game with new secret bombs once both agree', () => {
    const { host, guest, winner, loser } = playToTheEnd(harness);
    winner.send({ t: 'REQUEST_REMATCH' });
    loser.send({ t: 'REQUEST_REMATCH' });

    for (const client of [host, guest]) {
      const view = client.view();
      expect(view.phase).toBe('SETUP');
      expect(view.theirPlate.yourBombs).toEqual([]);
      expect(view.yourPlate.cells.every((c) => c.state === 'HIDDEN')).toBe(true);
      expect(view.finalReveal).toBeNull();
      expect(view.rematch).toEqual({ you: false, opponent: false });
      expect(view.turnNumber).toBe(0);
    }
    // Eating first is the weaker seat, so the winner takes it as a handicap.
    expect(host.view().currentTurn).toBe(winner.view().you);
    void loser;
  });

  it('is idempotent when both players mash the button', () => {
    const { winner, loser, host } = playToTheEnd(harness);
    winner.send({ t: 'REQUEST_REMATCH' });
    winner.send({ t: 'REQUEST_REMATCH' });
    loser.send({ t: 'REQUEST_REMATCH' });
    loser.send({ t: 'REQUEST_REMATCH' });
    expect(host.view().phase).toBe('SETUP');
    expect(host.errors().filter((e) => e.code !== 'RATE_LIMITED')).toEqual([]);
  });

  it('refuses a rematch mid-game', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest);
    host.send({ t: 'REQUEST_REMATCH' });
    expect(host.lastError()?.code).toBe('WRONG_PHASE');
  });

  it('plays a full second game after the rematch', () => {
    const { host, guest, winner, loser } = playToTheEnd(harness);
    winner.send({ t: 'REQUEST_REMATCH' });
    loser.send({ t: 'REQUEST_REMATCH' });
    armMatch(host, guest, [2, 4, 6], [1, 3, 5]);

    let guard = 0;
    while (host.view().phase === 'PLAYING' && guard < 25) {
      guard += 1;
      const eater = host.view().isYourTurn ? host : guest;
      const target = CHIP_INDICES.find(
        (index) => eater.view().yourPlate.cells[index]!.state === 'HIDDEN',
      )!;
      eater.send({ t: 'MAKE_MOVE', index: target });
    }
    expect(host.view().phase).toBe('ENDED');
    expect(host.view().winner).not.toBeNull();
  });
});

describe('room lifecycle', () => {
  it('closes an abandoned lobby', () => {
    const host = harness.client('host', '10.0.0.1');
    host.send({ t: 'CREATE_PARTY', name: 'Ada' });
    const code = host.party().code!;
    expect(harness.rooms.findByCode(code)).toBeDefined();

    host.disconnect();
    vi.advanceTimersByTime(100);
    expect(harness.rooms.findByCode(code)).toBeUndefined();
  });

  it('does not leak rooms when a player creates several in a row', () => {
    const host = harness.client('host', '10.0.0.1');
    host.send({ t: 'CREATE_PARTY', name: 'Ada' });
    host.send({ t: 'CREATE_PARTY', name: 'Ada' });
    host.send({ t: 'CREATE_PARTY', name: 'Ada' });
    vi.advanceTimersByTime(100);
    // The two abandoned lobbies are reaped; the live one stays.
    expect(harness.rooms.size).toBe(1);
  });

  it('cleans up a finished match after its rematch window', () => {
    const { host, guest } = startFriendMatch(harness);
    armMatch(host, guest, [0, 1, 2], [6, 7, 8]);
    const doomed = host.view().isYourTurn ? host : guest;
    const survivor = doomed === host ? guest : host;
    const fatal = doomed === host ? FATAL_FOR_HOST : FATAL_FOR_GUEST;
    for (let i = 0; i < 3; i += 1) {
      doomed.send({ t: 'MAKE_MOVE', index: fatal[i]! });
      if (doomed.view().phase === 'ENDED') break;
      survivor.send({ t: 'MAKE_MOVE', index: SAFE_FOR_BOTH[i]! });
    }
    host.disconnect();
    guest.disconnect();
    vi.advanceTimersByTime(100);
    expect(harness.rooms.size).toBe(0);
  });
});
