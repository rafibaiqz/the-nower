/** Server configuration from environment variables (see .env.example). */
import { DEFAULT_MAX_PLAYERS } from '@nower/shared';

type EnvSource = Record<string, string | undefined>;

/** Node's process.env when it exists (absent in Cloudflare Workers without nodejs_compat). */
const nodeEnv: EnvSource = (globalThis as { process?: { env?: EnvSource } }).process?.env ?? {};

function int(env: EnvSource, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  const v = raw === undefined || raw === '' ? def : Number.parseInt(raw, 10);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function build(env: EnvSource) {
  return {
    port: int(env, 'PORT', 3001, 1, 65535),
    host: env.HOST || '0.0.0.0',
    /** Comma-separated list of allowed browser origins, or * for any (dev only). */
    clientOrigins: (env.CLIENT_ORIGIN || '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxPlayers: int(env, 'MAX_PLAYERS', DEFAULT_MAX_PLAYERS, 1, 8),
    maxLobbies: int(env, 'MAX_LOBBIES', 200, 1, 10_000),
    /** Directory with the built client to serve (single-service Node deployment). Empty = API only. */
    staticDir: env.STATIC_DIR ?? '',
    lobbyIdleMinutes: int(env, 'LOBBY_IDLE_MINUTES', 30, 1, 24 * 60),
    logLevel: (env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
  };
}

export const config = build(nodeEnv);

/** Re-reads configuration from another source, e.g. a Cloudflare Worker's `env` vars. */
export function applyConfig(env: EnvSource) {
  Object.assign(config, build(env));
}
