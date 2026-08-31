/**
 * Audio, synthesised at runtime.
 *
 * Every sound in the game is generated from oscillators and shaped noise —
 * there are no audio files. That means nothing to download, nothing to license,
 * no copyright question, and sounds that can be retuned by editing numbers.
 *
 * Browsers refuse to start audio before a gesture, so the context is created
 * lazily on the first tap and `unlock()` resumes it after that.
 */

export type SoundCue =
  | 'click'
  | 'hover'
  | 'select'
  | 'place'
  | 'undo'
  | 'reveal'
  | 'safe'
  | 'bomb'
  | 'turn'
  | 'tick'
  | 'victory'
  | 'defeat'
  | 'joined'
  | 'error';

interface ToneOptions {
  frequency: number;
  /** Frequency to glide to over the life of the note. */
  glideTo?: number;
  type?: OscillatorType;
  duration: number;
  gain?: number;
  attack?: number;
  delay?: number;
  detune?: number;
}

interface NoiseOptions {
  duration: number;
  gain?: number;
  filter?: BiquadFilterType;
  frequency: number;
  glideTo?: number;
  q?: number;
  delay?: number;
}

class AudioEngine {
  private context: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private musicNodes: Array<OscillatorNode | AudioBufferSourceNode> = [];
  private musicTimer: ReturnType<typeof setInterval> | null = null;

  sfxEnabled = true;
  musicEnabled = true;
  vibrationEnabled = true;

  /** Called from the first real user gesture. Safe to call repeatedly. */
  unlock(): void {
    const context = this.ensure();
    if (!context) return;
    if (context.state === 'suspended') void context.resume();
    if (this.musicEnabled) this.startMusic();
  }

  private ensure(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const context = new Ctor();
    const master = context.createGain();
    master.gain.value = 0.9;

    // A gentle limiter keeps a triple explosion from clipping.
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    const sfx = context.createGain();
    sfx.gain.value = 0.85;
    const music = context.createGain();
    music.gain.value = 0.16;

    sfx.connect(master);
    music.connect(master);
    master.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.sfxBus = sfx;
    this.musicBus = music;
    return context;
  }

  private noiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const length = Math.floor(context.sampleRate * 1.2);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }

  private tone(options: ToneOptions, bus: GainNode): void {
    const context = this.context;
    if (!context) return;
    const start = context.currentTime + (options.delay ?? 0);
    const peak = options.gain ?? 0.2;
    const attack = options.attack ?? 0.006;

    const oscillator = context.createOscillator();
    oscillator.type = options.type ?? 'sine';
    oscillator.frequency.setValueAtTime(options.frequency, start);
    if (options.glideTo !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.glideTo),
        start + options.duration,
      );
    }
    if (options.detune) oscillator.detune.setValueAtTime(options.detune, start);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);

    oscillator.connect(envelope);
    envelope.connect(bus);
    oscillator.start(start);
    oscillator.stop(start + options.duration + 0.05);
  }

  private hiss(options: NoiseOptions, bus: GainNode): void {
    const context = this.context;
    if (!context) return;
    const start = context.currentTime + (options.delay ?? 0);

    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context);

    const filter = context.createBiquadFilter();
    filter.type = options.filter ?? 'lowpass';
    filter.frequency.setValueAtTime(options.frequency, start);
    if (options.glideTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, options.glideTo),
        start + options.duration,
      );
    }
    filter.Q.value = options.q ?? 1;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(options.gain ?? 0.25, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);

    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(bus);
    source.start(start);
    source.stop(start + options.duration + 0.05);
  }

  play(cue: SoundCue): void {
    if (!this.sfxEnabled) return;
    const context = this.ensure();
    const bus = this.sfxBus;
    if (!context || !bus) return;
    if (context.state === 'suspended') void context.resume();

    switch (cue) {
      case 'hover':
        this.tone({ frequency: 1_180, type: 'sine', duration: 0.05, gain: 0.035 }, bus);
        break;

      case 'click':
        this.tone({ frequency: 620, glideTo: 880, type: 'triangle', duration: 0.09, gain: 0.13 }, bus);
        this.hiss({ frequency: 2_600, duration: 0.05, gain: 0.05, filter: 'bandpass', q: 2 }, bus);
        break;

      case 'select':
        this.tone({ frequency: 440, glideTo: 660, type: 'triangle', duration: 0.12, gain: 0.16 }, bus);
        break;

      case 'place':
        // A chip being set down: a click plus a short woody thud.
        this.tone({ frequency: 260, glideTo: 150, type: 'sine', duration: 0.14, gain: 0.2 }, bus);
        this.hiss({ frequency: 1_800, glideTo: 500, duration: 0.09, gain: 0.09 }, bus);
        break;

      case 'undo':
        this.tone({ frequency: 380, glideTo: 240, type: 'triangle', duration: 0.11, gain: 0.11 }, bus);
        break;

      case 'reveal':
        // The flip: a rising whoosh with a little air.
        this.hiss({ frequency: 380, glideTo: 3_200, duration: 0.22, gain: 0.1, q: 0.8 }, bus);
        break;

      case 'safe': {
        // A clean major triad, bright and short.
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((frequency, index) => {
          this.tone(
            { frequency, type: 'triangle', duration: 0.3, gain: 0.13, delay: index * 0.045 },
            bus,
          );
        });
        break;
      }

      case 'bomb':
        // Body: a fast downward sine sweep. Air: filtered noise collapsing.
        this.tone({ frequency: 180, glideTo: 32, type: 'sine', duration: 0.75, gain: 0.55 }, bus);
        this.tone({ frequency: 92, glideTo: 26, type: 'square', duration: 0.5, gain: 0.16 }, bus);
        this.hiss({ frequency: 5_200, glideTo: 180, duration: 0.85, gain: 0.4, q: 0.6 }, bus);
        this.hiss({ frequency: 900, glideTo: 90, duration: 1.1, gain: 0.16, delay: 0.05 }, bus);
        break;

      case 'turn':
        this.tone({ frequency: 700, glideTo: 940, type: 'sine', duration: 0.16, gain: 0.09 }, bus);
        break;

      case 'tick':
        this.tone({ frequency: 1_500, type: 'square', duration: 0.035, gain: 0.07 }, bus);
        break;

      case 'victory': {
        const fanfare = [523.25, 659.25, 783.99, 1046.5];
        fanfare.forEach((frequency, index) => {
          this.tone(
            {
              frequency,
              type: 'triangle',
              duration: 0.55,
              gain: 0.2,
              delay: index * 0.1,
              attack: 0.01,
            },
            bus,
          );
          this.tone(
            { frequency: frequency * 2, type: 'sine', duration: 0.3, gain: 0.06, delay: index * 0.1 },
            bus,
          );
        });
        break;
      }

      case 'defeat': {
        const fall = [392, 349.23, 293.66, 246.94];
        fall.forEach((frequency, index) => {
          this.tone(
            { frequency, type: 'sawtooth', duration: 0.5, gain: 0.11, delay: index * 0.13 },
            bus,
          );
        });
        this.hiss({ frequency: 400, glideTo: 90, duration: 0.9, gain: 0.07 }, bus);
        break;
      }

      case 'joined':
        this.tone({ frequency: 587.33, type: 'triangle', duration: 0.2, gain: 0.15 }, bus);
        this.tone({
          frequency: 880,
          type: 'triangle',
          duration: 0.28,
          gain: 0.14,
          delay: 0.11,
        }, bus);
        break;

      case 'error':
        this.tone({ frequency: 220, glideTo: 160, type: 'square', duration: 0.18, gain: 0.11 }, bus);
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Ambient bed                                                         */
  /* ------------------------------------------------------------------ */

  private startMusic(): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus || this.musicNodes.length > 0) return;

    // Two detuned saws through a slowly breathing filter: a low, unobtrusive pad.
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 3;
    filter.connect(bus);

    const lfo = context.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoDepth = context.createGain();
    lfoDepth.gain.value = 210;
    lfo.connect(lfoDepth);
    lfoDepth.connect(filter.frequency);
    lfo.start();

    for (const [frequency, detune] of [
      [55, -6],
      [82.41, 7],
      [110, 4],
    ] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      const level = context.createGain();
      level.gain.value = 0.09;
      oscillator.connect(level);
      level.connect(filter);
      oscillator.start();
      this.musicNodes.push(oscillator);
    }
    this.musicNodes.push(lfo);

    // An occasional bell from a pentatonic set, so the bed never loops audibly.
    const scale = [329.63, 392, 440, 523.25, 587.33];
    this.musicTimer = setInterval(() => {
      if (!this.musicEnabled || !this.musicBus) return;
      const frequency = scale[Math.floor(Math.random() * scale.length)] ?? 440;
      this.tone(
        { frequency, type: 'sine', duration: 3.4, gain: 0.05, attack: 0.6 },
        this.musicBus,
      );
    }, 7_000);
  }

  private stopMusic(): void {
    for (const node of this.musicNodes) {
      try {
        node.stop();
      } catch {
        // already stopped
      }
    }
    this.musicNodes = [];
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (!enabled) this.stopMusic();
    else if (this.context) this.startMusic();
  }

  setVibrationEnabled(enabled: boolean): void {
    this.vibrationEnabled = enabled;
  }

  /** Haptics where the platform offers them; silently ignored where it does not. */
  vibrate(pattern: number | number[]): void {
    if (!this.vibrationEnabled) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Some browsers throw when the document is not focused.
    }
  }
}

export const audio = new AudioEngine();
