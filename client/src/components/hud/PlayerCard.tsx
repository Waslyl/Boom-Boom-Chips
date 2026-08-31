import { motion } from 'motion/react';

interface PlayerCardProps {
  name: string;
  isYou: boolean;
  isBot?: boolean;
  difficulty?: string | undefined;
  connected?: boolean;
  /** True when this player is the one on the clock. */
  active: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + second).toUpperCase().slice(0, 2);
}

/**
 * Who is playing and whose turn it is. The bomb counters live in their own
 * component beside this one — putting them inside the card as well squeezed the
 * name to nothing in a narrow side column, and said the same thing twice.
 */
export function PlayerCard({
  name,
  isYou,
  isBot = false,
  difficulty,
  connected = true,
  active,
}: PlayerCardProps) {
  const status = isBot
    ? difficulty
      ? `${difficulty.toLowerCase()} bot`
      : 'bot'
    : !connected
      ? 'reconnecting…'
      : active
        ? 'choosing…'
        : 'waiting';

  return (
    <motion.div
      className="glass relative flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-3 py-2.5"
      animate={{
        borderColor: active ? 'color-mix(in oklab, var(--color-cyan) 55%, transparent)' : undefined,
        boxShadow: active
          ? '0 0 0 1px color-mix(in oklab, var(--color-cyan) 40%, transparent), 0 12px 40px -22px var(--color-cyan)'
          : '0 24px 60px -30px #000000cc',
      }}
      transition={{ duration: 0.3 }}
    >
      <div
        className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full font-[family-name:var(--font-display)] text-sm font-bold"
        style={{
          background: isYou
            ? 'linear-gradient(150deg, var(--color-cyan), var(--color-cyan-deep))'
            : 'linear-gradient(150deg, var(--color-violet), #4c1d95)',
          color: isYou ? '#04141b' : '#f6f2ff',
        }}
      >
        {initials(name)}
        {active ? (
          <motion.span
            className="absolute -inset-1 rounded-full border-2"
            style={{ borderColor: 'var(--color-cyan)' }}
            animate={{ opacity: [0.25, 0.9, 0.25], scale: [1, 1.06, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate font-[family-name:var(--font-display)] text-sm font-semibold">
            {name}
          </p>
          {isYou ? (
            <span className="pill shrink-0 px-1.5 py-0.5 text-[0.6rem]">You</span>
          ) : null}
        </div>
        <p
          className="truncate text-[0.7rem]"
          style={{
            color: !isBot && !connected ? 'var(--color-ember)' : 'var(--color-ink-faint)',
          }}
        >
          {status}
        </p>
      </div>
    </motion.div>
  );
}
