import { useEffect, useRef } from 'react';
import { useSettings } from '../state/settings';
import { stageOf, useGame } from '../state/store';
import { particles } from './particles';

/** The canvas every burst is drawn on. Mounted once, above the UI, inert to input. */
export function ParticleLayer() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    return particles.attach(canvas);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40"
      style={{ contain: 'strict' }}
    />
  );
}

interface Drifter {
  x: number;
  y: number;
  radius: number;
  speed: number;
  drift: number;
  angle: number;
  spin: number;
  hue: string;
  alpha: number;
}

/**
 * The living background: chips drifting slowly upward through a cold haze.
 *
 * Everything expensive is static CSS; only the chips move, on one canvas, at a
 * capped device ratio. It pauses when the tab is hidden and disappears entirely
 * under reduced motion.
 */
export function MenuBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useSettings((state) => state.reducedMotion);
  const inMatch = useGame((state) => stageOf(state) !== 'MENU_STACK');

  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let dpr = 1;
    let width = 0;
    let height = 0;
    let drifters: Drifter[] = [];
    let frame = 0;
    let last = performance.now();
    let running = true;

    const palette = ['#22d3ee', '#8b5cf6', '#2ee6a8', '#ff3b5c', '#ffd166'];

    const build = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      // Fewer chips on a phone: the same density costs far more per pixel there.
      const count = width < 640 ? 12 : width < 1100 ? 18 : 26;
      drifters = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 16 + Math.random() * 46,
        speed: 8 + Math.random() * 20,
        drift: (Math.random() - 0.5) * 12,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.4,
        hue: palette[Math.floor(Math.random() * palette.length)] ?? '#22d3ee',
        alpha: 0.05 + Math.random() * 0.09,
      }));
    };

    const draw = (now: number): void => {
      if (!running) return;
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      for (const chip of drifters) {
        chip.y -= chip.speed * delta;
        chip.x += chip.drift * delta;
        chip.angle += chip.spin * delta;
        if (chip.y + chip.radius < -40) {
          chip.y = height + chip.radius + Math.random() * 120;
          chip.x = Math.random() * width;
        }
        if (chip.x < -80) chip.x = width + 80;
        if (chip.x > width + 80) chip.x = -80;

        context.save();
        context.translate(chip.x, chip.y);
        context.rotate(chip.angle);
        context.globalAlpha = chip.alpha;

        context.beginPath();
        context.arc(0, 0, chip.radius, 0, Math.PI * 2);
        context.fillStyle = chip.hue;
        context.fill();

        context.globalAlpha = chip.alpha * 2.1;
        context.lineWidth = Math.max(1, chip.radius * 0.09);
        context.strokeStyle = chip.hue;
        context.beginPath();
        context.arc(0, 0, chip.radius * 0.72, 0, Math.PI * 2);
        context.stroke();

        // Four rim notches, so the shape reads as a chip and not a bubble.
        context.globalAlpha = chip.alpha * 1.6;
        for (let i = 0; i < 4; i += 1) {
          const a = (i / 4) * Math.PI * 2;
          context.beginPath();
          context.arc(0, 0, chip.radius * 0.88, a, a + 0.34);
          context.lineWidth = Math.max(1.5, chip.radius * 0.16);
          context.stroke();
        }
        context.restore();
      }

      frame = requestAnimationFrame(draw);
    };

    const onVisibility = (): void => {
      running = !document.hidden;
      if (running) {
        last = performance.now();
        frame = requestAnimationFrame(draw);
      } else {
        cancelAnimationFrame(frame);
      }
    };

    build();
    frame = requestAnimationFrame(draw);
    window.addEventListener('resize', build);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', build);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reducedMotion]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Static ambience: cheap, GPU-composited, never repainted. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% -10%, #16204a 0%, transparent 55%),' +
            'radial-gradient(90% 70% at 12% 105%, #0b3b4a 0%, transparent 60%),' +
            'radial-gradient(70% 60% at 92% 82%, #35123a 0%, transparent 62%),' +
            'linear-gradient(180deg, #05060b 0%, #070911 60%, #05060b 100%)',
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{
          // The scene is the star on the menu and a distraction on the board.
          // Once a match starts it drops back so the real chips carry the eye.
          opacity: inMatch ? 0.22 : 1,
          transition: 'opacity 700ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
      {/* A fine vignette to sit the UI on top of the scene. */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 100% at 50% 50%, transparent 45%, #05060bcc)' }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: '#05060b',
          opacity: inMatch ? 0.45 : 0,
          transition: 'opacity 700ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
    </div>
  );
}
