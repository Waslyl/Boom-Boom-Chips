/**
 * The glyphs printed on a chip.
 *
 * Drawn as SVG rather than emoji: a 💣 renders as a different picture on every
 * platform, and half of them are cartoons. These are consistent everywhere and
 * inherit the chip's colour.
 */

export type MarkKind = 'unknown' | 'bomb' | 'safe' | 'armed' | 'blank';

interface ChipMarkProps {
  kind: MarkKind;
}

export function ChipMark({ kind }: ChipMarkProps) {
  switch (kind) {
    case 'unknown':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-full w-full">
          <path
            d="M9 9a3 3 0 1 1 4.2 2.75c-.85.4-1.2 1-1.2 1.85v.9"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="12" cy="18" r="1.5" fill="currentColor" />
        </svg>
      );

    case 'bomb':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-full w-full">
          <circle cx="10.5" cy="14.5" r="6.5" fill="currentColor" />
          <path
            d="M15.4 9.6 17 8m0 0 .9-2.6L20.5 4.5m-3.5 3.5 2.6.9L21 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="8.4" cy="12.4" r="1.6" fill="#ffffff" opacity="0.45" />
        </svg>
      );

    case 'safe':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-full w-full">
          <path
            d="m5 12.8 4.4 4.4L19 7.6"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'armed':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-full w-full">
          <circle cx="12" cy="12" r="5.5" fill="currentColor" />
          <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
        </svg>
      );

    case 'blank':
      return null;
  }
}
