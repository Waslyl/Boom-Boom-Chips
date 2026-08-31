import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { CellView, ChipIndex } from '@bbc/shared';
import { useGame } from '../state/store';
import { Grid, type GridMode } from '../components/grid/Grid';
import { Button } from '../components/ui/Button';
import { Column, ScreenTransition, TopBar } from '../components/ui/Layout';

interface Step {
  title: string;
  body: string;
  /** Cells to show as already eaten in the demo plate. */
  eaten: Partial<Record<ChipIndex, 'SAFE' | 'BOMB'>>;
  planted?: ChipIndex[];
  mode: GridMode;
  caption: string;
}

/**
 * Six steps, each with a live plate rather than a paragraph. The demo uses the
 * real Chip and Grid components, so what you learn here is what you will touch.
 */
const STEPS: Step[] = [
  {
    title: 'Nine chips each',
    body: 'You get a plate of 3×3 chips. So does your opponent.',
    eaten: {},
    mode: 'plate',
    caption: 'Your plate',
  },
  {
    title: 'You rig theirs',
    body: 'Secretly hide 3 bombs in your opponent’s plate. They do exactly the same to yours.',
    eaten: {},
    planted: [0, 4, 8],
    mode: 'setup',
    caption: 'Their plate — your traps',
  },
  {
    title: 'You never see yours',
    body: 'The bombs under your own chips are their secret. Your plate stays face-down until you bite.',
    eaten: {},
    mode: 'plate',
    caption: 'Your plate, all unknown',
  },
  {
    title: 'Eat your own chips',
    body: 'On your turn you must eat one chip from your own plate. Then it is their turn.',
    eaten: { 2: 'SAFE' },
    mode: 'plate',
    caption: 'Safe. You survive.',
  },
  {
    title: 'A bomb costs a life',
    body: 'Bite into one of their bombs and it goes off. You start with 3 lives.',
    eaten: { 2: 'SAFE', 5: 'BOMB' },
    mode: 'plate',
    caption: '💥 2 lives left',
  },
  {
    title: 'Last one standing wins',
    body: 'Lose all 3 lives and you are out. Survive longer than they do and the match is yours.',
    eaten: { 2: 'SAFE', 5: 'BOMB', 3: 'BOMB', 7: 'BOMB' },
    mode: 'plate',
    caption: 'Out of lives',
  },
];

function cellsFor(step: Step): CellView[] {
  return Array.from({ length: 9 }, (_, index) => {
    const state = step.eaten[index as ChipIndex];
    return state ? { state, order: 1 } : { state: 'HIDDEN' as const };
  });
}

export function HowToPlayScreen() {
  const back = useGame((state) => state.back);
  const [step, setStep] = useState(0);
  const current = STEPS[step] as Step;
  const last = step === STEPS.length - 1;

  // Let the demo advance itself so the page feels alive, but stop the moment
  // someone takes control of it.
  const [autoplay, setAutoplay] = useState(true);
  useEffect(() => {
    if (!autoplay) return;
    const timer = setTimeout(() => setStep((value) => (value + 1) % STEPS.length), 3_600);
    return () => clearTimeout(timer);
  }, [step, autoplay]);

  const goTo = (next: number): void => {
    setAutoplay(false);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  };

  return (
    <ScreenTransition className="flex flex-1 flex-col">
      <TopBar title="How to play" onBack={back} />

      <Column width="sm" className="flex flex-1 flex-col items-center justify-center gap-5">
        <div className="flex flex-col items-center gap-2">
          <div style={{ width: 'min(64vw, 30vh, 260px)' }}>
            <Grid
              key={step}
              mode={current.mode}
              cells={cellsFor(current)}
              plantedBombs={current.planted ?? []}
              selection={current.mode === 'setup' ? (current.planted ?? []) : []}
              ariaLabel={current.caption}
            />
          </div>
          <p className="text-xs tracking-[0.14em] text-[var(--color-ink-faint)] uppercase">
            {current.caption}
          </p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            className="min-h-[7.5rem] text-center"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.26 }}
          >
            <p className="eyebrow mb-1">
              Step {step + 1} of {STEPS.length}
            </p>
            <h3 className="text-2xl">{current.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-dim)]">
              {current.body}
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center gap-2" role="tablist" aria-label="Tutorial steps">
          {STEPS.map((entry, index) => (
            <button
              key={entry.title}
              type="button"
              role="tab"
              aria-selected={index === step}
              aria-label={`Step ${index + 1}: ${entry.title}`}
              onClick={() => goTo(index)}
              className="h-2.5 rounded-full transition-all"
              style={{
                width: index === step ? 26 : 10,
                background: index === step ? 'var(--color-cyan)' : 'rgba(255,255,255,0.16)',
              }}
            />
          ))}
        </div>

        <div className="flex w-full max-w-sm gap-3">
          <Button variant="ghost" onClick={() => goTo(step - 1)} disabled={step === 0}>
            Back
          </Button>
          {last ? (
            <Button variant="primary" className="flex-1" onClick={back}>
              Got it
            </Button>
          ) : (
            <Button variant="primary" className="flex-1" onClick={() => goTo(step + 1)}>
              Next
            </Button>
          )}
        </div>
      </Column>
    </ScreenTransition>
  );
}
