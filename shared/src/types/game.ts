import type { ChipIndex, EpochMs, GameId, MatchMode, BotDifficulty, Slot } from './core.js';

export type GamePhase = 'SETUP' | 'PLAYING' | 'ENDED';

export type EndReason =
  | 'ELIMINATED'
  | 'OPPONENT_LEFT'
  | 'DISCONNECT_TIMEOUT'
  | 'SETUP_TIMEOUT';

/**
 * One player's plate: the nine chips in front of them, which they alone eat.
 *
 * The bombs in it were planted by the OTHER player, so `bombs` is secret from
 * the plate's own owner — that inversion is the heart of the game and the
 * reason the redaction layer exists.
 */
export interface Plate {
  /** Planted by the opponent. Exactly BOMB_COUNT once setup is complete. */
  readonly bombs: readonly ChipIndex[];
  /** Chips the owner has eaten, in order. */
  readonly eaten: readonly ChipIndex[];
}

export interface PlayerInfo {
  readonly id: string;
  readonly name: string;
  readonly isBot: boolean;
  readonly botDifficulty?: BotDifficulty;
  readonly connected: boolean;
  /** When disconnected, the moment the grace period expires. */
  readonly disconnectedUntil?: EpochMs;
}

export interface MoveRecord {
  readonly turnNumber: number;
  /** Who ate. The chip is always from their own plate. */
  readonly by: Slot;
  readonly index: ChipIndex;
  readonly wasBomb: boolean;
  readonly at: EpochMs;
}

export interface GameRules {
  /** Milliseconds allowed per turn, or null for no limit. */
  readonly turnTimeLimitMs: number | null;
  /** Milliseconds allowed to plant bombs, or null for no limit. */
  readonly setupTimeLimitMs: number | null;
}

/**
 * FULL TRUTH. Server-only. This object must never be serialised to a client;
 * `toPlayerView` is the single, audited exit door.
 */
export interface GameState {
  readonly gameId: GameId;
  readonly mode: MatchMode;
  readonly rules: GameRules;
  readonly phase: GamePhase;
  readonly players: Readonly<Record<Slot, PlayerInfo>>;
  /** `plates.P1` is the plate P1 eats from; its bombs were planted by P2. */
  readonly plates: Readonly<Record<Slot, Plate>>;
  /** Has this player finished planting bombs in the opponent's plate? */
  readonly bombsPlanted: Readonly<Record<Slot, boolean>>;
  readonly currentTurn: Slot;
  readonly turnNumber: number;
  readonly deadline: EpochMs | null;
  readonly winner: Slot | null;
  readonly endReason: EndReason | null;
  readonly history: readonly MoveRecord[];
  readonly rematch: Readonly<Record<Slot, boolean>>;
  readonly createdAt: EpochMs;
  readonly startedAt: EpochMs | null;
  readonly endedAt: EpochMs | null;
}

/* ------------------------------------------------------------------ */
/* Redacted projections — the ONLY game shapes allowed over the wire.  */
/* ------------------------------------------------------------------ */

export type CellState = 'HIDDEN' | 'SAFE' | 'BOMB';

export interface CellView {
  readonly state: CellState;
  /** Order it was eaten (1-based), for staggered end-game reveals. */
  readonly order?: number;
}

/**
 * The plate you eat from. Deliberately has no bomb list: the mines under these
 * chips are your opponent's, and you find out the same way they intended —
 * one bite at a time.
 */
export interface YourPlateView {
  readonly cells: readonly CellView[];
  readonly livesLost: number;
  readonly lives: number;
}

/** Their plate, which you sabotaged. You may know what you planted there. */
export interface TheirPlateView {
  readonly cells: readonly CellView[];
  /** The bombs YOU planted. Yours to know; never sent to them. */
  readonly yourBombs: readonly ChipIndex[];
  readonly livesLost: number;
  readonly lives: number;
}

export interface PlayerView {
  readonly gameId: GameId;
  readonly mode: MatchMode;
  readonly phase: GamePhase;
  readonly you: Slot;
  readonly yourName: string;
  readonly opponent: {
    readonly name: string;
    readonly isBot: boolean;
    readonly botDifficulty?: BotDifficulty;
    readonly connected: boolean;
    readonly disconnectedUntil?: EpochMs;
  };
  readonly yourPlate: YourPlateView;
  readonly theirPlate: TheirPlateView;
  readonly bombsPlanted: { readonly you: boolean; readonly opponent: boolean };
  readonly currentTurn: Slot;
  readonly isYourTurn: boolean;
  readonly turnNumber: number;
  readonly deadline: EpochMs | null;
  readonly winner: Slot | null;
  readonly youWon: boolean | null;
  readonly endReason: EndReason | null;
  readonly rematch: { readonly you: boolean; readonly opponent: boolean };
  /** Populated only when phase === 'ENDED'. */
  readonly finalReveal: {
    /** The bombs that were waiting in YOUR plate, planted by them. */
    readonly bombsAgainstYou: readonly ChipIndex[];
    /** The bombs you planted in theirs. */
    readonly bombsYouPlanted: readonly ChipIndex[];
  } | null;
}
