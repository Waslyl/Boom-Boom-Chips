import { BOMB_COUNT } from '@bbc/shared';
import { motion } from 'motion/react';

interface BombTrackerProps {
  found: number;
  label: string;
  tone?: 'hunt' | 'threat';
  compact?: boolean;
}

/**
 * The score. It says how many bombs have been uncovered and nothing about
 * where the rest are — the counter is deliberately positionless.
 */
export function BombTracker({ found, label, tone = 'hunt', compact = false }: BombTrackerProps) {
  const accent = tone === 'threat' ? 'var(--color-bomb)' : 'var(--color-gold)';

  return (
    <div className={compact ? 'flex items-center gap-2.5' : 'flex flex-col items-center gap-2'}>
      <p className={`eyebrow leading-tight ${compact ? 'whitespace-nowrap' : 'text-center'}`}>{label}</p>
      <div className="flex items-center gap-2">
        <div className="flex gap-1.5" role="img" aria-label={`${found} of ${BOMB_COUNT} found`}>
          {Array.from({ length: BOMB_COUNT }, (_, slot) => {
            const filled = slot < found;
            return (
              <motion.span
                key={slot}
                className="grid place-items-center rounded-full border"
                style={{
                  width: compact ? 16 : 20,
                  height: compact ? 16 : 20,
                  borderColor: filled ? accent : 'var(--color-line-strong)',
                  background: filled ? accent : 'transparent',
                  boxShadow: filled ? `0 0 14px -2px ${accent}` : 'none',
                }}
                initial={false}
                animate={filled ? { scale: [1, 1.35, 1] } : { scale: 1 }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              />
            );
          })}
        </div>
        <span
          className="font-[family-name:var(--font-display)] text-sm font-bold tabular-nums"
          style={{ color: found > 0 ? accent : 'var(--color-ink-faint)' }}
        >
          {found}/{BOMB_COUNT}
        </span>
      </div>
    </div>
  );
}
