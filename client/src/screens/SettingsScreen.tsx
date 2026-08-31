import { motion } from 'motion/react';
import { useGame } from '../state/store';
import { useSettings } from '../state/settings';
import { audio } from '../audio/audio';
import { Column, Panel, ScreenTransition, TopBar } from '../components/ui/Layout';

type ToggleKey = 'sfx' | 'music' | 'vibration' | 'reducedMotion';

function Toggle({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="flex w-full items-center gap-4 rounded-[var(--radius-lg)] px-1 py-3 text-left transition-opacity disabled:opacity-40"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-[family-name:var(--font-display)] text-sm font-semibold tracking-wide uppercase">
          {label}
        </span>
        <span className="block text-xs text-[var(--color-ink-faint)]">{description}</span>
      </span>

      <span
        className="relative h-7 w-12 shrink-0 rounded-full border transition-colors"
        style={{
          background: value ? 'var(--color-cyan)' : 'rgba(255,255,255,0.08)',
          borderColor: value ? 'var(--color-cyan)' : 'var(--color-line-strong)',
          boxShadow: value ? '0 0 18px -4px var(--color-cyan)' : 'none',
        }}
      >
        <motion.span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
          animate={{ left: value ? 24 : 3 }}
          transition={{ type: 'spring', stiffness: 480, damping: 32 }}
        />
      </span>
    </button>
  );
}

export function SettingsScreen() {
  const back = useGame((state) => state.back);
  const status = useGame((state) => state.status);
  const latency = useGame((state) => state.latencyMs);
  const settings = useSettings();

  const flip = (key: ToggleKey): void => {
    settings.toggle(key);
    audio.unlock();
    // Feedback fires after the change, so turning sound ON is audible.
    if (key !== 'sfx' || !settings.sfx) audio.play('click');
    if (key === 'vibration' && !settings.vibration) audio.vibrate(24);
  };

  return (
    <ScreenTransition className="flex flex-1 flex-col">
      <TopBar title="Settings" onBack={back} />

      <Column width="sm" className="flex flex-1 flex-col justify-center gap-4">
        <Panel className="divide-y divide-[var(--color-line)]">
          <Toggle
            label="Sound effects"
            description="Chips, explosions, results"
            value={settings.sfx}
            onChange={() => flip('sfx')}
          />
          <Toggle
            label="Music"
            description="A quiet ambient bed"
            value={settings.music}
            onChange={() => flip('music')}
          />
          <Toggle
            label="Vibration"
            description="Haptics on supported devices"
            value={settings.vibration}
            onChange={() => flip('vibration')}
          />
          <Toggle
            label="Reduced motion"
            description="Calmer transitions, no particles"
            value={settings.reducedMotion}
            onChange={() => flip('reducedMotion')}
          />
        </Panel>

        <Panel>
          <label
            htmlFor="player-name"
            className="eyebrow mb-2 block"
          >
            Display name
          </label>
          <input
            id="player-name"
            className="field !text-lg !tracking-normal"
            value={settings.playerName}
            maxLength={14}
            onChange={(event) => settings.set('playerName', event.target.value)}
            placeholder="Player"
            autoComplete="off"
          />
          <p className="mt-2 text-center text-xs text-[var(--color-ink-faint)]">
            Shown to your opponent. Up to 14 characters.
          </p>
        </Panel>

        <div className="flex items-center justify-center gap-2 text-xs text-[var(--color-ink-faint)]">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background:
                status === 'open'
                  ? 'var(--color-safe)'
                  : status === 'offline'
                    ? 'var(--color-bomb)'
                    : 'var(--color-ember)',
            }}
          />
          {status === 'open' ? `Connected · ${Math.round(latency)} ms` : `Connection: ${status}`}
        </div>
      </Column>
    </ScreenTransition>
  );
}
