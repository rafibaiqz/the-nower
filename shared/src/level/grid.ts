/** Spatial queries over the cell grid, shared by client prediction and server validation. */
import { FLOOR_COUNT, FLOOR_HEIGHT, STEP_DOWN, STEP_UP, floorBase, floorOfY } from '../constants';
import { CT, F, type Level, type Stair } from './types';

/** Mutable world state that affects traversal (doors open, water drained). */
export interface DynWorld {
  doorOpen(door: number): boolean;
  waterDrained(zone: number): boolean;
}

export const STATIC_OPEN: DynWorld = { doorOpen: () => true, waterDrained: () => true };
export const STATIC_CLOSED: DynWorld = { doorOpen: () => false, waterDrained: () => false };

export function cellIndex(level: Level, x: number, z: number): number {
  return z * level.W + x;
}

export function inGrid(level: Level, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < level.W && z < level.D;
}

export function cellType(level: Level, f: number, x: number, z: number): number {
  if (f < 0 || f >= FLOOR_COUNT || !inGrid(level, x, z)) return CT.SOLID;
  return level.floors[f].type[z * level.W + x];
}

export function cellFlags(level: Level, f: number, x: number, z: number): number {
  if (f < 0 || f >= FLOOR_COUNT || !inGrid(level, x, z)) return 0;
  return level.floors[f].flags[z * level.W + x];
}

export function cellRoom(level: Level, f: number, x: number, z: number): number {
  if (f < 0 || f >= FLOOR_COUNT || !inGrid(level, x, z)) return -1;
  return level.floors[f].room[z * level.W + x];
}

export function roomAt(level: Level, f: number, wx: number, wz: number): number {
  return cellRoom(level, f, Math.floor(wx), Math.floor(wz));
}

/** Height of a stair ramp at a world position (clamped to the stair). */
export function stairHeight(st: Stair, wx: number, wz: number): number {
  const [x0, z0, x1, z1] = st.spec.rect;
  let p: number;
  switch (st.spec.dir) {
    case '-z':
      p = (z1 + 1 - wz) / (z1 + 1 - z0);
      break;
    case '+z':
      p = (wz - z0) / (z1 + 1 - z0);
      break;
    case '-x':
      p = (x1 + 1 - wx) / (x1 + 1 - x0);
      break;
    default:
      p = (wx - x0) / (x1 + 1 - x0);
  }
  p = p < 0 ? 0 : p > 1 ? 1 : p;
  return floorBase(st.spec.lower) + p * FLOOR_HEIGHT;
}

/**
 * Ground height of a cell for a walking body, sampled at world point (wx, wz),
 * or NaN when the cell cannot be stood on.
 */
export function groundAt(level: Level, dyn: DynWorld, f: number, cx: number, cz: number, wx: number, wz: number): number {
  if (f < 0 || f >= FLOOR_COUNT || !inGrid(level, cx, cz)) return NaN;
  const g = level.floors[f];
  const k = cz * level.W + cx;
  const t = g.type[k];
  if (g.flags[k] & F.FURN) return NaN;
  switch (t) {
    case CT.FLOOR:
    case CT.OUTDOOR:
      return g.base;
    case CT.DOOR:
      return dyn.doorOpen(g.ent[k]) ? g.base : NaN;
    case CT.WATER:
      return dyn.waterDrained(g.ent[k]) ? g.base : NaN;
    case CT.STAIR:
      return stairHeight(level.stairs[g.ent[k]], wx, wz);
    default:
      return NaN;
  }
}

/** Ground height directly beneath a body at (x, y, z). */
export function groundHeight(level: Level, dyn: DynWorld, x: number, y: number, z: number): number {
  const f = floorOfY(y);
  const h = groundAt(level, dyn, f, Math.floor(x), Math.floor(z), x, z);
  return Number.isNaN(h) ? y : h;
}

export interface Body {
  x: number;
  y: number;
  z: number;
}

export interface CircleObstacle {
  x: number;
  z: number;
  r: number;
  f: number;
}

function cellBlocksBody(level: Level, dyn: DynWorld, f: number, cx: number, cz: number, px: number, pz: number, y: number): boolean {
  const h = groundAt(level, dyn, f, cx, cz, Math.min(cx + 1, Math.max(cx, px)), Math.min(cz + 1, Math.max(cz, pz)));
  if (Number.isNaN(h)) return true;
  return h > y + STEP_UP || h < y - STEP_DOWN;
}

/**
 * Moves a circular body by (dx, dz) against the grid, resolving each axis separately so
 * bodies slide along walls. Returns true when any collision happened.
 */
export function moveBody(level: Level, dyn: DynWorld, b: Body, dx: number, dz: number, r: number, obstacles?: CircleObstacle[]): boolean {
  let hit = false;
  // sub-step so fast bodies (cars) never tunnel through 1m walls
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.25));
  const sx = dx / steps;
  const sz = dz / steps;
  for (let s = 0; s < steps; s++) {
    const f = floorOfY(b.y);
    // X axis
    if (sx !== 0) {
      const nx = b.x + sx;
      const x0 = Math.floor(nx - r);
      const x1 = Math.floor(nx + r);
      const z0 = Math.floor(b.z - r + 0.001);
      const z1 = Math.floor(b.z + r - 0.001);
      let clamp = nx;
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) {
          if (cx === Math.floor(b.x) && cz === Math.floor(b.z)) continue;
          if (!cellBlocksBody(level, dyn, f, cx, cz, nx, b.z, b.y)) continue;
          // circle vs cell overlap
          const qx = Math.max(cx, Math.min(nx, cx + 1));
          const qz = Math.max(cz, Math.min(b.z, cz + 1));
          if ((qx - nx) ** 2 + (qz - b.z) ** 2 >= r * r) continue;
          hit = true;
          clamp = sx > 0 ? Math.min(clamp, cx - r - 0.0005) : Math.max(clamp, cx + 1 + r + 0.0005);
        }
      b.x = sx > 0 ? Math.max(b.x, Math.min(clamp, nx)) : Math.min(b.x, Math.max(clamp, nx));
    }
    // Z axis
    if (sz !== 0) {
      const nz = b.z + sz;
      const z0 = Math.floor(nz - r);
      const z1 = Math.floor(nz + r);
      const x0 = Math.floor(b.x - r + 0.001);
      const x1 = Math.floor(b.x + r - 0.001);
      let clamp = nz;
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) {
          if (cx === Math.floor(b.x) && cz === Math.floor(b.z)) continue;
          if (!cellBlocksBody(level, dyn, f, cx, cz, b.x, nz, b.y)) continue;
          const qx = Math.max(cx, Math.min(b.x, cx + 1));
          const qz = Math.max(cz, Math.min(nz, cz + 1));
          if ((qx - b.x) ** 2 + (qz - nz) ** 2 >= r * r) continue;
          hit = true;
          clamp = sz > 0 ? Math.min(clamp, cz - r - 0.0005) : Math.max(clamp, cz + 1 + r + 0.0005);
        }
      b.z = sz > 0 ? Math.max(b.z, Math.min(clamp, nz)) : Math.min(b.z, Math.max(clamp, nz));
    }
    if (obstacles) {
      for (const o of obstacles) {
        if (o.f !== f) continue;
        const ddx = b.x - o.x;
        const ddz = b.z - o.z;
        const dist = Math.hypot(ddx, ddz);
        const min = o.r + r;
        if (dist < min && dist > 1e-4) {
          b.x = o.x + (ddx / dist) * min;
          b.z = o.z + (ddz / dist) * min;
          hit = true;
        }
      }
    }
    const h = groundAt(level, dyn, floorOfY(b.y), Math.floor(b.x), Math.floor(b.z), b.x, b.z);
    if (!Number.isNaN(h)) b.y = h;
  }
  return hit;
}

/** True when a standing body could legally occupy (x, y, z). */
export function canStand(level: Level, dyn: DynWorld, x: number, y: number, z: number): boolean {
  const f = floorOfY(y);
  const h = groundAt(level, dyn, f, Math.floor(x), Math.floor(z), x, z);
  return !Number.isNaN(h) && Math.abs(h - y) < 0.9;
}

/**
 * Validates a straight-line move (server anti-cheat): samples along the segment and checks
 * every sample is standable with legal step heights.
 */
export function segmentWalkable(level: Level, dyn: DynWorld, ax: number, ay: number, az: number, bx: number, bz: number): { ok: boolean; y: number } {
  const dist = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(dist / 0.2));
  let y = ay;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const f = floorOfY(y);
    const h = groundAt(level, dyn, f, Math.floor(x), Math.floor(z), x, z);
    if (Number.isNaN(h) || h > y + STEP_UP + 0.1 || h < y - STEP_DOWN - 0.1) return { ok: false, y };
    y = h;
  }
  return { ok: true, y };
}

/** Floor index containing a point in the air (not a body). */
export function floorOfPoint(y: number): number {
  const f = Math.floor(y / FLOOR_HEIGHT) + 2;
  return f < 0 ? 0 : f >= FLOOR_COUNT ? FLOOR_COUNT - 1 : f;
}

/**
 * 3D line of sight through the stacked grids. Blocked by solid cells, closed doors, tall
 * furniture, low furniture below 0.85m, and floor slabs (unless the slab is open: stairwells
 * and the double-height hall void).
 */
export function lineOfSight(
  level: Level,
  dyn: DynWorld,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  ignoreDoor = -1,
): boolean {
  const dist = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(1, Math.ceil(dist / 0.2));
  const W = level.W;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (!inGrid(level, cx, cz)) return false;
    const f = floorOfPoint(y);
    const g = level.floors[f];
    const k = cz * W + cx;
    const ty = g.type[k];
    const local = y - g.base;
    if (ty === CT.SOLID) return false;
    if (ty === CT.DOOR && g.ent[k] !== ignoreDoor && !dyn.doorOpen(g.ent[k])) return false;
    const fl = g.flags[k];
    if (fl & F.TALL && local < 2.2) return false;
    if (fl & F.FURN && local < 0.8) return false;
    if (ty !== CT.OUTDOOR && ty !== CT.VOID && ty !== CT.STAIR && local > g.ceilH) {
      // inside the slab between floors: open only if the cell above is a void or stairwell
      const up = f + 1 < FLOOR_COUNT ? level.floors[f + 1] : null;
      const ut = up ? up.type[k] : CT.SOLID;
      if (!(ut === CT.STAIR || (ut === CT.VOID && up!.room[k] >= 0))) return false;
    }
    if (local < 0 && ty !== CT.STAIR) return false;
  }
  return true;
}

/** Steps a ray until it hits something; returns the last free point (used for thrown objects). */
export function castRay(
  level: Level,
  dyn: DynWorld,
  ax: number,
  ay: number,
  az: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): { x: number; y: number; z: number; dist: number } {
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  let px = ax;
  let py = ay;
  let pz = az;
  for (let d = 0.15; d <= maxDist; d += 0.15) {
    const x = ax + dx * d;
    const y = ay + dy * d;
    const z = az + dz * d;
    if (!lineOfSight(level, dyn, px, py, pz, x, y, z)) return { x: px, y: py, z: pz, dist: d };
    const f = floorOfPoint(y);
    const h = groundAt(level, dyn, f, Math.floor(x), Math.floor(z), x, z);
    if (!Number.isNaN(h) && y <= h + 0.05) return { x, y: h, z, dist: d };
    px = x;
    py = y;
    pz = z;
  }
  return { x: px, y: py, z: pz, dist: maxDist };
}

/** Nearest standable position to (x, z) on the floor of y, searching outward a few cells. */
export function nearestStandable(level: Level, dyn: DynWorld, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const f = floorOfY(y);
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let r = 0; r <= 4; r++) {
    let best: { x: number; y: number; z: number } | null = null;
    let bd = Infinity;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        const t = cellType(level, f, nx, nz);
        if (t === CT.STAIR) continue;
        const h = groundAt(level, dyn, f, nx, nz, nx + 0.5, nz + 0.5);
        if (Number.isNaN(h) || t === CT.DOOR) continue;
        const px = r === 0 ? x : nx + 0.5;
        const pz = r === 0 ? z : nz + 0.5;
        const dd = (px - x) ** 2 + (pz - z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = { x: px, y: h, z: pz };
        }
      }
    if (best) return best;
  }
  return { x, y, z };
}

export function forwardFromYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function yawToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
