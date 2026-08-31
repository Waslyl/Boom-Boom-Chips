import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter';
import './styles/theme.css';
import { App } from './App';
import { initSettings } from './state/settings';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// Preferences must reach the audio and particle systems before the first paint,
// otherwise a player who asked for calm gets one frame of confetti.
initSettings();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
