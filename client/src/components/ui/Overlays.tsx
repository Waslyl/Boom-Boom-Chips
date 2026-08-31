import { AnimatePresence, motion } from 'motion/react';
import { useGame, type Busy } from '../../state/store';

const BUSY_COPY: Record<Exclude<Busy, null>, string> = {
  CONNECTING: 'Connecting…',
  CREATING_PARTY: 'Creating party…',
  JOINING_PARTY: 'Joining party…',
  STARTING_GAME: 'Starting game…',
  WAITING_FOR_PLAYER: 'Waiting for player…',
};

function Spinner() {
  return (
    <div className="relative h-14 w-14">
      <motion.span
        className="absolute inset-0 rounded-full border-2 border-transparent"
        style={{ borderTopColor: 'var(--color-cyan)', borderRightColor: 'var(--color-cyan)' }}
        animate={{ rotate: 360 }}
        transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
      />
      <motion.span
        className="absolute inset-2 rounded-full border-2 border-transparent"
        style={{ borderBottomColor: 'var(--color-bomb)' }}
        animate={{ rotate: -360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}

/**
 * Connection state, shown only when it matters. A brief blip while nobody is
 * mid-match does not deserve a full-screen takeover.
 */
export function ConnectionOverlay() {
  const status = useGame((state) => state.status);
  const view = useGame((state) => state.view);
  const party = useGame((state) => state.party);

  const inMatch = view !== null || party !== null;
  const show = status === 'reconnecting' || (status === 'offline' && inMatch);

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          className="fixed inset-0 z-45 grid place-items-center bg-[#05060b]/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="alertdialog"
          aria-live="assertive"
          aria-label="Reconnecting"
        >
          <div className="flex flex-col items-center gap-4 text-center">
            <Spinner />
            <p className="font-[family-name:var(--font-display)] text-lg tracking-[0.2em] uppercase">
              Reconnecting…
            </p>
            <p className="max-w-xs text-sm text-[var(--color-ink-dim)]">
              Your seat is held for a minute. The match is waiting.
            </p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Inline loading state for the short waits between screens. */
export function BusyOverlay() {
  const busy = useGame((state) => state.busy);
  const party = useGame((state) => state.party);

  // "Waiting for player" is part of the party screen itself, not an overlay.
  const show = busy !== null && busy !== 'WAITING_FOR_PLAYER' && !(busy === 'CREATING_PARTY' && party);

  return (
    <AnimatePresence>
      {show && busy ? (
        <motion.div
          className="pointer-events-none fixed inset-0 z-44 grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="glass flex items-center gap-3 rounded-full px-5 py-3">
            <motion.span
              className="h-2.5 w-2.5 rounded-full bg-[var(--color-cyan)]"
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 1.1, repeat: Infinity }}
            />
            <span className="font-[family-name:var(--font-display)] text-sm tracking-[0.16em] uppercase">
              {BUSY_COPY[busy]}
            </span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
