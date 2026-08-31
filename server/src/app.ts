/**
 * The server, assembled but not started.
 *
 * Keeping construction separate from listening is what lets the integration
 * tests boot a real HTTP + WebSocket server on an ephemeral port and drive it
 * with real sockets, instead of trusting a mock to behave like one.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { config } from './config.js';
import { attachWebSocketServer, type WsServer } from './net/wsServer.js';
import { RoomManager } from './rooms/roomManager.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(request: IncomingMessage, response: ServerResponse, root: string): boolean {
  const rawPath = (request.url ?? '/').split('?')[0] ?? '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return false;
  }

  // Resolve inside the root, then verify the result is still inside it. This is
  // what stops `../../etc/passwd` and its encoded variants.
  const candidate = resolve(join(root, normalize(decoded)));
  const inside = candidate === root || candidate.startsWith(root + sep);

  let file: string | null = null;
  if (inside && existsSync(candidate) && statSync(candidate).isFile()) file = candidate;
  if (!file) {
    // Single-page app: any unknown path falls back to the shell.
    const shell = join(root, 'index.html');
    if (!existsSync(shell)) return false;
    file = shell;
  }

  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const hashed = file.includes(`${sep}assets${sep}`);
  response.writeHead(200, {
    'content-type': type,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  });
  createReadStream(file).pipe(response);
  return true;
}

export interface GameServer {
  readonly http: Server;
  readonly rooms: RoomManager;
  readonly ws: WsServer;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createGameServer(clientDir: string | null = config.clientDir): GameServer {
  const rooms = new RoomManager();
  const clientRoot = clientDir ? resolve(clientDir) : null;

  const http = createServer((request, response) => {
    if (request.url === '/health' || request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
      return;
    }
    if (clientRoot && serveStatic(request, response, clientRoot)) return;

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  const ws = attachWebSocketServer(http, rooms);

  return {
    http,
    rooms,
    ws,
    listen(port = config.port, host = config.host): Promise<number> {
      return new Promise((resolvePort, reject) => {
        http.once('error', reject);
        http.listen(port, host, () => {
          const address = http.address();
          resolvePort(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    async close(): Promise<void> {
      rooms.shutdown();
      await ws.close();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}
