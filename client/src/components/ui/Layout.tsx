import type { ReactNode } from 'react';
import { motion } from 'motion/react';

/** Standard entrance for a whole screen, so navigation feels like one system. */
export function ScreenTransition({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Panel({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'aside';
}) {
  return (
    <Tag className={`glass rounded-[var(--radius-xl)] p-5 ${className}`}>{children}</Tag>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

/** A centred column that never gets uncomfortably wide on a desktop monitor. */
export function Column({
  children,
  className = '',
  width = 'md',
}: {
  children: ReactNode;
  className?: string;
  width?: 'sm' | 'md' | 'lg';
}) {
  const max = width === 'sm' ? 'max-w-md' : width === 'lg' ? 'max-w-5xl' : 'max-w-xl';
  return <div className={`mx-auto w-full ${max} ${className}`}>{children}</div>;
}

export function TopBar({
  onBack,
  title,
  right,
}: {
  onBack?: () => void;
  title: string;
  right?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-3 py-1">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--color-line)] bg-white/5 text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
            <path
              d="m14.5 6-6 6 6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <span className="h-11 w-11 shrink-0" />
      )}
      <h2 className="flex-1 text-center text-lg tracking-[0.14em] uppercase">{title}</h2>
      <span className="flex h-11 min-w-11 shrink-0 items-center justify-end">{right}</span>
    </header>
  );
}
