/**
 * HTTP + Socket.IO server. Serves /health, optionally the built client, and the realtime
 * game protocol. Every handler validates its payload and is rate limited per socket.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { Server, type Socket } from 'socket.io';
import { config } from './config';
import { LobbyManager } from './lobby/LobbyManager';
import { log } from './log';
import { makeLimits, type Limits } from './net/rateLimit';
import { cleanAxis, cleanCode, cleanDifficulty, cleanDigits, cleanMove, cleanName, cleanRef, cleanToken, isObj } from './net/validate';

type AckFn = (res: { ok: boolean; error?: string; data?: unknown }) => void;

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
      res.end(JSON.stringify({ status: 'ok', uptime: Math.round((Date.now() - started) / 1000), ...lobbies.stats() }));
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
  lobbies = new LobbyManager(io);

  io.on('connection', (socket) => wire(socket, lobbies));

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

function wire(socket: Socket, lobbies: LobbyManager) {
  const limits: Limits = makeLimits();
  const drop = () => {
    limits.violations++;
    if (limits.violations > 400) {
      log.warn('disconnecting abusive socket', { id: socket.id });
      socket.disconnect(true);
    }
    return false;
  };
  const allow = (bucket: keyof Omit<Limits, 'violations'>) => limits[bucket].take() || drop();
  const ack = (fn: unknown): AckFn => (typeof fn === 'function' ? (fn as AckFn) : () => {});
  const match = () => {
    const cur = lobbies.memberOf(socket);
    return cur?.lobby.match && cur.lobby.match.hasPlayer(cur.member.id) ? { m: cur.lobby.match, id: cur.member.id } : null;
  };

  socket.on('lobby:create', (p: unknown, cb: unknown) => {
    if (!allow('lobby')) return ack(cb)({ ok: false, error: 'Slow down.' });
    const name = cleanName(isObj(p) ? p.name : null);
    if (!name) return ack(cb)({ ok: false, error: 'Enter a name (1–16 characters).' });
    const r = lobbies.create(socket, name);
    ack(cb)(r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error });
  });

  socket.on('lobby:join', (p: unknown, cb: unknown) => {
    if (!allow('lobby')) return ack(cb)({ ok: false, error: 'Slow down.' });
    const name = cleanName(isObj(p) ? p.name : null);
    const code = cleanCode(isObj(p) ? p.code : null);
    if (!name) return ack(cb)({ ok: false, error: 'Enter a name (1–16 characters).' });
    if (!code) return ack(cb)({ ok: false, error: 'Lobby codes are 5 letters/numbers, like K7QXR.' });
    const r = lobbies.join(socket, code, name);
    ack(cb)(r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error });
  });

  socket.on('lobby:resume', (p: unknown, cb: unknown) => {
    if (!allow('lobby')) return ack(cb)({ ok: false, error: 'Slow down.' });
    const token = cleanToken(isObj(p) ? p.token : null);
    if (!token) return ack(cb)({ ok: false, error: 'Invalid session.' });
    const r = lobbies.resume(socket, token);
    ack(cb)(r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error });
  });

  socket.on('lobby:leave', (_p: unknown, cb: unknown) => {
    lobbies.leave(socket);
    ack(cb)({ ok: true });
  });

  socket.on('lobby:ready', (p: unknown, cb: unknown) => {
    if (!allow('lobby')) return;
    const r = lobbies.setReady(socket, !!(isObj(p) && p.ready));
    ack(cb)(r.ok ? { ok: true } : { ok: false, error: r.error });
  });

  socket.on('lobby:settings', (p: unknown, cb: unknown) => {
    if (!allow('lobby') || !isObj(p)) return;
    const patch: { difficulty?: 'easy' | 'normal' | 'hard' | 'extreme'; maxPlayers?: number } = {};
    if (p.difficulty !== undefined) {
      const d = cleanDifficulty(p.difficulty);
      if (!d) return ack(cb)({ ok: false, error: 'Unknown difficulty.' });
      patch.difficulty = d;
    }
    if (p.maxPlayers !== undefined) {
      if (typeof p.maxPlayers !== 'number' || !Number.isFinite(p.maxPlayers)) return ack(cb)({ ok: false, error: 'Invalid player count.' });
      patch.maxPlayers = p.maxPlayers;
    }
    const r = lobbies.setSettings(socket, patch);
    ack(cb)(r.ok ? { ok: true } : { ok: false, error: r.error });
  });

  socket.on('lobby:start', (_p: unknown, cb: unknown) => {
    if (!allow('lobby')) return;
    const r = lobbies.start(socket);
    ack(cb)(r.ok ? { ok: true } : { ok: false, error: r.error });
  });

  socket.on('lobby:return', (_p: unknown, cb: unknown) => {
    if (!allow('lobby')) return;
    const r = lobbies.returnToLobby(socket);
    ack(cb)(r.ok ? { ok: true } : { ok: false, error: r.error });
  });

  // ---------------- in-game ----------------
  socket.on('g:move', (p: unknown) => {
    if (!allow('move')) return;
    const msg = cleanMove(p);
    const g = match();
    if (msg && g) g.m.handleMove(g.id, msg);
  });

  socket.on('g:act', (p: unknown, cb: unknown) => {
    if (!allow('act')) return ack(cb)({ ok: false, error: 'Slow down.' });
    const ref = cleanRef(isObj(p) ? p.ref : null);
    const g = match();
    if (!ref || !g) return ack(cb)({ ok: false, error: 'Invalid.' });
    ack(cb)(g.m.handleAct(g.id, ref));
  });

  socket.on('g:holdStop', () => {
    const g = match();
    g?.m.handleHoldStop(g.id);
  });

  socket.on('g:drop', (_p: unknown, cb: unknown) => {
    if (!allow('act')) return;
    const g = match();
    ack(cb)(g ? g.m.handleDrop(g.id) : { ok: false });
  });

  socket.on('g:use', (p: unknown, cb: unknown) => {
    if (!allow('act') || !isObj(p)) return;
    const g = match();
    const yaw = typeof p.yaw === 'number' && Number.isFinite(p.yaw) ? p.yaw : 0;
    const pitch = typeof p.pitch === 'number' && Number.isFinite(p.pitch) ? Math.max(-1.6, Math.min(1.6, p.pitch)) : 0;
    ack(cb)(g ? g.m.handleUse(g.id, yaw, pitch) : { ok: false });
  });

  socket.on('g:code', (p: unknown, cb: unknown) => {
    if (!allow('act')) return;
    const code = cleanDigits(isObj(p) ? p.code : null);
    const g = match();
    if (!code || !g) return ack(cb)({ ok: false, error: 'Enter four digits.' });
    ack(cb)(g.m.handleCode(g.id, code));
  });

  socket.on('g:inspect', (_p: unknown, cb: unknown) => {
    if (!allow('act')) return;
    const g = match();
    ack(cb)(g ? g.m.handleInspect(g.id) : { ok: false });
  });

  socket.on('g:car', (p: unknown) => {
    if (!allow('car') || !isObj(p)) return;
    const g = match();
    g?.m.handleCarInput(g.id, { throttle: cleanAxis(p.throttle), steer: cleanAxis(p.steer) });
  });

  socket.on('g:breath', (p: unknown) => {
    if (!allow('act')) return;
    const g = match();
    g?.m.handleBreath(g.id, !!(isObj(p) && p.holding));
  });

  socket.on('disconnect', (reason) => {
    log.debug('socket disconnected', { id: socket.id, reason });
    lobbies.handleDisconnect(socket);
  });
}
