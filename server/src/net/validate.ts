/** Input validation for untrusted client payloads. */
import { DIFFICULTIES, LOBBY_CODE_ALPHABET, LOBBY_CODE_LENGTH, MAX_NAME_LENGTH, type Difficulty, type MoveMsg } from '@nower/shared';

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // strip control characters and collapse whitespace
  const s = v
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return s.length >= 1 ? s : null;
}

export function cleanCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== LOBBY_CODE_LENGTH) return null;
  for (const ch of s) if (!LOBBY_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function cleanToken(v: unknown): string | null {
  return typeof v === 'string' && /^[a-f0-9]{48}$/.test(v) ? v : null;
}

export function cleanDifficulty(v: unknown): Difficulty | null {
  return typeof v === 'string' && (DIFFICULTIES as string[]).includes(v) ? (v as Difficulty) : null;
}

export function cleanMove(v: unknown): MoveMsg | null {
  if (!isObj(v)) return null;
  const { seq, x, y, z, yaw, pitch, flags } = v;
  if (!finite(seq) || !finite(x) || !finite(y) || !finite(z) || !finite(yaw) || !finite(pitch) || !finite(flags)) return null;
  if (Math.abs(x) > 1000 || Math.abs(y) > 100 || Math.abs(z) > 1000) return null;
  return { seq: seq | 0, x, y, z, yaw: yaw % (Math.PI * 4), pitch: Math.max(-1.6, Math.min(1.6, pitch)), flags: flags & 0xff };
}

export function cleanRef(v: unknown): string | null {
  return typeof v === 'string' && v.length <= 48 && /^[a-z]+(:[A-Za-z0-9_#-]+){1,2}$/.test(v) ? v : null;
}

export function cleanDigits(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9]{4}$/.test(v) ? v : null;
}

export function cleanAxis(v: unknown): number {
  return finite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}
