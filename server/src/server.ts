/**
 * HTTP + Socket.IO server. Serves /health, optionally the built client, and the realtime
 * game protocol. Every handler validates its payload and is rate limited per socket.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { Server } from 'socket.io';
import { config } from './config';
import { LobbyManager } from './lobby/LobbyManager';
import { log } from './log';
import { wireConnection } from './net/handlers';
import { socketIoHub, wrapSocket } from './net/socketio';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface GameServer {
  port: number;
  close(): Promise<void>;
  lobbies: LobbyManager;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, root: string): boolean {
  if (!root || req.method !== 'GET') return false;
  const url = new URL(req.url ?? '/', 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const base = resolve(root);
  let file = normalize(join(base, rel));
  if (!file.startsWith(base)) return false;
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (extname(rel)) return false;
    file = join(base, 'index.html'); // SPA fallback
    if (!existsSync(file)) return false;
  }
  const ext = extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(res);
  return true;
}

export function createGameServer(port = config.port, host = config.host): Promise<GameServer> {
  const started = Date.now();
  let lobbies: LobbyManager;
  const http = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok', runtime: 'node', transport: 'socket.io', uptime: Math.round((Date.now() - started) / 1000), ...lobbies.stats() }));
      return;
    }
    if (serveStatic(req, res, config.staticDir)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('THE NOWER game server. Nothing here.');
  });

  const anyOrigin = config.clientOrigins.includes('*');
  const io = new Server(http, {
    cors: { origin: anyOrigin ? true : config.clientOrigins, methods: ['GET', 'POST'] },
    pingInterval: 10_000,
    pingTimeout: 15_000,
    maxHttpBufferSize: 16_000,
    connectionStateRecovery: undefined,
  });
  lobbies = new LobbyManager(socketIoHub(io));

  io.on('connection', (socket) => wireConnection(wrapSocket(socket), lobbies));

  return new Promise((resolveP) => {
    http.listen(port, host, () => {
      const addr = http.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      log.info('THE NOWER server listening', { port: actual, origins: config.clientOrigins, maxPlayers: config.maxPlayers, static: config.staticDir || null });
      resolveP({
        port: actual,
        lobbies,
        close: () =>
          new Promise<void>((r) => {
            lobbies.dispose();
            io.close();
            http.close(() => r());
          }),
      });
    });
  });
}
