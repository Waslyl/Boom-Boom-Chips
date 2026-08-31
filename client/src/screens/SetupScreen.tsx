import { AnimatePresence, motion } from 'motion/react';
import { BOMB_COUNT } from '@bbc/shared';
import { useGame } from '../state/store';
import { Grid } from '../components/grid/Grid';
import { Button } from '../components/ui/Button';
import { Column, ScreenTransition } from '../components/ui/Layout';
import { useViewport } from '../hooks/useViewport';

const UNTOUCHED = Array.from({ length: 9 }, () => ({ state: 'HIDDEN' as const }));

/**
 * Planting. You are choosing three chips in your OPPONENT's plate — the chips
 * they will have to eat. Nothing is sent until CONFIRM, and what is sent is
 * only the three positions; the server decides everything after that.
 */
export function SetupScreen() {
  const view = useGame((state) => state.view);
  const selection = useGame((state) => state.setupSelection);
  const toggle = useGame((state) => state.toggleSetupChip);
  const randomise = useGame((state) => state.randomiseSetup);
  const confirm = useGame((state) => state.confirmSetup);
  const leave = useGame((state) => state.leave);
  const { mode } = useViewport();

  if (!view) return null;

  const planted = view.bombsPlanted.you;
  const complete = selection.length === BOMB_COUNT;
  // Once sealed, show what was actually sent — which also survives a reload,
  // because the server hands your own traps back to you.
  const shown = planted ? view.theirPlate.yourBombs : selection;
  const gridWidth = mode === 'portrait' ? 'min(86vw, 46vh, 420px)' : 'min(44vh, 60vw, 380px)';

  return (
    <ScreenTransition className="flex flex-1 flex-col">
      <Column className="flex flex-1 flex-col items-center justify-center gap-5 py-4">
        <div className="text-center">
          <motion.h2
            className="text-[clamp(1.5rem,6.5vw,2.3rem)] tracking-[0.06em] uppercase"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {planted ? 'Bombs planted' : 'Rig their chips'}
          </motion.h2>
          <p className="mx-auto mt-1 max-w-xs text-sm text-[var(--color-ink-dim)]">
            {planted
              ? view.bombsPlanted.opponent
                ? 'Starting…'
                : `Waiting for ${view.opponent.name}…`
              : `Hide ${BOMB_COUNT} bombs in ${view.opponent.name}'s plate. They have to eat it.`}
          </p>
        </div>

        {/* Whose plate this is matters more than anything else on the screen. */}
        <p className="pill" style={{ color: 'var(--color-violet)' }}>
          {view.opponent.name}&apos;s plate
        </p>

        <div style={{ width: gridWidth }}>
          <Grid
            mode="setup"
            cells={UNTOUCHED}
            selection={shown}
            interactive={!planted}
            onSelect={toggle}
            ariaLabel={`${view.opponent.name}'s plate: choose three chips to plant bombs in`}
          />
        </div>

        <div className="flex items-center gap-3">
          {Array.from({ length: BOMB_COUNT }, (_, slot) => {
            const filled = slot < shown.length;
            return (
              <motion.span
                key={slot}
                className="h-2.5 w-9 rounded-full"
                animate={{
                  backgroundColor: filled ? 'var(--color-bomb)' : 'rgba(255,255,255,0.12)',
                  boxShadow: filled ? '0 0 16px -2px var(--color-bomb)' : 'none',
                }}
                transition={{ duration: 0.25 }}
              />
            );
          })}
          <span className="ml-1 font-[family-name:var(--font-display)] text-sm font-bold tabular-nums">
            {shown.length} / {BOMB_COUNT}
          </span>
        </div>

        <AnimatePresence mode="wait">
          {planted ? (
            <motion.div
              key="waiting"
              className="flex items-center gap-3 text-sm text-[var(--color-ink-dim)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.span
                className="h-2 w-2 rounded-full bg-[var(--color-safe)]"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              Their plate is rigged.
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              className="flex w-full max-w-sm gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <Button variant="ghost" onClick={randomise} className="flex-1">
                Randomise
              </Button>
              <Button
                variant="primary"
                onClick={confirm}
                disabled={!complete}
                className="flex-[1.4]"
              >
                Confirm
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </Column>

      <button
        type="button"
        onClick={leave}
        className="mx-auto pb-1 text-xs tracking-[0.16em] text-[var(--color-ink-faint)] uppercase transition-colors hover:text-[var(--color-bomb)]"
      >
        Leave game
      </button>
    </ScreenTransition>
  );
}
