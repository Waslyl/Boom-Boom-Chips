import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { PARTY_CODE_LENGTH, normalisePartyCode } from '@bbc/shared';
import { useGame } from '../state/store';
import { Button } from '../components/ui/Button';
import { Column, Panel, ScreenTransition, TopBar } from '../components/ui/Layout';

/** The fork from the main menu: host a party, or join one. */
export function FriendScreen() {
  const back = useGame((state) => state.back);
  const go = useGame((state) => state.go);
  const createParty = useGame((state) => state.createParty);

  return (
    <ScreenTransition className="flex flex-1 flex-col">
      <TopBar title="Play with a friend" onBack={back} />
      <Column width="sm" className="flex flex-1 flex-col justify-center gap-4">
        <Button variant="primary" size="lg" block onClick={createParty}>
          Create Party
        </Button>
        <Button size="lg" block onClick={() => go('JOIN')}>
          Join Party
        </Button>
        <p className="mt-2 text-center text-xs text-[var(--color-ink-faint)]">
          One of you hosts and shares a six-character code. The other joins with it.
        </p>
      </Column>
    </ScreenTransition>
  );
}

/* ------------------------------------------------------------------ */

export function CreatePartyScreen() {
  const party = useGame((state) => state.party);
  const leave = useGame((state) => state.leave);
  const busy = useGame((state) => state.busy);
  const [copied, setCopied] = useState(false);

  const code = party?.code ?? null;

  const copy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_800);
    } catch {
      // Clipboard access can be refused; the code is on screen either way.
    }
  };

  const share = async (): Promise<void> => {
    if (!code) return;
    const text = `Join my Boom Boom Chips game. Code: ${code}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Boom Boom Chips', text, url: window.location.origin });
        return;
      } catch {
        // The user dismissed the sheet: fall through to copying.
      }
    }
    void copy();
  };

  return (
    <ScreenTransition className="flex flex-1 flex-col">
      <TopBar title="Your party" onBack={leave} />

      <Column width="sm" className="flex flex-1 flex-col justify-center gap-6">
        <Panel className="text-center">
          <p className="eyebrow mb-4">Your party code</p>

          {code ? (
            <motion.p
              className="code-display"
              initial={{ opacity: 0, scale: 0.9, filter: 'blur(8px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ type: 'spring', stiffness: 240, damping: 20 }}
            >
              {code}
            </motion.p>
          ) : (
            <p className="code-display animate-pulse">······</p>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button onClick={() => void copy()} disabled={!code}>
              {copied ? 'Copied' : 'Copy Code'}
            </Button>
            <Button onClick={() => void share()} disabled={!code}>
              Share
            </Button>
          </div>
        </Panel>

        <div className="flex items-center justify-center gap-3 text-sm text-[var(--color-ink-dim)]">
          <motion.span
            className="h-2 w-2 rounded-full bg-[var(--color-cyan)]"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.15, 0.85] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
          {busy === 'CREATING_PARTY' ? 'Creating party…' : 'Waiting for player…'}
        </div>
      </Column>
    </ScreenTransition>
  );
}

/* ------------------------------------------------------------------ */

export function JoinPartyScreen() {
  const back = useGame((state) => state.back);
  const joinParty = useGame((state) => state.joinParty);
  const busy = useGame((state) => state.busy);
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus late enough that the entrance animation does not fight the keyboard.
    const timer = setTimeout(() => inputRef.current?.focus(), 380);
    return () => clearTimeout(timer);
  }, []);

  const ready = code.length === PARTY_CODE_LENGTH;

  const submit = (): void => {
    if (!ready) return;
    joinParty(code);
  };

  return (
    <ScreenTransition className="flex flex-1 flex-col">
      <TopBar title="Join a party" onBack={back} />

      <Column width="sm" className="flex flex-1 flex-col justify-center gap-5">
        <Panel>
          <label htmlFor="party-code" className="eyebrow mb-3 block text-center">
            Party code
          </label>
          <input
            ref={inputRef}
            id="party-code"
            className="field"
            value={code}
            onChange={(event) => setCode(normalisePartyCode(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
            placeholder="······"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={PARTY_CODE_LENGTH}
            aria-describedby="code-help"
          />
          <p id="code-help" className="mt-3 text-center text-xs text-[var(--color-ink-faint)]">
            Six characters. Case does not matter.
          </p>
        </Panel>

        <Button
          variant="primary"
          size="lg"
          block
          onClick={submit}
          disabled={!ready || busy === 'JOINING_PARTY'}
        >
          {busy === 'JOINING_PARTY' ? 'Joining…' : 'Join'}
        </Button>
      </Column>
    </ScreenTransition>
  );
}
