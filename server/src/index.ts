/**
 * Entry point: one process serving the built client and the game socket, so
 * the whole thing deploys as a single container.
 */
import { config } from './config.js';
import { createGameServer } from './app.js';

const server = createGameServer();

void server.listen().then((port) => {
  console.log(`[bbc] listening on http://${config.host}:${port}`);
  console.log(`[bbc] websocket at ws://${config.host}:${port}/ws`);
  if (config.clientDir) console.log(`[bbc] serving client from ${config.clientDir}`);
  else console.log('[bbc] no client bundle configured (set BBC_CLIENT_DIR to serve one)');
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[bbc] ${signal} received, shutting down`);
  const forced = setTimeout(() => process.exit(0), 3_000);
  forced.unref();
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// A single bad frame must never take the whole server down with it.
process.on('uncaughtException', (error) => console.error('[bbc] uncaught', error));
process.on('unhandledRejection', (reason) => console.error('[bbc] unhandled rejection', reason));
