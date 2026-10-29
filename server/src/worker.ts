/**
 * Cloudflare Workers entry point.
 *
 * A Worker by itself is stateless, but THE NOWER needs one long-lived authority per match
 * (lobbies, the 20 Hz simulation, the Nower's AI). On Cloudflare that authority is a Durable
 * Object: this Worker serves the built client from static assets and forwards `/ws` (game
 * WebSockets) and `/health` to a single `GameServer` Durable Object. The object runs exactly the
 * same LobbyManager / Match code as the Node.js server, over raw WebSockets instead of Socket.IO.
 *
 * Scaling note: every lobby lives in the one `GameServer` instance (like the single Node process).
 * That comfortably serves many small co-op matches; sharding lobbies across objects is possible
 * later by routing on the lobby code.
 */
import { DurableObject } from 'cloudflare:workers';
import { applyConfig, config } from './config';
import { LobbyManager } from './lobby/LobbyManager';
import { log } from './log';
import { wireConnection } from './net/handlers';
import { WsHub, type WsLike } from './net/wsHub';

export interface Env {
  GAME: DurableObjectNamespace<GameServer>;
  ASSETS: Fetcher;
  CLIENT_ORIGIN?: string;
  MAX_PLAYERS?: string;
  MAX_LOBBIES?: string;
  LOBBY_IDLE_MINUTES?: string;
  LOG_LEVEL?: string;
}

/** All lobbies share one authoritative instance, mirroring the single Node.js process. */
const INSTANCE = 'global';
const GAME_PATHS = new Set(['/ws', '/health', '/healthz']);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (GAME_PATHS.has(url.pathname)) {
      const stub = env.GAME.get(env.GAME.idFromName(INSTANCE));
      return stub.fetch(request);
    }
    // everything else is the web client (also served directly by the assets layer)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class GameServer extends DurableObject<Env> {
  private readonly hub = new WsHub();
  private readonly lobbies: LobbyManager;
  private readonly started = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    applyConfig(env as unknown as Record<string, string | undefined>);
    this.lobbies = new LobbyManager(this.hub);
    // clients ping every 20 s; drop connections that silently died
    setInterval(() => this.hub.sweep(), 15_000);
    log.info('GameServer durable object started', { maxPlayers: config.maxPlayers, origins: config.clientOrigins });
  }

  private originAllowed(origin: string | null, url: URL): boolean {
    if (!origin || origin === url.origin) return true;
    return config.clientOrigins.includes('*') || config.clientOrigins.includes(origin);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      return Response.json(
        { status: 'ok', runtime: 'cloudflare', transport: 'websocket', uptime: Math.round((Date.now() - this.started) / 1000), connections: this.hub.size, ...this.lobbies.stats() },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 });
    if (!this.originAllowed(request.headers.get('Origin'), url)) return new Response('Origin not allowed.', { status: 403 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Standard (non-hibernating) accept: the object stays resident while players are connected,
    // which keeps the match tick loop running.
    server.accept();
    wireConnection(this.hub.add(server as unknown as WsLike), this.lobbies);
    return new Response(null, { status: 101, webSocket: client });
  }
}
