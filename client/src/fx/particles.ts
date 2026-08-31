/**
 * Particle field.
 *
 * One canvas for the whole app, one pooled array, one rAF loop that stops
 * itself the moment nothing is alive. React never re-renders for a particle —
 * that is the difference between 60fps and a slideshow when a bomb goes off.
 */

export type BurstKind = 'bomb' | 'safe' | 'confetti' | 'spark';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
  angle: number;
  colour: string;
  gravity: number;
  square: boolean;
  alive: boolean;
}

const PALETTES: Record<BurstKind, string[]> = {
  bomb: ['#ff3b5c', '#ff8a3d', '#ffd166', '#fff1d0', '#8b1027'],
  safe: ['#2ee6a8', '#7ef7cd', '#22d3ee', '#eafff7'],
  confetti: ['#22d3ee', '#8b5cf6', '#ffd166', '#2ee6a8', '#ff8a3d', '#ffffff'],
  spark: ['#ffffff', '#cfe9ff', '#22d3ee'],
};

const MAX_PARTICLES = 420;

class ParticleField {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private readonly pool: Particle[] = [];
  private running = false;
  private lastFrame = 0;
  private dpr = 1;
  private enabled = true;

  attach(canvas: HTMLCanvasElement): () => void {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    const resize = (): void => this.resize();
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    const onVisibility = (): void => {
      if (document.hidden) this.stop();
      else if (this.pool.some((p) => p.alive)) this.start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      this.stop();
      this.canvas = null;
      this.context = null;
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const particle of this.pool) particle.alive = false;
      this.stop();
      this.clear();
    }
  }

  private resize(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    // Cap the device ratio: a 3x buffer on a phone costs more than it shows.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * this.dpr);
    canvas.height = Math.floor(window.innerHeight * this.dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
  }

  private take(): Particle | null {
    for (const particle of this.pool) {
      if (!particle.alive) return particle;
    }
    if (this.pool.length >= MAX_PARTICLES) return null;
    const particle: Particle = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 4,
      spin: 0,
      angle: 0,
      colour: '#fff',
      gravity: 900,
      square: false,
      alive: false,
    };
    this.pool.push(particle);
    return particle;
  }

  burst(x: number, y: number, kind: BurstKind, intensity = 1): void {
    if (!this.enabled || !this.canvas) return;
    const palette = PALETTES[kind];
    const count = Math.round((kind === 'bomb' ? 46 : kind === 'confetti' ? 60 : 22) * intensity);
    const speed = kind === 'bomb' ? 620 : kind === 'confetti' ? 420 : 300;

    for (let i = 0; i < count; i += 1) {
      const particle = this.take();
      if (!particle) break;
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.35 + Math.random() * 0.75);
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * velocity;
      particle.vy = Math.sin(angle) * velocity - (kind === 'confetti' ? 220 : 90);
      particle.maxLife = kind === 'confetti' ? 1.6 + Math.random() : 0.5 + Math.random() * 0.55;
      particle.life = particle.maxLife;
      particle.size = (kind === 'confetti' ? 5 : 3) + Math.random() * 4;
      particle.angle = Math.random() * Math.PI;
      particle.spin = (Math.random() - 0.5) * 14;
      particle.colour = palette[Math.floor(Math.random() * palette.length)] ?? '#fff';
      particle.gravity = kind === 'confetti' ? 620 : 1_150;
      particle.square = kind === 'confetti' || (kind === 'bomb' && Math.random() > 0.6);
      particle.alive = true;
    }
    this.start();
  }

  /** Confetti raining from the top of the screen, for a win. */
  rain(durationMs = 1_400): void {
    if (!this.enabled || !this.canvas) return;
    const started = performance.now();
    const drop = (): void => {
      if (performance.now() - started > durationMs) return;
      const x = Math.random() * window.innerWidth;
      this.burst(x, -20, 'confetti', 0.16);
      setTimeout(drop, 90);
    };
    drop();
  }

  private start(): void {
    if (this.running || document.hidden) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private stop(): void {
    this.running = false;
  }

  private clear(): void {
    const { context, canvas } = this;
    if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const context = this.context;
    const canvas = this.canvas;
    if (!context || !canvas) {
      this.running = false;
      return;
    }

    const delta = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.scale(this.dpr, this.dpr);

    let living = 0;
    for (const particle of this.pool) {
      if (!particle.alive) continue;
      particle.life -= delta;
      if (particle.life <= 0) {
        particle.alive = false;
        continue;
      }
      living += 1;

      particle.vy += particle.gravity * delta;
      particle.vx *= 1 - 1.6 * delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.angle += particle.spin * delta;

      const fade = Math.max(0, particle.life / particle.maxLife);
      context.globalAlpha = fade;
      context.fillStyle = particle.colour;
      context.translate(particle.x, particle.y);
      context.rotate(particle.angle);
      const size = particle.size * (0.4 + fade * 0.6);
      if (particle.square) context.fillRect(-size / 2, -size / 2, size, size * 1.5);
      else {
        context.beginPath();
        context.arc(0, 0, size / 2, 0, Math.PI * 2);
        context.fill();
      }
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    context.restore();
    context.globalAlpha = 1;

    if (living === 0) {
      this.running = false;
      this.clear();
      return;
    }
    requestAnimationFrame(this.frame);
  };
}

export const particles = new ParticleField();

/** Fire a burst at the centre of an element. */
export function burstAtElement(element: Element | null, kind: BurstKind, intensity = 1): void {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  particles.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, kind, intensity);
}
