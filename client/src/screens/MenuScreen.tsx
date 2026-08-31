import { motion } from 'motion/react';
import { useGame } from '../state/store';
import { useSettings } from '../state/settings';
import { Button } from '../components/ui/Button';
import { Column, ScreenTransition } from '../components/ui/Layout';

const TITLE = 'BOOM BOOM CHIPS';

export function MenuScreen() {
  const go = useGame((state) => state.go);
  const name = useSettings((state) => state.playerName);

  return (
    <ScreenTransition className="flex flex-1 flex-col justify-center">
      <Column width="sm" className="flex flex-col items-center gap-8 px-2">
        <div className="text-center">
          <motion.p
            className="eyebrow mb-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            9 chips &middot; 3 bombs &middot; 1 winner
          </motion.p>

          <h1 className="leading-[0.95]">
            {/* The letters are animated one by one, which would otherwise be
                announced as "B O O M B O O M…". The real title is carried by a
                single readable node and the decoration is hidden. */}
            <span className="sr-only">Boom Boom Chips</span>
            {TITLE.split(' ').map((word, wordIndex) => (
              <span key={word} className="block" aria-hidden="true">
                {[...word].map((letter, letterIndex) => (
                  <motion.span
                    key={`${word}-${letterIndex}`}
                    className="inline-block"
                    style={{
                      fontSize: 'clamp(2.4rem, 13vw, 4.4rem)',
                      letterSpacing: '-0.03em',
                      background:
                        wordIndex === 2
                          ? 'linear-gradient(170deg, #fff 10%, var(--color-cyan) 90%)'
                          : 'linear-gradient(170deg, #fff 10%, var(--color-ember) 55%, var(--color-bomb) 95%)',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                      filter:
                        wordIndex === 2
                          ? 'drop-shadow(0 8px 30px #22d3ee66)'
                          : 'drop-shadow(0 8px 30px #ff3b5c55)',
                    }}
                    initial={{ opacity: 0, y: 26, rotateX: -60 }}
                    animate={{ opacity: 1, y: 0, rotateX: 0 }}
                    transition={{
                      delay: 0.1 + wordIndex * 0.09 + letterIndex * 0.03,
                      type: 'spring',
                      stiffness: 260,
                      damping: 18,
                    }}
                  >
                    {letter}
                  </motion.span>
                ))}
              </span>
            ))}
          </h1>
        </div>

        <motion.nav
          className="flex w-full flex-col gap-3"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <Button variant="primary" size="lg" block onClick={() => go('BOT_SETUP')}>
            Play vs Bot
          </Button>
          <Button size="lg" block onClick={() => go('FRIEND')}>
            Play with Friend
          </Button>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <Button variant="ghost" onClick={() => go('HOW_TO_PLAY')}>
              How to Play
            </Button>
            <Button variant="ghost" onClick={() => go('SETTINGS')}>
              Settings
            </Button>
          </div>
        </motion.nav>

        <motion.button
          type="button"
          onClick={() => go('SETTINGS')}
          className="text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink-dim)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          playing as <span className="text-[var(--color-ink-dim)]">{name}</span>
        </motion.button>
      </Column>

    </ScreenTransition>
  );
}
