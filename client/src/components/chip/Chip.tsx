import { memo, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { CellState, ChipIndex } from '@bbc/shared';
import { burstAtElement } from '../../fx/particles';
import { ChipMark, type MarkKind } from './ChipMark';

/** Which palette the face-down side of the chip wears. */
export type ChipFace = 'hidden' | 'own' | 'own-bomb' | 'armed';

export interface ChipProps {
  index: ChipIndex;
  state: CellState;
  face: ChipFace;
  interactive?: boolean;
  selected?: boolean;
  tension?: boolean;
  disabled?: boolean;
  /** Visually de-emphasise a spent chip. Off for the end-of-game reveal. */
  dimmed?: boolean;
  /** Delay in ms for staggered entrances and the end-of-game reveal. */
  enterDelay?: number;
  label: string;
  onSelect?: (index: ChipIndex) => void;
}

const FRONT_MARK: Record<ChipFace, MarkKind> = {
  hidden: 'unknown',
  own: 'blank',
  'own-bomb': 'bomb',
  armed: 'bomb',
};

function ChipComponent({
  index,
  state,
  face,
  interactive = false,
  selected = false,
  tension = false,
  disabled = false,
  dimmed,
  enterDelay = 0,
  label,
  onSelect,
}: ChipProps) {
  const revealed = state !== 'HIDDEN';
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLButtonElement>(null);
  const previousState = useRef<CellState>(state);

  // Fire the burst from the chip itself: it is the only thing that knows where
  // it ended up on screen after every layout pass.
  useEffect(() => {
    if (previousState.current === state) return;
    const wasHidden = previousState.current === 'HIDDEN';
    previousState.current = state;
    if (!wasHidden || reduceMotion) return;

    const timer = setTimeout(
      () => {
        if (state === 'BOMB') burstAtElement(rootRef.current, 'bomb', 1);
        else if (state === 'SAFE') burstAtElement(rootRef.current, 'safe', 0.7);
      },
      // Lands with the middle of the flip, where the face changes.
      160,
    );
    return () => clearTimeout(timer);
  }, [state, reduceMotion]);

  const handleSelect = (): void => {
    if (!interactive || disabled) return;
    onSelect?.(index);
  };

  return (
    <button
      ref={rootRef}
      type="button"
      className="chip"
      data-face={face}
      data-interactive={interactive && !disabled}
      data-selected={selected}
      data-tension={tension}
      data-disabled={dimmed ?? (disabled || (!interactive && !revealed))}
      disabled={!interactive || disabled}
      aria-label={label}
      aria-pressed={selected}
      onClick={handleSelect}
    >
      <span className="chip__lift">
        <motion.span
          className="chip__inner"
          initial={{ rotateY: revealed ? 180 : 0, scale: 0.7, opacity: 0 }}
          animate={{ rotateY: revealed ? 180 : 0, scale: 1, opacity: 1 }}
          transition={
            reduceMotion
              ? { duration: 0.12 }
              : {
                  rotateY: { type: 'spring', stiffness: 190, damping: 19 },
                  scale: { type: 'spring', stiffness: 260, damping: 20, delay: enterDelay / 1000 },
                  opacity: { duration: 0.25, delay: enterDelay / 1000 },
                }
          }
        >
          <span className="chip__face chip__face--front">
            <span className="chip__mark">
              <ChipMark kind={FRONT_MARK[face]} />
            </span>
          </span>
          <span
            className={`chip__face chip__face--back ${
              state === 'BOMB' ? 'chip__face--bomb' : 'chip__face--safe'
            }`}
          >
            <span className="chip__mark">
              <ChipMark kind={state === 'BOMB' ? 'bomb' : 'safe'} />
            </span>
          </span>
        </motion.span>
      </span>
    </button>
  );
}

export const Chip = memo(ChipComponent);
