import { useRef, type KeyboardEvent } from 'react';
import { CHIP_INDICES, GRID_SIDE, type CellView, type ChipIndex } from '@bbc/shared';
import { Chip, type ChipFace } from '../chip/Chip';

/**
 * `plate` — the chips YOU eat. What is under them is your opponent's secret,
 *           so every unbitten chip is drawn face-down and unknowable.
 * `trap`  — THEIR chips, which you booby-trapped. You may see your own bombs.
 * `setup` — choosing where to plant, in their plate.
 */
export type GridMode = 'plate' | 'trap' | 'setup';

export interface GridProps {
  cells: readonly CellView[];
  mode: GridMode;
  /** The bombs YOU planted. Only ever passed for `trap` and `setup`. */
  plantedBombs?: readonly ChipIndex[];
  /** Chips picked so far while planting. */
  selection?: readonly ChipIndex[];
  interactive?: boolean;
  pendingIndex?: ChipIndex | null;
  revealAll?: boolean;
  onSelect?: (index: ChipIndex) => void;
  className?: string;
  ariaLabel: string;
}

function faceFor(
  mode: GridMode,
  index: ChipIndex,
  plantedBombs: readonly ChipIndex[],
  selection: readonly ChipIndex[],
): ChipFace {
  if (mode === 'setup') return selection.includes(index) ? 'armed' : 'own';
  if (mode === 'trap') return plantedBombs.includes(index) ? 'own-bomb' : 'own';
  // Your own plate: you know nothing about it until you bite.
  return 'hidden';
}

function describe(
  mode: GridMode,
  index: ChipIndex,
  cell: CellView,
  selected: boolean,
  planted: boolean,
): string {
  const position = `Chip ${index + 1}`;
  if (mode === 'setup') return `${position}, ${selected ? 'bomb planted' : 'empty'}`;
  if (cell.state === 'BOMB') return `${position}, bomb`;
  if (cell.state === 'SAFE') return `${position}, safe`;
  if (mode === 'trap') return `${position}, ${planted ? 'your bomb, not eaten yet' : 'empty'}`;
  return `${position}, not eaten yet`;
}

export function Grid({
  cells,
  mode,
  plantedBombs = [],
  selection = [],
  interactive = false,
  pendingIndex = null,
  revealAll = false,
  onSelect,
  className = '',
  ariaLabel,
}: GridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  /** Arrow keys walk the board, which is how a keyboard player expects a grid to behave. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: GRID_SIDE,
      ArrowUp: -GRID_SIDE,
    };
    const delta = deltas[event.key];
    if (delta === undefined) return;

    const buttons = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>('button.chip') ?? [],
    );
    const active = document.activeElement as HTMLButtonElement | null;
    const current = active ? buttons.indexOf(active) : -1;
    if (current === -1) return;

    // Keep horizontal moves inside their row so focus never wraps unexpectedly.
    if (Math.abs(delta) === 1) {
      const row = Math.floor(current / GRID_SIDE);
      const target = current + delta;
      if (Math.floor(target / GRID_SIDE) !== row) return;
    }
    const next = buttons[current + delta];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div
      ref={containerRef}
      role="grid"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`grid aspect-square w-full grid-cols-3 gap-[4.5%] ${className}`}
    >
      {CHIP_INDICES.map((index) => {
        const cell = cells[index] ?? { state: 'HIDDEN' as const };
        const selected = selection.includes(index);
        const planted = plantedBombs.includes(index);
        return (
          <Chip
            key={index}
            index={index}
            state={cell.state}
            face={faceFor(mode, index, plantedBombs, selection)}
            interactive={interactive}
            selected={selected}
            tension={pendingIndex === index}
            disabled={cell.state !== 'HIDDEN'}
            dimmed={revealAll ? false : undefined}
            enterDelay={revealAll ? index * 55 : index * 32}
            label={describe(mode, index, cell, selected, planted)}
            {...(onSelect ? { onSelect } : {})}
          />
        );
      })}
    </div>
  );
}
