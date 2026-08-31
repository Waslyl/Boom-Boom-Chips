import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DEFAULT_MULTIPLAYER_RULES, type ChipIndex, type PlayerView } from '@bbc/shared';
import { useGame } from '../state/store';
import { Grid } from '../components/grid/Grid';
import { LivesTracker } from '../components/hud/LivesTracker';
import { PlayerCard } from '../components/hud/PlayerCard';
import { TurnClock } from '../components/hud/TurnClock';
import { useViewport } from '../hooks/useViewport';

/** Shakes the board when a bomb goes off, then gets out of the way. */
function useShake(): boolean {
  const token = useGame((state) => state.shakeToken);
  const [shaking, setShaking] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setShaking(true);
    const timer = setTimeout(() => setShaking(false), 440);
    return () => clearTimeout(timer);
  }, [token]);

  return shaking;
}

function TurnBanner({ view, pendingActive }: { view: PlayerView; pendingActive: boolean }) {
  const yours = view.isYourTurn;
  const waiting = !view.opponent.connected;

  const message = waiting
    ? 'Opponent reconnecting…'
    : pendingActive
      ? 'Hold your breath…'
      : yours
        ? 'Your turn'
        : `${view.opponent.name} is picking…`;

  const detail = waiting
    ? 'Hold tight'
    : yours && !pendingActive
      ? 'Eat a chip from your plate'
      : '';

  return (
    <div className="min-h-[3.25rem] text-center">
      <AnimatePresence mode="wait">
        <motion.div
          key={message}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
        >
          <p
            className="font-[family-name:var(--font-display)] text-lg font-bold tracking-[0.14em] uppercase"
            style={{
              color: waiting
                ? 'var(--color-ember)'
                : yours
                  ? 'var(--color-cyan)'
                  : 'var(--color-ink-faint)',
            }}
          >
            {message}
          </p>
          {detail ? (
            <p className="text-xs tracking-[0.16em] text-[var(--color-ink-faint)] uppercase">
              {detail}
            </p>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function GameScreen() {
  const view = useGame((state) => state.view);
  const pending = useGame((state) => state.pending);
  const makeMove = useGame((state) => state.makeMove);
  const leave = useGame((state) => state.leave);
  const clockOffsetMs = useGame((state) => state.clockOffsetMs);
  const { mode } = useViewport();
  const shaking = useShake();

  if (!view) return null;

  const yourTurn = view.isYourTurn && pending === null;
  const yourPending = pending?.side === 'you' ? pending.index : null;
  const theirPending = pending?.side === 'them' ? pending.index : null;

  const onPick = (index: ChipIndex): void => makeMove(index);

  const heroWidth =
    mode === 'portrait'
      ? 'min(88vw, 42vh, 430px)'
      : mode === 'landscape'
        ? 'min(64vh, 34vw, 380px)'
        : 'min(54vh, 36vw, 500px)';

  /** THE hero: your own plate, the one you have to survive. */
  const yourPlate = (
    <div className={shaking ? 'shake' : undefined} style={{ width: heroWidth }}>
      <Grid
        mode="plate"
        cells={view.yourPlate.cells}
        interactive={yourTurn}
        pendingIndex={yourPending}
        onSelect={onPick}
        ariaLabel="Your plate: eat a chip"
      />
    </div>
  );

  /** Their plate, showing the traps you laid and which ones have gone off. */
  const theirPlate = (width: string) => (
    <div style={{ width }}>
      <Grid
        mode="trap"
        cells={view.theirPlate.cells}
        plantedBombs={view.theirPlate.yourBombs}
        pendingIndex={theirPending}
        ariaLabel={`${view.opponent.name}'s plate, with your bombs`}
      />
    </div>
  );

  const clock = (
    <TurnClock
      deadline={view.deadline}
      clockOffsetMs={clockOffsetMs}
      totalMs={DEFAULT_MULTIPLAYER_RULES.turnTimeLimitMs ?? 30_000}
      audible={view.isYourTurn}
    />
  );

  const leaveButton = (
    <button
      type="button"
      onClick={leave}
      className="shrink-0 text-[0.65rem] tracking-[0.16em] text-[var(--color-ink-faint)] uppercase transition-colors hover:text-[var(--color-bomb)]"
    >
      Leave
    </button>
  );

  /* ---------------------------------------------------------------- */
  /* Portrait: their plate and their lives above, yours below.         */
  /* ---------------------------------------------------------------- */
  if (mode === 'portrait') {
    return (
      <div className="flex flex-1 flex-col gap-2 py-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <PlayerCard
              name={view.opponent.name}
              isYou={false}
              isBot={view.opponent.isBot}
              difficulty={view.opponent.botDifficulty}
              connected={view.opponent.connected}
              active={!view.isYourTurn}
            />
          </div>
          {clock}
          {leaveButton}
        </div>

        <div className="flex items-center gap-4 border-b border-[var(--color-line)] pb-2">
          {theirPlate('clamp(72px, 20vw, 96px)')}
          <div className="flex-1">
            <LivesTracker lives={view.theirPlate.lives} label="Their lives" who="theirs" size="sm" />
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <TurnBanner view={view} pendingActive={pending !== null} />
          {yourPlate}
        </div>

        <div className="flex items-center justify-center gap-4 border-t border-[var(--color-line)] pt-2">
          <LivesTracker lives={view.yourPlate.lives} label="Your lives" who="mine" />
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Landscape and desktop: you centre-left, their plate on the right. */
  /* ---------------------------------------------------------------- */
  const sideWidth = mode === 'desktop' ? 'clamp(150px, 15vw, 200px)' : 'clamp(96px, 15vw, 140px)';
  const asideWidth = mode === 'desktop' ? '17rem' : '12rem';

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 items-center justify-between gap-4 py-1">
      <aside className="flex shrink-0 flex-col items-center gap-4" style={{ width: asideWidth }}>
        <PlayerCard name={view.yourName} isYou active={view.isYourTurn} />
        <LivesTracker lives={view.yourPlate.lives} label="Your lives" who="mine" size="lg" />
        {clock}
        {leaveButton}
      </aside>

      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <TurnBanner view={view} pendingActive={pending !== null} />
        {yourPlate}
        <p className="eyebrow">Your plate</p>
      </div>

      <aside className="flex shrink-0 flex-col items-center gap-3" style={{ width: asideWidth }}>
        <PlayerCard
          name={view.opponent.name}
          isYou={false}
          isBot={view.opponent.isBot}
          difficulty={view.opponent.botDifficulty}
          connected={view.opponent.connected}
          active={!view.isYourTurn}
        />
        <LivesTracker lives={view.theirPlate.lives} label="Their lives" who="theirs" />
        {theirPlate(sideWidth)}
        <p className="text-center text-[0.7rem] leading-relaxed text-[var(--color-ink-faint)]">
          Your traps ·{' '}
          {view.theirPlate.yourBombs.length - view.theirPlate.livesLost} still waiting
        </p>
      </aside>
    </div>
  );
}
