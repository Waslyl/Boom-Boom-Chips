import { useEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audio';

interface TurnClockProps {
  /** Absolute server time the turn expires, or null when there is no limit. */
  deadline: number | null;
  /** serverTime - clientTime, measured by the transport's ping. */
  clockOffsetMs: number;
  totalMs: number;
  /** Only the player on the clock hears the countdown. */
  audible: boolean;
}

const SIZE = 44;
const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The clock renders against the SERVER's deadline, corrected by the measured
 * offset. It never counts down locally and never decides anything — if the
 * timer hits zero it is the server that acts.
 */
export function TurnClock({ deadline, clockOffsetMs, totalMs, audible }: TurnClockProps) {
  const [remaining, setRemaining] = useState(totalMs);
  const lastTick = useRef<number>(Number.POSITIVE_INFINITY);

  useEffect(() => {
    if (deadline === null) return;
    let frame = 0;

    const update = (): void => {
      const serverNow = Date.now() + clockOffsetMs;
      const left = Math.max(0, deadline - serverNow);
      setRemaining(left);

      const seconds = Math.ceil(left / 1000);
      if (audible && seconds <= 5 && seconds > 0 && seconds < lastTick.current) {
        audio.play('tick');
      }
      lastTick.current = seconds;

      frame = window.setTimeout(update, 120);
    };

    update();
    return () => window.clearTimeout(frame);
  }, [deadline, clockOffsetMs, audible]);

  if (deadline === null) return null;

  const fraction = Math.max(0, Math.min(1, remaining / totalMs));
  const seconds = Math.ceil(remaining / 1000);
  const urgent = seconds <= 5;
  const colour = urgent ? 'var(--color-bomb)' : 'var(--color-cyan)';

  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: SIZE, height: SIZE }}
      role="timer"
      aria-label={`${seconds} seconds left this turn`}
    >
      <svg width={SIZE} height={SIZE} className="-rotate-90" aria-hidden="true">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-line-strong)"
          strokeWidth="3"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={colour}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          style={{
            transition: 'stroke-dashoffset 140ms linear, stroke 240ms ease',
            filter: urgent ? `drop-shadow(0 0 6px ${colour})` : 'none',
          }}
        />
      </svg>
      <span
        className="absolute font-[family-name:var(--font-display)] text-xs font-bold tabular-nums"
        style={{ color: colour }}
      >
        {seconds}
      </span>
    </div>
  );
}
