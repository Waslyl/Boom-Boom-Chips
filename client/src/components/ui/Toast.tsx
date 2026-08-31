import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useGame } from '../../state/store';

/**
 * One toast at a time, at the top, out of the way of the grid. Errors from the
 * server arrive here already phrased for a person; the store filters out the
 * ones a player cannot act on.
 */
export function ToastLayer() {
  const toast = useGame((state) => state.toast);
  const dismiss = useGame((state) => state.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismiss, 4_200);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      role="status"
      aria-live="polite"
    >
      <AnimatePresence>
        {toast ? (
          <motion.button
            key={toast.id}
            type="button"
            onClick={dismiss}
            className={`glass pointer-events-auto max-w-md rounded-[var(--radius-lg)] px-4 py-3 text-sm font-medium ${
              toast.tone === 'error' ? 'text-[var(--color-bomb)]' : 'text-[var(--color-ink)]'
            }`}
            initial={{ opacity: 0, y: -22, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            {toast.message}
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
