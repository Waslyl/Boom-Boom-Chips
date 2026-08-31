/**
 * WebSocket transport. Thin on purpose — it adapts a socket into a
 * `ClientLink` and hands everything else to the gateway.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ServerMessage } from '@bbc/shared';
import { config } from '../config.js';
import type { ClientLink } from './connection.js';
import { Gateway, Session } from './gateway.js';
import type { RoomManager } from '../rooms/roomManager.js';

const connectionsByAddress = new Map<string, number>();

function addressOf(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return (forwarded.split(',')[0] ?? '').trim() || 'unknown';
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function originAllowed(request: IncomingMessage): boolean {
  if (config.allowedOrigins.length === 0) return true;
  const origin = request.headers.origin;
  if (!origin) return true; // native clients and same-origin requests send none
  return config.allowedOrigins.includes(origin);
}

export interface WsServer {
  readonly gateway: Gateway;
  close(): Promise<void>;
}

export function attachWebSocketServer(http: HttpServer, rooms: RoomManager): WsServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  const gateway = new Gateway(rooms);
  const sessions = new Map<WebSocket, Session>();

  http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!request.url?.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    if (!originAllowed(request)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const address = addressOf(request);
    if ((connectionsByAddress.get(address) ?? 0) >= config.maxConnectionsPerAddress) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const address = addressOf(request);
    connectionsByAddress.set(address, (connectionsByAddress.get(address) ?? 0) + 1);

    const link: ClientLink = {
      id: randomUUID(),
      address,
      get isOpen() {
        return ws.readyState === ws.OPEN;
      },
      send(message: ServerMessage) {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(JSON.stringify(message));
      },
      close(code = 1000, reason = '') {
        try {
          ws.close(code, reason);
        } catch {
          ws.terminate();
        }
      },
    };

    const session = new Session(link);
    sessions.set(ws, session);
    gateway.open(session);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      gateway.receive(session, data.toString());
    });

    ws.on('pong', () => {
      session.missedBeats = 0;
    });

    ws.on('error', () => ws.terminate());

    ws.on('close', () => {
      sessions.delete(ws);
      gateway.close(session);
      const remaining = (connectionsByAddress.get(address) ?? 1) - 1;
      if (remaining <= 0) connectionsByAddress.delete(address);
      else connectionsByAddress.set(address, remaining);
    });
  });

  // Heartbeat: a socket that stops answering is dropped, which is what starts
  // the reconnection grace period on the room side.
  const heartbeat = setInterval(() => {
    for (const [ws, session] of sessions) {
      if (session.missedBeats >= config.heartbeatMisses) {
        ws.terminate();
        continue;
      }
      session.missedBeats += 1;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, config.heartbeatIntervalMs);
  heartbeat.unref?.();

  return {
    gateway,
    close(): Promise<void> {
      clearInterval(heartbeat);
      for (const ws of sessions.keys()) ws.terminate();
      sessions.clear();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}
