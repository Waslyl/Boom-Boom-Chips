import { motion } from 'motion/react';
import { STARTING_LIVES } from '@bbc/shared';

interface LivesTrackerProps {
  lives: number;
  label: string;
  /** `mine` counts down in warning colours; `theirs` counts down in gold. */
  who: 'mine' | 'theirs';
  size?: 'sm' | 'md' | 'lg';
}

const DOT_SIZE = { sm: 14, md: 20, lg: 28 } as const;

/**
 * Lives, not score. Each pip is one bomb you have left to survive — so it
 * counts DOWN, and the last one is the one that matters. The counter says how
 * close someone is to going out and nothing whatsoever about where the
 * remaining bombs are.
 */
export function LivesTracker({ lives, label, who, size = 'md' }: LivesTrackerProps) {
  const critical = lives === 1;
  const accent = who === 'mine' ? (critical ? 'var(--color-bomb)' : 'var(--color-safe)') : 'var(--color-gold)';
  const dot = DOT_SIZE[size];

  return (
    <div className="flex flex-col items-center gap-1.5">
      <p className="eyebrow leading-tight text-center">{label}</p>
      <div className="flex items-center gap-2">
        <div
          className="flex gap-1.5"
          role="img"
          aria-label={`${lives} of ${STARTING_LIVES} lives left`}
        >
          {Array.from({ length: STARTING_LIVES }, (_, slot) => {
            const alive = slot < lives;
            return (
              <motion.span
                key={slot}
                className="rounded-full border"
                style={{
                  width: dot,
                  height: dot,
                  borderColor: alive ? accent : 'var(--color-line-strong)',
                  background: alive ? accent : 'transparent',
                  boxShadow: alive ? `0 0 14px -2px ${accent}` : 'none',
                }}
                initial={false}
                // A lost life shrinks away rather than simply vanishing.
                animate={
                  alive
                    ? { scale: 1, opacity: 1 }
                    : { scale: [1, 1.3, 0.82], opacity: [1, 1, 0.35] }
                }
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              />
            );
          })}
        </div>
        <span
          className="font-[family-name:var(--font-display)] text-sm font-bold tabular-nums"
          style={{ color: lives === 0 ? 'var(--color-ink-faint)' : accent }}
        >
          {lives}
        </span>
      </div>
      {critical && who === 'mine' ? (
        <motion.p
          className="text-[0.65rem] font-semibold tracking-[0.18em] uppercase"
          style={{ color: 'var(--color-bomb)' }}
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          One left
        </motion.p>
      ) : null}
    </div>
  );
}
