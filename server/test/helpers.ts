import {
  Navigator,
  floorOfY,
  getLevel,
  lineOfSight,
  nearestStandable,
  targetPos,
  yawToward,
  type Difficulty,
  type GameEvent,
  type MatchResult,
  type NavWorld,
} from '@nower/shared';
import { Match } from '../src/match/Match';

export const level = getLevel();

export interface Ctx {
  match: Match;
  events: GameEvent[];
  ended: () => MatchResult | null;
}

export function makeMatch(n = 1, difficulty: Difficulty = 'easy', seed = 4242): Ctx {
  const events: GameEvent[] = [];
  let ended: MatchResult | null = null;
  const sink = {
    broadcast: (ev: string, data: unknown) => {
      if (ev === 'g:ev') events.push(...(data as GameEvent[]));
    },
    toPlayer: () => {},
    onEnded: (r: MatchResult) => {
      ended = r;
    },
  };
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, color: 0 }));
  const match = new Match(players, difficulty, sink, seed);
  match.testSetPhasePlaying();
  match.testFreezeEnemy();
  return { match, events, ended: () => ended };
}

export function ticks(ctx: Ctx, seconds: number, dt = 0.05) {
  const n = Math.ceil(seconds / dt);
  for (let i = 0; i < n; i++) ctx.match.tick(dt);
}

/** Puts a player on a specific cell, facing a point. */
export function standAt(ctx: Ctx, pid: string, f: number, cx: number, cz: number, face?: [number, number, number]) {
  const p = nearestStandable(level, ctx.match.dyn, cx + 0.5, (f - 2) * 4, cz + 0.5);
  const yaw = face ? yawToward(face[0] - p.x, face[2] - p.z) : 0;
  ctx.match.testPlace(pid, p.x, p.y, p.z, yaw);
}

/** Puts a player on the nearest standable spot that can reach a target. */
export function standNear(ctx: Ctx, pid: string, ref: string) {
  const pos = targetPos(ctx.match, ref);
  if (!pos) throw new Error(`no position for ${ref}`);
  if (ref.startsWith('mech:')) {
    const m = level.mechs[level.mechById.get(ref.slice(5))!];
    return standAt(ctx, pid, m.spec.f, m.spec.access[0], m.spec.access[1], pos);
  }
  if (ref.startsWith('hide:')) {
    const h = level.hides[Number(ref.slice(5))];
    return standAt(ctx, pid, h.f, Math.floor(h.exit[0]), Math.floor(h.exit[2]), pos);
  }
  const f = floorOfY(pos[1] - 1.1);
  const base = (f - 2) * 4;
  let best: { x: number; z: number; d: number } | null = null;
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = Math.floor(pos[0]) + dx + 0.5;
      const z = Math.floor(pos[2]) + dz + 0.5;
      const s = nearestStandable(level, ctx.match.dyn, x, base, z);
      if (Math.floor(s.x) !== Math.floor(x) || Math.floor(s.z) !== Math.floor(z)) continue;
      const d = Math.hypot(s.x - pos[0], s.z - pos[2]);
      if (d < 0.5 || d > 2) continue;
      if (!lineOfSight(level, ctx.match.dyn, s.x, s.y + 1.6, s.z, pos[0], pos[1], pos[2], ref.startsWith('door:') ? Number(ref.split(':')[1]) : -1)) continue;
      if (!best || d < best.d) best = { x: s.x, z: s.z, d };
    }
  if (!best) throw new Error(`nowhere to stand near ${ref}`);
  ctx.match.testPlace(pid, best.x, base, best.z, yawToward(pos[0] - best.x, pos[2] - best.z));
}

/** Performs an interaction, completing holds by advancing time. */
export function act(ctx: Ctx, pid: string, ref: string) {
  const r = ctx.match.handleAct(pid, ref);
  if (!r.ok) throw new Error(`${ref}: ${r.error}`);
  const hold = (r.data as { hold?: number } | undefined)?.hold;
  if (hold) ticks(ctx, hold / 1000 + 0.2);
  return r;
}

export function give(ctx: Ctx, pid: string, item: string) {
  ctx.match.testGive(pid, item);
}

export function doorIdx(id: string) {
  return level.doorById.get(id)!;
}

/** Walks a player along a navigation path using real, validated movement messages. */
export function walkTo(ctx: Ctx, pid: string, f: number, x: number, z: number) {
  const m = ctx.match;
  const p = m.testPlayer(pid);
  const world: NavWorld = {
    doorOpen: (i) => m.doors[i].open,
    doorPassable: () => false,
    waterDrained: (i) => m.water[i].drained,
    ladderOpen: () => false,
  };
  const nav = new Navigator(level);
  const path = nav.findPath(world, floorOfY(p.y), p.x, p.z, f, x, z, 200000);
  if (!path) throw new Error(`no path to ${f}:${x},${z}`);
  for (const wp of path) {
    for (let guard = 0; guard < 400; guard++) {
      if (p.pub.status !== 'free') return;
      const dx = wp.x - p.x;
      const dz = wp.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) break;
      const step = Math.min(0.2, d);
      const before = p.teleportSeq;
      m.handleMove(pid, { seq: p.teleportSeq, x: p.x + (dx / d) * step, y: p.y, z: p.z + (dz / d) * step, yaw: yawToward(dx, dz), pitch: 0, flags: 0 });
      if (p.teleportSeq !== before) throw new Error(`movement rejected near ${p.x.toFixed(2)},${p.z.toFixed(2)} (floor ${floorOfY(p.y)})`);
      m.tick(0.06);
    }
  }
}
