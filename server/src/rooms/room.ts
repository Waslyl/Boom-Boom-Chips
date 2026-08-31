/**
 * A room owns one match and the two seats around it.
 *
 * Everything authoritative happens here: the room holds the only `GameState`
 * in existence for that match, applies the engine to validated actions, and
 * pushes each seat its own redacted projection. No client ever decides
 * anything; the room decides and tells them what happened.
 */
import {
  applySetupTimeout,
  applyTurnTimeout,
  bothWantRematch,
  createBot,
  createBotMemory,
  createGame,
  createPlayer,
  createRematch,
  createSecureRng,
  endGame,
  ERROR_MESSAGES,
  plantBombs,
  rememberGame,
  requestRematch,
  eatChip,
  setConnected,
  toPlayerView,
  otherSlot,
  type BotDifficulty,
  type BotMemory,
  type ClientMessage,
  type ErrorCode,
  type GameEvent,
  type GameState,
  type MatchMode,
  type PartyMemberView,
  type PartyStatus,
  type PartyView,
  type Slot,
  type Transition,
} from '@bbc/shared';
import { config } from '../config.js';
import type { ClientLink } from '../net/connection.js';
import { issueSessionToken } from './sessionToken.js';

const rng = createSecureRng();

export interface Seat {
  readonly slot: Slot;
  readonly playerId: string;
  name: string;
  readonly isBot: boolean;
  ready: boolean;
  link: ClientLink | null;
  botMemory?: BotMemory;
  botDifficulty?: BotDifficulty;
}

export interface RoomOptions {
  readonly id: string;
  readonly code: string | null;
  readonly mode: MatchMode;
  readonly onEmpty: (room: Room) => void;
}

type Timer = ReturnType<typeof setTimeout>;

export class Room {
  readonly id: string;
  readonly code: string | null;
  readonly mode: MatchMode;
  readonly createdAt = Date.now();

  private readonly seats = new Map<Slot, Seat>();
  private readonly onEmpty: (room: Room) => void;
  private state: GameState | null = null;
  private seq = 0;
  private gameCounter = 0;
  private disposed = false;

  private clockTimer: Timer | null = null;
  private botTimer: Timer | null = null;
  private reaperTimer: Timer | null = null;
  private readonly graceTimers = new Map<Slot, Timer>();

  constructor(options: RoomOptions) {
    this.id = options.id;
    this.code = options.code;
    this.mode = options.mode;
    this.onEmpty = options.onEmpty;
    this.scheduleReaper(config.emptyPartyTtlMs);
  }

  /* ------------------------------------------------------------------ */
  /* Seats                                                               */
  /* ------------------------------------------------------------------ */

  get status(): PartyStatus {
    if (this.disposed) return 'CLOSED';
    if (!this.state) return 'LOBBY';
    return 'IN_GAME';
  }

  get isFull(): boolean {
    return this.seats.size >= 2;
  }

  get hasStarted(): boolean {
    return this.state !== null;
  }

  get isEmptyOfHumans(): boolean {
    for (const seat of this.seats.values()) {
      if (!seat.isBot && seat.link?.isOpen) return false;
    }
    return true;
  }

  seat(slot: Slot): Seat | undefined {
    return this.seats.get(slot);
  }

  freeSlot(): Slot | null {
    if (!this.seats.has('P1')) return 'P1';
    if (!this.seats.has('P2')) return 'P2';
    return null;
  }

  addHuman(slot: Slot, playerId: string, name: string, link: ClientLink): Seat {
    const seat: Seat = { slot, playerId, name, isBot: false, ready: false, link };
    this.seats.set(slot, seat);
    this.cancelReaper();
    return seat;
  }

  addBot(slot: Slot, difficulty: BotDifficulty): Seat {
    const seat: Seat = {
      slot,
      playerId: `bot-${slot}`,
      name: botName(difficulty),
      isBot: true,
      ready: true,
      link: null,
      botMemory: createBotMemory(),
      botDifficulty: difficulty,
    };
    this.seats.set(slot, seat);
    return seat;
  }

  /** Hand a seat a fresh socket, whether it is a first arrival or a reconnect. */
  attach(slot: Slot, link: ClientLink): void {
    const seat = this.seats.get(slot);
    if (!seat) return;
    seat.link?.close(4000, 'Replaced by a newer connection');
    seat.link = link;
    this.cancelReaper();

    const grace = this.graceTimers.get(slot);
    if (grace) {
      clearTimeout(grace);
      this.graceTimers.delete(slot);
    }
    if (this.state) {
      this.state = setConnected(this.state, slot, true);
      this.pushState([]);
    } else {
      this.broadcastParty();
    }
  }

  /** The socket for `slot` went away. Whether that ends the match depends on phase. */
  detach(slot: Slot, link: ClientLink): void {
    const seat = this.seats.get(slot);
    if (!seat || seat.link !== link) return; // already replaced by a reconnect
    seat.link = null;

    if (!this.state) {
      // Still in the lobby: free the seat so somebody else can take it.
      this.seats.delete(slot);
      if (this.isEmptyOfHumans) this.scheduleReaper(0);
      else this.broadcastParty();
      return;
    }

    if (this.state.phase === 'ENDED') {
      if (this.isEmptyOfHumans) this.scheduleReaper(0);
      return;
    }

    const until = Date.now() + config.disconnectGraceMs;
    this.state = setConnected(this.state, slot, false, until);
    this.pushState([]);
    this.graceTimers.set(
      slot,
      setTimeout(() => this.onGraceExpired(slot), config.disconnectGraceMs),
    );
  }

  private onGraceExpired(slot: Slot): void {
    this.graceTimers.delete(slot);
    const seat = this.seats.get(slot);
    if (!seat || seat.link?.isOpen || !this.state) return;
    if (this.state.phase === 'ENDED') return;
    this.applyTransition(endGame(this.state, otherSlot(slot), 'DISCONNECT_TIMEOUT'));
    if (this.isEmptyOfHumans) this.scheduleReaper(0);
  }

  /* ------------------------------------------------------------------ */
  /* Messaging                                                           */
  /* ------------------------------------------------------------------ */

  partyView(forSlot: Slot): PartyView {
    const members: PartyMemberView[] = [];
    for (const slot of ['P1', 'P2'] as const) {
      const seat = this.seats.get(slot);
      if (!seat) continue;
      members.push({
        slot,
        name: seat.name,
        connected: seat.isBot || Boolean(seat.link?.isOpen),
        ready: seat.ready,
        isBot: seat.isBot,
      });
    }
    return { code: this.code, you: forSlot, hostSlot: 'P1', status: this.status, members };
  }

  sendParty(slot: Slot, withSession = false): void {
    const seat = this.seats.get(slot);
    if (!seat?.link?.isOpen) return;
    seat.link.send({
      t: 'PARTY',
      party: this.partyView(slot),
      ...(withSession
        ? { session: issueSessionToken({ roomId: this.id, slot, playerId: seat.playerId }) }
        : {}),
    });
  }

  broadcastParty(): void {
    for (const slot of this.seats.keys()) this.sendParty(slot);
  }

  private pushState(events: readonly GameEvent[]): void {
    if (!this.state) return;
    this.seq += 1;
    const serverTime = Date.now();
    for (const [slot, seat] of this.seats) {
      if (!seat.link?.isOpen) continue;
      seat.link.send({
        t: 'STATE',
        seq: this.seq,
        view: toPlayerView(this.state, slot),
        events,
        serverTime,
      });
    }
  }

  /** Send the current truth to one seat, used on reconnect. */
  resend(slot: Slot): void {
    const seat = this.seats.get(slot);
    if (!seat?.link?.isOpen) return;
    seat.link.send({ t: 'PARTY', party: this.partyView(slot) });
    if (!this.state) return;
    this.seq += 1;
    seat.link.send({
      t: 'STATE',
      seq: this.seq,
      view: toPlayerView(this.state, slot),
      events: [],
      serverTime: Date.now(),
    });
  }

  private fail(slot: Slot, reqId: string | null, code: ErrorCode): void {
    const link = this.seats.get(slot)?.link;
    if (!link?.isOpen) return;
    link.send({ t: 'ERROR', reqId, code, message: ERROR_MESSAGES[code] });
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  handle(slot: Slot, message: ClientMessage): void {
    if (this.disposed) return this.fail(slot, message.reqId, 'NOT_IN_PARTY');

    switch (message.t) {
      case 'SET_READY':
        return this.setReady(slot, message.reqId, message.ready);
      case 'PLACE_BOMBS':
        return this.handlePlant(slot, message.reqId, message.positions);
      case 'MAKE_MOVE':
        return this.makeMove(slot, message.reqId, message.index);
      case 'REQUEST_REMATCH':
        return this.rematch(slot, message.reqId);
      default:
        return this.fail(slot, message.reqId, 'BAD_REQUEST');
    }
  }

  private setReady(slot: Slot, reqId: string, ready: boolean): void {
    const seat = this.seats.get(slot);
    if (!seat) return this.fail(slot, reqId, 'NOT_IN_PARTY');
    if (this.state) return this.fail(slot, reqId, 'GAME_ALREADY_STARTED');

    seat.ready = ready;
    this.broadcastParty();

    const p1 = this.seats.get('P1');
    const p2 = this.seats.get('P2');
    if (p1?.ready && p2?.ready) this.startGame();
  }

  startGame(): void {
    const p1 = this.seats.get('P1');
    const p2 = this.seats.get('P2');
    if (!p1 || !p2 || this.state) return;

    this.gameCounter += 1;
    this.state = createGame({
      gameId: `${this.id}-${this.gameCounter}`,
      mode: this.mode,
      p1: createPlayer({
        id: p1.playerId,
        name: p1.name,
        isBot: p1.isBot,
        ...(p1.botDifficulty ? { botDifficulty: p1.botDifficulty } : {}),
      }),
      p2: createPlayer({
        id: p2.playerId,
        name: p2.name,
        isBot: p2.isBot,
        ...(p2.botDifficulty ? { botDifficulty: p2.botDifficulty } : {}),
      }),
      rng,
    });

    this.broadcastParty();
    this.armBots();
    this.pushState([{ type: 'GAME_START', firstTurn: this.state.currentTurn }]);
    this.afterStateChange();
  }

  /** Bots plant into the opposing plate the moment the match is created, in secret. */
  private armBots(): void {
    for (const seat of this.seats.values()) {
      if (!seat.isBot || !this.state) continue;
      const bot = createBot(seat.botDifficulty ?? 'NORMAL');
      const positions = bot.plantBombs(rng, seat.botMemory ?? createBotMemory());
      const planted = plantBombs(this.state, seat.slot, positions);
      if (planted.ok) this.state = planted.value.state;
    }
  }

  private handlePlant(slot: Slot, reqId: string, positions: readonly number[]): void {
    if (!this.state) return this.fail(slot, reqId, 'WRONG_PHASE');
    const result = plantBombs(this.state, slot, positions);
    if (!result.ok) return this.fail(slot, reqId, result.code);
    this.applyTransition(result.value);
  }

  private makeMove(slot: Slot, reqId: string, index: number): void {
    if (!this.state) return this.fail(slot, reqId, 'WRONG_PHASE');
    const result = eatChip(this.state, slot, index);
    if (!result.ok) return this.fail(slot, reqId, result.code);
    this.applyTransition(result.value);
  }

  private rematch(slot: Slot, reqId: string): void {
    if (!this.state) return this.fail(slot, reqId, 'WRONG_PHASE');

    // A duplicate press that arrives after the rematch already happened. There
    // is no legitimate reason to ask for a rematch of a game nobody has played
    // yet, so a request during a fresh, untouched setup is always a late echo
    // of one we honoured — swallow it instead of scolding the player.
    const inFreshRematchSetup =
      this.state.phase === 'SETUP' && this.state.turnNumber === 0 && this.gameCounter > 1;
    if (inFreshRematchSetup) return;

    const asked = requestRematch(this.state, slot);
    if (!asked.ok) return this.fail(slot, reqId, asked.code);
    this.state = asked.value;

    // A bot always accepts, and never keeps anyone waiting.
    for (const seat of this.seats.values()) {
      if (!seat.isBot) continue;
      const botAsked = requestRematch(this.state, seat.slot);
      if (botAsked.ok) this.state = botAsked.value;
    }

    if (!bothWantRematch(this.state)) {
      this.pushState([]);
      return;
    }

    // Let each bot learn from the game that just finished before it resets.
    for (const seat of this.seats.values()) {
      if (seat.isBot && seat.botMemory && this.state) {
        rememberGame(seat.botMemory, toPlayerView(this.state, seat.slot));
      }
    }

    this.gameCounter += 1;
    this.state = createRematch(this.state, `${this.id}-${this.gameCounter}`);
    this.clearTimers();
    this.armBots();
    this.pushState([{ type: 'GAME_START', firstTurn: this.state.currentTurn }]);
    this.afterStateChange();
  }

  /* ------------------------------------------------------------------ */
  /* State plumbing                                                      */
  /* ------------------------------------------------------------------ */

  private applyTransition(transition: Transition): void {
    this.state = transition.state;
    this.pushState(transition.events);
    this.afterStateChange();
  }

  /** One place that reacts to every state change: clocks, bots, cleanup. */
  private afterStateChange(): void {
    this.clearTimers();
    if (!this.state || this.disposed) return;

    if (this.state.phase === 'ENDED') {
      this.scheduleReaper(config.finishedPartyTtlMs);
      return;
    }
    this.scheduleClock();
    this.scheduleBotTurn();
  }

  private scheduleClock(): void {
    if (!this.state?.deadline) return;
    const delay = Math.max(0, this.state.deadline - Date.now());
    this.clockTimer = setTimeout(() => this.onClockExpired(), delay + 25);
  }

  private onClockExpired(): void {
    this.clockTimer = null;
    if (!this.state || this.disposed) return;
    const transition =
      this.state.phase === 'SETUP'
        ? applySetupTimeout(this.state, rng)
        : applyTurnTimeout(this.state, rng);
    if (transition) this.applyTransition(transition);
    else this.afterStateChange();
  }

  /**
   * A bot moves on a timer so the human sees it "think". The closure re-reads
   * state at fire time, so a rematch or a disconnect in between cannot make it
   * play into a stale board.
   */
  private scheduleBotTurn(): void {
    if (!this.state || this.state.phase !== 'PLAYING') return;
    const seat = this.seats.get(this.state.currentTurn);
    if (!seat?.isBot) return;

    const bot = createBot(seat.botDifficulty ?? 'NORMAL');
    const gameId = this.state.gameId;
    const turnNumber = this.state.turnNumber;

    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const state = this.state;
      if (this.disposed || !state) return;
      if (state.gameId !== gameId || state.turnNumber !== turnNumber) return;
      if (state.phase !== 'PLAYING' || state.currentTurn !== seat.slot) return;

      const view = toPlayerView(state, seat.slot);
      const index = bot.chooseMove(view, rng, seat.botMemory ?? createBotMemory());
      const result = eatChip(state, seat.slot, index);
      if (result.ok) this.applyTransition(result.value);
    }, bot.thinkTimeMs(rng));
  }

  private clearTimers(): void {
    if (this.clockTimer) clearTimeout(this.clockTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.clockTimer = null;
    this.botTimer = null;
  }

  private scheduleReaper(delay: number): void {
    this.cancelReaper();
    this.reaperTimer = setTimeout(() => {
      this.reaperTimer = null;
      if (this.isEmptyOfHumans) this.onEmpty(this);
    }, delay);
  }

  private cancelReaper(): void {
    if (this.reaperTimer) clearTimeout(this.reaperTimer);
    this.reaperTimer = null;
  }

  /** Test and shutdown seam: exposes the truth the network never sees. */
  peekState(): GameState | null {
    return this.state;
  }

  dispose(reason = 'Party closed'): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    this.cancelReaper();
    for (const timer of this.graceTimers.values()) clearTimeout(timer);
    this.graceTimers.clear();
    for (const seat of this.seats.values()) {
      if (seat.link?.isOpen) {
        seat.link.send({ t: 'PARTY_CLOSED', reason });
        seat.link.close(1000, reason);
      }
    }
    this.seats.clear();
    this.state = null;
  }
}

const BOT_NAMES: Record<BotDifficulty, string> = {
  EASY: 'Rookie Bot',
  NORMAL: 'Steady Bot',
  HARD: 'Sharp Bot',
  EXPERT: 'Boom Master',
};

function botName(difficulty: BotDifficulty): string {
  return BOT_NAMES[difficulty];
}
