import { useEffect, type ReactElement } from 'react';
import { AnimatePresence } from 'motion/react';
import { useGame, stageOf } from './state/store';
import { MenuBackdrop, ParticleLayer } from './fx/Backdrop';
import { ToastLayer } from './components/ui/Toast';
import { BusyOverlay, ConnectionOverlay } from './components/ui/Overlays';
import { MenuScreen } from './screens/MenuScreen';
import { BotSetupScreen } from './screens/BotSetupScreen';
import { CreatePartyScreen, FriendScreen, JoinPartyScreen } from './screens/FriendScreens';
import { LobbyScreen } from './screens/LobbyScreen';
import { SetupScreen } from './screens/SetupScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultScreen } from './screens/ResultScreen';
import { HowToPlayScreen } from './screens/HowToPlayScreen';
import { SettingsScreen } from './screens/SettingsScreen';

/**
 * Which screen is showing is derived, not stored twice: an active match always
 * wins over whatever menu route was last visited, so a reconnect drops you
 * straight back into the game.
 */
function useCurrentScreen(): { key: string; element: ReactElement } {
  const route = useGame((state) => state.route);
  const view = useGame((state) => state.view);
  const party = useGame((state) => state.party);
  const stage = stageOf({ view, party, route });

  switch (stage) {
    case 'RESULT':
      return { key: 'result', element: <ResultScreen /> };
    case 'GAME':
      return { key: 'game', element: <GameScreen /> };
    case 'SETUP':
      return { key: 'setup', element: <SetupScreen /> };
    case 'LOBBY':
      return party && party.members.length < 2
        ? { key: 'create', element: <CreatePartyScreen /> }
        : { key: 'lobby', element: <LobbyScreen /> };
    case 'MENU_STACK':
    default:
      switch (route) {
        case 'BOT_SETUP':
          return { key: 'bot', element: <BotSetupScreen /> };
        case 'FRIEND':
          return { key: 'friend', element: <FriendScreen /> };
        case 'CREATE':
          return { key: 'create', element: <CreatePartyScreen /> };
        case 'JOIN':
          return { key: 'join', element: <JoinPartyScreen /> };
        case 'HOW_TO_PLAY':
          return { key: 'how', element: <HowToPlayScreen /> };
        case 'SETTINGS':
          return { key: 'settings', element: <SettingsScreen /> };
        case 'MENU':
        default:
          return { key: 'menu', element: <MenuScreen /> };
      }
  }
}

export function App() {
  const boot = useGame((state) => state.boot);
  const { key, element } = useCurrentScreen();

  useEffect(() => {
    boot();
  }, [boot]);

  return (
    <>
      <MenuBackdrop />
      <ParticleLayer />
      <ToastLayer />
      <ConnectionOverlay />
      <BusyOverlay />

      <main className="screen-shell mx-auto w-full max-w-[1400px]">
        <AnimatePresence mode="wait">
          <div key={key} className="flex flex-1 flex-col">
            {element}
          </div>
        </AnimatePresence>
      </main>
    </>
  );
}
