/**
 * Wire protocol.
 *
 * Shape: "state + events". Every server reply that changes the match carries
 * the receiver's FULL `PlayerView` plus the events that produced it. The view
 * is the truth the client renders; the events are only animation cues. A
 * client that misses events still converges, which is what makes reconnection
 * and packet loss boring instead of catastrophic.
 */
import type { BotDifficulty, PartyCode, Slot } from '../types/core.js';
import type { PlayerView } from '../types/game.js';
import type { GameEvent } from '../game/events.js';
import type { ErrorCode } from './codes.js';

export const PROTOCOL_VERSION = 1;

export type PartyStatus = 'LOBBY' | 'IN_GAME' | 'CLOSED';

export interface PartyMemberView {
  readonly slot: Slot;
  readonly name: string;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly isBot: boolean;
}

export interface PartyView {
  /** null for solo bot matches, which have no shareable code. */
  readonly code: PartyCode | null;
  readonly you: Slot;
  readonly hostSlot: Slot;
  readonly status: PartyStatus;
  readonly members: readonly PartyMemberView[];
}

export interface SessionTicket {
  /** Signed, opaque. Lets one browser tab reclaim its seat after a reload. */
  readonly token: string;
  readonly expiresAt: number;
}

/* ------------------------------- client -> server ------------------------------- */

export type ClientMessage =
  | { readonly t: 'PING'; readonly reqId: string; readonly clientTime: number }
  | { readonly t: 'CREATE_PARTY'; readonly reqId: string; readonly name: string }
  | { readonly t: 'JOIN_PARTY'; readonly reqId: string; readonly code: string; readonly name: string }
  | { readonly t: 'LEAVE_PARTY'; readonly reqId: string }
  | { readonly t: 'SET_READY'; readonly reqId: string; readonly ready: boolean }
  | {
      readonly t: 'START_BOT_GAME';
      readonly reqId: string;
      readonly name: string;
      readonly difficulty: BotDifficulty;
    }
  | { readonly t: 'PLACE_BOMBS'; readonly reqId: string; readonly positions: readonly number[] }
  | { readonly t: 'MAKE_MOVE'; readonly reqId: string; readonly index: number }
  | { readonly t: 'REQUEST_REMATCH'; readonly reqId: string }
  | { readonly t: 'RESUME_SESSION'; readonly reqId: string; readonly token: string };

export type ClientMessageType = ClientMessage['t'];

/* ------------------------------- server -> client ------------------------------- */

export type ServerMessage =
  | {
      readonly t: 'HELLO';
      readonly protocolVersion: number;
      readonly serverTime: number;
    }
  | { readonly t: 'PONG'; readonly reqId: string; readonly clientTime: number; readonly serverTime: number }
  | { readonly t: 'ACK'; readonly reqId: string }
  | {
      readonly t: 'ERROR';
      readonly reqId: string | null;
      readonly code: ErrorCode;
      readonly message: string;
    }
  | {
      readonly t: 'PARTY';
      readonly party: PartyView;
      readonly session?: SessionTicket;
    }
  | { readonly t: 'PARTY_CLOSED'; readonly reason: string }
  | {
      readonly t: 'STATE';
      /** Monotonic per seat; lets a reconnecting client drop replays it already showed. */
      readonly seq: number;
      readonly view: PlayerView;
      readonly events: readonly GameEvent[];
      readonly serverTime: number;
    };

export type ServerMessageType = ServerMessage['t'];
