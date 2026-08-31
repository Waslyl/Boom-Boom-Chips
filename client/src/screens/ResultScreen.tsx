import { motion } from 'motion/react';
import { CHIP_INDICES, type CellView, type ChipIndex, type PlayerView } from '@bbc/shared';
import { useGame } from '../state/store';
import { Grid } from '../components/grid/Grid';
import { Button } from '../components/ui/Button';
import { Column, ScreenTransition } from '../components/ui/Layout';
import { useViewport } from '../hooks/useViewport';

/**
 * Both plates open at the end. This builds the fully revealed cells from the
 * layouts the server finally disclosed — the client is not inferring anything,
 * it is drawing what it was told once the match was over.
 */
function revealedCells(bombs: readonly ChipIndex[], played: readonly CellView[]): CellView[] {
  return CHIP_INDICES.map((index) => {
    const cell = played[index];
    const isBomb = bombs.includes(index);
    return {
      state: isBomb ? ('BOMB' as const) : ('SAFE' as const),
      // Chips that were actually eaten keep their order, for a staggered reveal.
      ...(cell?.order !== undefined ? { order: cell.order } : {}),
    };
  });
}

function ResultPlate({
  title,
  caption,
  bombs,
  cells,
  width,
  accent,
}: {
  title: string;
  caption: string;
  bombs: readonly ChipIndex[];
  cells: readonly CellView[];
  width: string;
  accent: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="eyebrow" style={{ color: accent }}>
        {title}
      </p>
      <div style={{ width }}>
        <Grid
          mode="trap"
          cells={revealedCells(bombs, cells)}
          plantedBombs={bombs}
          revealAll
          ariaLabel={title}
        />
      </div>
      <p className="text-center text-[0.7rem] text-[var(--color-ink-faint)]">{caption}</p>
    </div>
  );
}

export function ResultScreen() {
  const view = useGame((state) => state.view) as PlayerView | null;
  const rematch = useGame((state) => state.requestRematch);
  const leave = useGame((state) => state.leave);
  const { mode } = useViewport();

  if (!view || !view.finalReveal) return null;

  const won = view.youWon === true;
  const byForfeit = view.endReason !== 'ELIMINATED';
  const gridWidth =
    mode === 'portrait'
      ? 'min(38vw, 20vh, 170px)'
      : mode === 'landscape'
        ? 'min(24vh, 20vw, 180px)'
        : 'min(32vh, 22vw, 240px)';

  const headline = won ? 'You win!' : 'You lose';
  const subline = byForfeit
    ? view.endReason === 'DISCONNECT_TIMEOUT'
      ? won
        ? 'Your opponent did not come back.'
        : 'You were disconnected too long.'
      : 'The match ended early.'
    : won
      ? `${view.opponent.name} ran out of lives.`
      : 'You ate one bomb too many.';

  const waitingForOpponent = view.rematch.you && !view.rematch.opponent;

  return (
    <ScreenTransition className="flex flex-1 flex-col">
      <Column width="lg" className="flex flex-1 flex-col items-center justify-center gap-5 py-3">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, scale: 0.86, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        >
          {!byForfeit ? (
            <motion.p
              className="eyebrow mb-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {won ? 'Last one standing' : 'Out of lives'}
            </motion.p>
          ) : null}
          <h1
            className="text-[clamp(2.2rem,11vw,3.8rem)] tracking-[0.02em] uppercase"
            style={{
              background: won
                ? 'linear-gradient(170deg, #fff, var(--color-gold) 70%)'
                : 'linear-gradient(170deg, #fff, var(--color-bomb) 75%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              filter: won
                ? 'drop-shadow(0 8px 28px #ffd16655)'
                : 'drop-shadow(0 8px 28px #ff3b5c55)',
            }}
          >
            {headline}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-dim)]">{subline}</p>
        </motion.div>

        <motion.div
          className="flex items-start justify-center gap-8 sm:gap-14"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
        >
          <ResultPlate
            title="Your plate"
            caption={`${view.opponent.name} rigged these`}
            bombs={view.finalReveal.bombsAgainstYou}
            cells={view.yourPlate.cells}
            width={gridWidth}
            accent="var(--color-cyan)"
          />
          <ResultPlate
            title="Their plate"
            caption="Where you hid yours"
            bombs={view.finalReveal.bombsYouPlanted}
            cells={view.theirPlate.cells}
            width={gridWidth}
            accent="var(--color-violet)"
          />
        </motion.div>

        <motion.div
          className="flex w-full max-w-sm flex-col gap-3"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Button variant="primary" size="lg" block onClick={rematch} disabled={waitingForOpponent}>
            {waitingForOpponent ? 'Waiting for opponent…' : 'Rematch'}
          </Button>
          {view.rematch.opponent && !view.rematch.you ? (
            <p className="text-center text-xs tracking-[0.14em] text-[var(--color-gold)] uppercase">
              {view.opponent.name} wants a rematch
            </p>
          ) : null}
          <Button variant="ghost" block onClick={leave}>
            Back to Menu
          </Button>
        </motion.div>
      </Column>
    </ScreenTransition>
  );
}
