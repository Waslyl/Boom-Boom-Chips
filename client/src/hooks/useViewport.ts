import { useEffect, useState } from 'react';

export type LayoutMode = 'portrait' | 'landscape' | 'desktop';

export interface Viewport {
  width: number;
  height: number;
  mode: LayoutMode;
}

function measure(): Viewport {
  const width = window.innerWidth;
  const height = window.innerHeight;
  // Desktop is about having room for three columns, not about the device.
  // A landscape phone gets the landscape layout, not a squashed desktop one.
  const mode: LayoutMode =
    width >= 1024 && height >= 620 ? 'desktop' : width > height ? 'landscape' : 'portrait';
  return { width, height, mode };
}

/**
 * The layouts are genuinely different arrangements, not one design scaled down,
 * so the app needs to know which one it is drawing.
 */
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() =>
    typeof window === 'undefined' ? { width: 1024, height: 768, mode: 'desktop' } : measure(),
  );

  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      cancelAnimationFrame(frame);
      // Coalesce the storm of resize events an orientation change fires.
      frame = requestAnimationFrame(() => setViewport(measure()));
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return viewport;
}
