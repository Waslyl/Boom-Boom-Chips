/**
 * The client store.
 *
 * It holds no game rules. The server sends a `PlayerView`; this file decides
 * only *when* to show it, so that a bite lands with a beat of tension rather
 * than snapping into place. Everything the UI renders comes from that view.
 */
import { create } from 'zustand';
import {
  BOMB_COUNT,
  CHIP_INDICES,
  ERROR_MESSAGES,
  normalisePartyCode,
  type BotDifficulty,
  type ChipIndex,
  type ErrorCode,
  type GameEvent,
  type PartyView,
  type PlayerView,
  type ServerMessage,
  type Slot,
} from '@bbc/shared';
import { GameTransport, type ConnectionStatus } from '../net/transport';
import { audio } from '../audio/audio';
import { particles } from '../fx/particles';
import { currentSettings } from './settings';

export type Route =
  | 'MENU'
  | 'BOT_SETUP'
  | 'FRIEND'
  | 'CREATE'
  | 'JOIN'
  | 'HOW_TO_PLAY'
  | 'SETTINGS';

export type Busy =
  | null
  | 'CONNECTING'
  | 'CREATING_PARTY'
  | 'JOINING_PARTY'
  | 'STARTING_GAME'
  | 'WAITING_FOR_PLAYER';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: 'error' | 'info';
}

/** The chip someone has committed to, before anyone learns what was under it. */
export interface PendingReveal {
  readonly index: ChipIndex;
  /** Whose plate is opening: yours, or the one you sabotaged. */
  readonly side: 'you' | 'them';
}

/**
 * How long a chip holds its breath before opening. It is identical for a bomb
 * and a safe chip on purpose — pausing longer before a bomb would tell the
 * player the answer through timing alone, which is exactly the kind of leak the
 * server-side design exists to prevent.
 */
const TENSION_MS = 460;
const RESULT_HOLD_MS = 620;

const SESSION_KEY = 'bbc.session.v1';

/** Per tab, not per browser: two tabs on one machine must be two players. */
function readSessionToken(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSessionToken(token: string | null): void {
  try {
    if (token === null) window.sessionStorage.removeItem(SESSION_KEY);
    else window.sessionStorage.setItem(SESSION_KEY, token);
  } catch {
    // Storage can be unavailable; reconnection simply will not survive a reload.
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface StoreState {
  route: Route;
  status: ConnectionStatus;
  latencyMs: number;
  clockOffsetMs: number;
  busy: Busy;
  party: PartyView | null;
  view: PlayerView | null;
  pending: PendingReveal | null;
  toast: Toast | null;
  /** Bumped to trigger a screen shake; components watch the number, not a flag. */
  shakeToken: number;
  celebrateToken: number;
  setupSelection: ChipIndex[];
  botDifficulty: BotDifficulty;

  boot: () => void;
  go: (route: Route) => void;
  back: () => void;
  playBot: (difficulty: BotDifficulty) => void;
  createParty: () => void;
  joinParty: (code: string) => void;
  setReady: (ready: boolean) => void;
  leave: () => void;
  toggleSetupChip: (index: ChipIndex) => void;
  randomiseSetup: () => void;
  confirmSetup: () => void;
  makeMove: (index: ChipIndex) => void;
  requestRematch: () => void;
  dismissToast: () => void;
}

let transport: GameTransport | null = null;
let toastCounter = 0;

/** Queue of server pushes waiting to be presented, so animations never overlap. */
const inbox: Array<{ view: PlayerView; events: readonly GameEvent[] }> = [];
let draining = false;

export const useGame = create<StoreState>((set, get) => {
  const toast = (message: string, tone: Toast['tone'] = 'error'): void => {
    toastCounter += 1;
    set({ toast: { id: toastCounter, message, tone } });
    if (tone === 'error') audio.play('error');
  };

  const beat = (ms: number): Promise<void> =>
    currentSettings().reducedMotion ? Promise.resolve() : delay(ms);

  async function present(item: { view: PlayerView; events: readonly GameEvent[] }): Promise<void> {
    const previous = get().view;

    // A new game means a new plate: never carry a stale layout into a rematch.
    if (previous?.gameId !== item.view.gameId) set({ setupSelection: [] });

    const bite = item.events.find((event) => event.type === 'CHIP_EATEN');

    if (!bite) {
      set({ view: item.view, busy: null });
      if (item.events.some((event) => event.type === 'GAME_START')) audio.play('turn');
      if (item.view.phase === 'ENDED') announceResult(item.view);
      return;
    }

    // Hold the chip for a beat. `pending` deliberately carries no answer.
    const mine = bite.by === item.view.you;
    set({ pending: { index: bite.index, side: mine ? 'you' : 'them' } });
    audio.play('reveal');
    await beat(TENSION_MS);

    set({ view: item.view, pending: null, busy: null });

    if (bite.isBomb) {
      // A detonation is loud either way, but only your own is felt.
      audio.play('bomb');
      set({ shakeToken: get().shakeToken + 1 });
      audio.vibrate(mine ? [0, 60, 40, 140] : [0, 25]);
    } else if (mine) {
      audio.play('safe');
      audio.vibrate(18);
    }

    if (item.view.phase === 'ENDED') {
      await beat(RESULT_HOLD_MS);
      announceResult(item.view);
    } else if (previous && previous.currentTurn !== item.view.currentTurn) {
      audio.play('turn');
    }
  }

  function announceResult(view: PlayerView): void {
    if (view.youWon) {
      audio.play('victory');
      audio.vibrate([0, 60, 40, 60, 40, 120]);
      if (!currentSettings().reducedMotion) particles.rain(1_600);
    } else {
      audio.play('defeat');
      audio.vibrate([0, 120]);
    }
    set({ celebrateToken: get().celebrateToken + 1 });
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (inbox.length > 0) {
        const next = inbox.shift();
        if (next) await present(next);
      }
    } finally {
      draining = false;
    }
  }

  function handle(message: ServerMessage): void {
    switch (message.t) {
      case 'HELLO':
        return;

      case 'PONG':
        set({
          latencyMs: transport?.latencyMs ?? 0,
          clockOffsetMs: transport?.clockOffsetMs ?? 0,
        });
        return;

      case 'ACK':
        return;

      case 'PARTY': {
        if (message.session) writeSessionToken(message.session.token);
        const waiting = message.party.status === 'LOBBY' && message.party.members.length < 2;
        const previous = get().party;
        set({ party: message.party, busy: waiting ? 'WAITING_FOR_PLAYER' : null });
        if (previous && previous.members.length === 1 && message.party.members.length === 2) {
          audio.play('joined');
        }
        return;
      }

      case 'STATE':
        inbox.push({ view: message.view, events: message.events });
        void drain();
        return;

      case 'ERROR': {
        const code: ErrorCode = message.code;
        // A refused bite is a normal part of play (a stale tap, a fast double
        // click). Only surface the ones a player can act on.
        const quiet: ErrorCode[] = ['NOT_YOUR_TURN', 'ALREADY_REVEALED', 'RATE_LIMITED'];
        if (!quiet.includes(code)) toast(message.message || ERROR_MESSAGES[code]);
        set({ busy: null });
        return;
      }

      case 'PARTY_CLOSED':
        writeSessionToken(null);
        set({ party: null, view: null, pending: null, busy: null, route: 'MENU' });
        toast(message.reason, 'info');
        return;
    }
  }

  function ensureTransport(): GameTransport {
    if (transport) return transport;
    transport = new GameTransport({
      onMessage: handle,
      onStatus: (status) => {
        set({ status });
        if (status === 'connecting') set({ busy: 'CONNECTING' });
        if (status === 'open' && get().busy === 'CONNECTING') set({ busy: null });
      },
      onReopen: () => {
        // Back from a drop: try to reclaim the seat we had.
        const token = readSessionToken();
        if (token) transport?.send({ t: 'RESUME_SESSION', token });
      },
    });
    return transport;
  }

  return {
    route: 'MENU',
    status: 'offline',
    latencyMs: 0,
    clockOffsetMs: 0,
    busy: null,
    party: null,
    view: null,
    pending: null,
    toast: null,
    shakeToken: 0,
    celebrateToken: 0,
    setupSelection: [],
    botDifficulty: 'NORMAL',

    boot() {
      const link = ensureTransport();
      link.connect();
      const token = readSessionToken();
      if (token) link.send({ t: 'RESUME_SESSION', token });
    },

    go(route) {
      audio.unlock();
      audio.play('click');
      set({ route });
    },

    back() {
      audio.play('click');
      set({ route: 'MENU' });
    },

    playBot(difficulty) {
      audio.unlock();
      audio.play('click');
      set({ botDifficulty: difficulty, busy: 'STARTING_GAME', setupSelection: [] });
      ensureTransport().send({
        t: 'START_BOT_GAME',
        name: currentSettings().playerName,
        difficulty,
      });
    },

    createParty() {
      audio.unlock();
      audio.play('click');
      set({ busy: 'CREATING_PARTY', route: 'CREATE', setupSelection: [] });
      ensureTransport().send({ t: 'CREATE_PARTY', name: currentSettings().playerName });
    },

    joinParty(code) {
      audio.unlock();
      audio.play('click');
      set({ busy: 'JOINING_PARTY', setupSelection: [] });
      ensureTransport().send({
        t: 'JOIN_PARTY',
        code: normalisePartyCode(code),
        name: currentSettings().playerName,
      });
    },

    setReady(ready) {
      audio.play('click');
      ensureTransport().send({ t: 'SET_READY', ready });
    },

    leave() {
      audio.play('click');
      writeSessionToken(null);
      transport?.send({ t: 'LEAVE_PARTY' });
      inbox.length = 0;
      set({ party: null, view: null, pending: null, busy: null, route: 'MENU', setupSelection: [] });
    },

    toggleSetupChip(index) {
      const current = get().setupSelection;
      if (current.includes(index)) {
        audio.play('undo');
        set({ setupSelection: current.filter((value) => value !== index) });
        return;
      }
      if (current.length >= BOMB_COUNT) return;
      audio.play('place');
      audio.vibrate(12);
      set({ setupSelection: [...current, index] });
    },

    randomiseSetup() {
      audio.play('place');
      const shuffled = [...CHIP_INDICES];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const swap = shuffled[i] as ChipIndex;
        shuffled[i] = shuffled[j] as ChipIndex;
        shuffled[j] = swap;
      }
      set({ setupSelection: shuffled.slice(0, BOMB_COUNT) });
    },

    confirmSetup() {
      const selection = get().setupSelection;
      if (selection.length !== BOMB_COUNT) return;
      audio.play('select');
      ensureTransport().send({ t: 'PLACE_BOMBS', positions: selection });
    },

    makeMove(index) {
      const view = get().view;
      if (!view || !view.isYourTurn || get().pending) return;
      // You only ever eat from your own plate.
      if (view.yourPlate.cells[index]?.state !== 'HIDDEN') return;
      audio.play('select');
      audio.vibrate(10);
      ensureTransport().send({ t: 'MAKE_MOVE', index });
    },

    requestRematch() {
      audio.play('click');
      ensureTransport().send({ t: 'REQUEST_REMATCH' });
    },

    dismissToast() {
      set({ toast: null });
    },
  };
});

/** Where the app should be: derived, so the UI has one source of truth. */
export type Stage = 'MENU_STACK' | 'LOBBY' | 'SETUP' | 'GAME' | 'RESULT';

export function stageOf(state: Pick<StoreState, 'view' | 'party' | 'route'>): Stage {
  if (state.view) {
    if (state.view.phase === 'ENDED') return 'RESULT';
    if (state.view.phase === 'SETUP') return 'SETUP';
    return 'GAME';
  }
  if (state.party && state.party.status !== 'CLOSED') return 'LOBBY';
  return 'MENU_STACK';
}

export function opponentName(view: PlayerView | null, party: PartyView | null): string {
  if (view) return view.opponent.name;
  const other = party?.members.find((member) => member.slot !== party.you);
  return other?.name ?? 'Opponent';
}

export function slotOf(view: PlayerView | null): Slot | null {
  return view?.you ?? null;
}
