import { motion } from 'motion/react';
import { BOT_DIFFICULTIES, type BotDifficulty } from '@bbc/shared';
import { useGame } from '../state/store';
import { audio } from '../audio/audio';
import { Column, ScreenTransition, TopBar } from '../components/ui/Layout';

interface Rung {
  label: string;
  colour: string;
  blurb: string;
}

/**
 * The copy is honest about what changes between rungs: the bot's read on you,
 * never extra information. Every difficulty sees exactly what you send it.
 */
const RUNGS: Record<BotDifficulty, Rung> = {
  EASY: {
    label: 'Easy',
    colour: 'var(--color-safe)',
    blurb: 'Bites at random. Rigs your plate at random.',
  },
  NORMAL: {
    label: 'Normal',
    colour: 'var(--color-gold)',
    blurb: 'Plays the odds, but drifts. A fair fight.',
  },
  HARD: {
    label: 'Hard',
    colour: 'var(--color-ember)',
    blurb: 'Knows where people hide bombs, and hides its own where you reach.',
  },
  EXPERT: {
    label: 'Expert',
    colour: 'var(--color-bomb)',
    blurb: 'Learns how you hide and how you snack, then adapts between games.',
  },
};

export function BotSetupScreen() {
  const back = useGame((state) => state.back);
  const playBot = useGame((state) => state.playBot);

  return (
    <ScreenTransition className="flex flex-1 flex-col">
      <TopBar title="Choose a rival" onBack={back} />

      <Column width="sm" className="flex flex-1 flex-col justify-center gap-3 py-4">
        {BOT_DIFFICULTIES.map((difficulty, index) => {
          const rung = RUNGS[difficulty];
          return (
            <motion.button
              key={difficulty}
              type="button"
              onPointerEnter={() => audio.play('hover')}
              onClick={() => playBot(difficulty)}
              className="glass group relative flex items-center gap-4 rounded-[var(--radius-xl)] p-4 text-left"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.07, type: 'spring', stiffness: 260, damping: 24 }}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.985 }}
            >
              <span
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full"
                style={{
                  background: `radial-gradient(circle at 35% 30%, ${rung.colour}, color-mix(in oklab, ${rung.colour} 30%, #000))`,
                  boxShadow: `0 0 26px -6px ${rung.colour}`,
                }}
              >
                <span className="font-[family-name:var(--font-display)] text-lg font-bold text-black/70">
                  {index + 1}
                </span>
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className="block font-[family-name:var(--font-display)] text-lg font-bold tracking-wide uppercase"
                  style={{ color: rung.colour }}
                >
                  {rung.label}
                </span>
                <span className="block text-sm text-[var(--color-ink-dim)]">{rung.blurb}</span>
              </span>

              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:translate-x-1"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m9.5 6 6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </motion.button>
          );
        })}

        <p className="mt-2 text-center text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Every bot plays from the same information you get. None of them can see
          what is under its own chips.
        </p>
      </Column>
    </ScreenTransition>
  );
}
