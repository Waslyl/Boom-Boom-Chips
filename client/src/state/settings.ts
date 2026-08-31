/**
 * Player preferences, persisted locally.
 *
 * Reduced motion defaults to whatever the operating system asks for, and the
 * toggle then overrides it either way — someone may want the full show on a
 * machine that reports a preference, or a calm screen on one that does not.
 */
import { create } from 'zustand';
import { audio } from '../audio/audio';
import { particles } from '../fx/particles';

export interface Settings {
  sfx: boolean;
  music: boolean;
  vibration: boolean;
  reducedMotion: boolean;
  playerName: string;
}

const STORAGE_KEY = 'bbc.settings.v1';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function randomName(): string {
  return `Player ${Math.floor(1000 + Math.random() * 9000)}`;
}

function load(): Settings {
  const fallback: Settings = {
    sfx: true,
    music: false,
    vibration: true,
    reducedMotion: prefersReducedMotion(),
    playerName: randomName(),
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const bag = parsed as Partial<Record<keyof Settings, unknown>>;
    return {
      sfx: typeof bag.sfx === 'boolean' ? bag.sfx : fallback.sfx,
      music: typeof bag.music === 'boolean' ? bag.music : fallback.music,
      vibration: typeof bag.vibration === 'boolean' ? bag.vibration : fallback.vibration,
      reducedMotion:
        typeof bag.reducedMotion === 'boolean' ? bag.reducedMotion : fallback.reducedMotion,
      playerName:
        typeof bag.playerName === 'string' && bag.playerName.trim().length > 0
          ? bag.playerName.slice(0, 14)
          : fallback.playerName,
    };
  } catch {
    // Private mode, disabled storage, corrupt JSON: defaults are always fine.
    return fallback;
  }
}

function save(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not being able to remember a preference is not worth an error.
  }
}

interface SettingsStore extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  toggle(key: 'sfx' | 'music' | 'vibration' | 'reducedMotion'): void;
}

const initial = load();

/** Push the current preferences into the systems that act on them. */
function apply(settings: Settings): void {
  audio.setSfxEnabled(settings.sfx);
  audio.setMusicEnabled(settings.music);
  audio.setVibrationEnabled(settings.vibration);
  particles.setEnabled(!settings.reducedMotion);
  document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...initial,
  set(key, value) {
    set({ [key]: value } as Partial<SettingsStore>);
    const next = get();
    const settings: Settings = {
      sfx: next.sfx,
      music: next.music,
      vibration: next.vibration,
      reducedMotion: next.reducedMotion,
      playerName: next.playerName,
    };
    save(settings);
    apply(settings);
  },
  toggle(key) {
    get().set(key, !get()[key]);
  },
}));

/** Called once at boot, before React renders. */
export function initSettings(): void {
  apply(initial);
}

export function currentSettings(): Settings {
  const state = useSettings.getState();
  return {
    sfx: state.sfx,
    music: state.music,
    vibration: state.vibration,
    reducedMotion: state.reducedMotion,
    playerName: state.playerName,
  };
}
