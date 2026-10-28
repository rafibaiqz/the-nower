/** Server configuration from environment variables (see .env.example). */
import { DEFAULT_MAX_PLAYERS } from '@nower/shared';

function int(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  const v = raw === undefined || raw === '' ? def : Number.parseInt(raw, 10);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

export const config = {
  port: int('PORT', 3001, 1, 65535),
  host: process.env.HOST || '0.0.0.0',
  /** Comma-separated list of allowed browser origins, or * for any (dev only). */
  clientOrigins: (process.env.CLIENT_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxPlayers: int('MAX_PLAYERS', DEFAULT_MAX_PLAYERS, 1, 8),
  maxLobbies: int('MAX_LOBBIES', 200, 1, 10_000),
  /** Directory with the built client to serve (single-service deployment). Empty = API only. */
  staticDir: process.env.STATIC_DIR ?? '',
  lobbyIdleMinutes: int('LOBBY_IDLE_MINUTES', 30, 1, 24 * 60),
  logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
};
