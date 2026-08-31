import { AnimatePresence, motion } from 'motion/react';
import { useGame } from '../state/store';
import { Button } from '../components/ui/Button';
import { Column, Panel, ScreenTransition, TopBar } from '../components/ui/Layout';

/**
 * Both players confirm here. The server starts the match the instant the
 * second READY lands, so this screen only ever reflects what it has been told.
 */
export function LobbyScreen() {
  const party = useGame((state) => state.party);
  const leave = useGame((state) => state.leave);
  const setReady = useGame((state) => state.setReady);

  if (!party) return null;

  const you = party.members.find((member) => member.slot === party.you);
  const them = party.members.find((member) => member.slot !== party.you);
  const bothHere = party.members.length === 2;
  const bothReady = bothHere && party.members.every((member) => member.ready);

  return (
    <ScreenTransition className="flex flex-1 flex-col">
      <TopBar
        title="Lobby"
        onBack={leave}
        right={party.code ? <span className="pill">{party.code}</span> : null}
      />

      <Column className="flex flex-1 flex-col justify-center gap-6">
        <div className="grid grid-cols-2 gap-3">
          {[you, them].map((member, index) => (
            <Panel
              key={member?.slot ?? `empty-${index}`}
              className="flex flex-col items-center gap-3 py-6 text-center"
            >
              <motion.div
                className="grid h-16 w-16 place-items-center rounded-full text-2xl"
                style={{
                  background: member
                    ? index === 0
                      ? 'linear-gradient(150deg, var(--color-cyan), var(--color-cyan-deep))'
                      : 'linear-gradient(150deg, var(--color-violet), #4c1d95)'
                    : 'rgba(255,255,255,0.05)',
                }}
                animate={member?.ready ? { scale: [1, 1.08, 1] } : {}}
                transition={{ duration: 0.4 }}
              >
                {member ? (
                  <span className="font-[family-name:var(--font-display)] text-lg font-bold text-black/70">
                    {member.name.slice(0, 2).toUpperCase()}
                  </span>
                ) : (
                  <span className="text-[var(--color-ink-faint)]">?</span>
                )}
              </motion.div>

              <p className="font-[family-name:var(--font-display)] text-sm font-semibold">
                {member?.name ?? 'Waiting…'}
              </p>

              <AnimatePresence mode="wait">
                <motion.span
                  key={member?.ready ? 'ready' : 'not-ready'}
                  className="pill"
                  style={
                    member?.ready
                      ? {
                          color: 'var(--color-safe)',
                          borderColor: 'color-mix(in oklab, var(--color-safe) 45%, transparent)',
                        }
                      : undefined
                  }
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                >
                  {member ? (member.ready ? '✓ Ready' : 'Not ready') : 'Empty seat'}
                </motion.span>
              </AnimatePresence>
            </Panel>
          ))}
        </div>

        {bothReady ? (
          <motion.p
            className="text-center font-[family-name:var(--font-display)] text-lg tracking-[0.2em] text-[var(--color-cyan)] uppercase"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            Starting game…
          </motion.p>
        ) : (
          <Button
            variant={you?.ready ? 'ghost' : 'primary'}
            size="lg"
            block
            disabled={!bothHere}
            onClick={() => setReady(!you?.ready)}
          >
            {!bothHere ? 'Waiting for player…' : you?.ready ? 'Cancel ready' : 'Ready'}
          </Button>
        )}
      </Column>
    </ScreenTransition>
  );
}
