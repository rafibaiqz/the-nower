/**
 * Rasterises the authored layout into per-floor cell grids and derives everything the
 * simulation needs: furniture (auto-placed with path-safety checks), hiding spots,
 * containers, item spawn points, lights, notes, trap candidates and patrol points.
 *
 * The build is fully deterministic: server and every client produce the identical level.
 */
import { FLOOR_COUNT, FLOOR_HEIGHT, floorBase } from '../constants';
import { Rng, hashString } from '../rng';
import { furnSpec } from './furniture';
import * as Lay from './layout';
import {
  CT,
  F,
  GRID_D,
  GRID_W,
  SOLID_STYLES,
  type Container,
  type Door,
  type FloorGrid,
  type Furniture,
  type HideSpot,
  type Ladder,
  type Level,
  type LightDef,
  type Mech,
  type NotePlaced,
  type Rect,
  type Room,
  type SpawnPoint,
  type Stair,
  type WaterZone,
} from './types';

const W = GRID_W;
const D = GRID_D;
const idx = (x: number, z: number) => z * W + x;
const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < D;

export const YAW_OF_ROT = [Math.PI, -Math.PI / 2, 0, Math.PI / 2] as const;
const FRONT_OF_ROT: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

function styleIndex(s: string): number {
  const i = (SOLID_STYLES as readonly string[]).indexOf(s);
  return i < 0 ? 0 : i;
}

function forRect(r: Rect, fn: (x: number, z: number) => void) {
  for (let z = r[1]; z <= r[3]; z++) for (let x = r[0]; x <= r[2]; x++) if (inBounds(x, z)) fn(x, z);
}

function makeFloor(i: number): FloorGrid {
  const n = W * D;
  return {
    index: i,
    base: floorBase(i),
    ceilH: Lay.CEIL_H[i],
    type: new Uint8Array(n).fill(Lay.FLOOR_DEFAULT[i] === 'void' ? CT.VOID : CT.SOLID),
    room: new Int16Array(n).fill(-1),
    flags: new Uint8Array(n),
    ent: new Int16Array(n).fill(-1),
    style: new Uint8Array(n),
    furn: new Int16Array(n).fill(-1),
  };
}

export function isWalkableType(t: number): boolean {
  return t === CT.FLOOR || t === CT.OUTDOOR || t === CT.STAIR || t === CT.DOOR || t === CT.WATER;
}

let cached: Level | null = null;
/** Builds (once) and returns the shared level. */
export function getLevel(): Level {
  if (!cached) cached = buildLevel();
  return cached;
}

export function buildLevel(): Level {
  const floors = Array.from({ length: FLOOR_COUNT }, (_, i) => makeFloor(i));
  const roomById = new Map<string, number>();
  Lay.ROOMS.forEach((r, i) => roomById.set(r.id, i));

  const carve = (ri: number, type: number) => {
    const spec = Lay.ROOMS[ri];
    const g = floors[spec.f];
    for (const r of spec.rects)
      forRect(r, (x, z) => {
        const k = idx(x, z);
        g.type[k] = type;
        g.room[k] = ri;
      });
  };

  // 1. outdoor rooms, 2. building solids, 3. indoor rooms
  Lay.ROOMS.forEach((r, i) => r.outdoor && carve(i, CT.OUTDOOR));
  for (const s of Lay.SOLID_RECTS) {
    const g = floors[s.f];
    forRect(s.rect, (x, z) => {
      const k = idx(x, z);
      g.type[k] = CT.SOLID;
      g.room[k] = -1;
      g.style[k] = styleIndex(s.style);
    });
  }
  Lay.ROOMS.forEach((r, i) => !r.outdoor && carve(i, CT.FLOOR));
  for (const s of Lay.STYLE_RECTS) {
    const g = floors[s.f];
    forRect(s.rect, (x, z) => {
      const k = idx(x, z);
      if (g.type[k] === CT.SOLID) g.style[k] = styleIndex(s.style);
    });
  }
  // sewer and basement walls default to rock
  for (const fi of [0, 1]) {
    const g = floors[fi];
    for (let k = 0; k < W * D; k++) if (g.type[k] === CT.SOLID && g.style[k] === 0) g.style[k] = styleIndex('rock');
  }
  for (const v of Lay.VOID_RECTS) {
    const g = floors[v.f];
    const ri = roomById.get(v.room)!;
    forRect(v.rect, (x, z) => {
      const k = idx(x, z);
      g.type[k] = CT.VOID;
      g.room[k] = ri;
    });
  }
  for (const r of Lay.RAIL_RECTS) {
    const g = floors[r.f];
    forRect(r.rect, (x, z) => {
      const k = idx(x, z);
      g.type[k] = CT.RAIL;
      if (r.style) g.style[k] = styleIndex(r.style);
    });
  }

  // water zones
  const water: WaterZone[] = Lay.WATER_ZONES.map((spec, i) => {
    const g = floors[spec.f];
    forRect(spec.rect, (x, z) => {
      const k = idx(x, z);
      if (g.type[k] === CT.FLOOR) {
        g.type[k] = CT.WATER;
        g.ent[k] = i;
      }
    });
    return { index: i, spec };
  });

  const flagRects = (list: { f: number; rect: Rect }[], bit: number) => {
    for (const r of list) {
      const g = floors[r.f];
      forRect(r.rect, (x, z) => {
        const k = idx(x, z);
        if (g.type[k] === CT.FLOOR || g.type[k] === CT.OUTDOOR) g.flags[k] |= bit;
      });
    }
  };
  flagRects(Lay.SHALLOW_RECTS, F.SHALLOW);
  flagRects(Lay.SLIPPERY_RECTS, F.SLIPPERY);
  flagRects(Lay.GRATE_RECTS, F.GRATE);
  flagRects(Lay.WEAK_RECTS, F.WEAK | F.CREAKY);

  // doors
  const doorById = new Map<string, number>();
  const doors: Door[] = Lay.DOORS.map((spec, i) => {
    const g = floors[spec.f];
    doorById.set(spec.id, i);
    for (const [x, z] of spec.cells) {
      const k = idx(x, z);
      g.type[k] = CT.DOOR;
      g.ent[k] = i;
      g.room[k] = -1;
    }
    const [x0, z0] = spec.cells[0];
    const walk = (x: number, z: number) => inBounds(x, z) && g.type[idx(x, z)] !== CT.SOLID && g.type[idx(x, z)] !== CT.VOID;
    const pass: 'x' | 'z' = walk(x0, z0 - 1) && walk(x0, z0 + 1) ? 'z' : 'x';
    const ra = pass === 'z' ? g.room[idx(x0, z0 - 1)] : g.room[idx(x0 - 1, z0)];
    const rb = pass === 'z' ? g.room[idx(x0, z0 + 1)] : g.room[idx(x0 + 1, z0)];
    let cx = 0;
    let cz = 0;
    for (const [x, z] of spec.cells) {
      cx += x + 0.5;
      cz += z + 0.5;
    }
    cx /= spec.cells.length;
    cz /= spec.cells.length;
    return { index: i, spec, pass, rooms: [ra, rb], center: [cx, g.base, cz], width: spec.cells.length };
  });

  // stairs (cells exist on both the lower and the upper grid)
  const stairs: Stair[] = Lay.STAIRS.map((spec, i) => {
    const [x0, z0, x1, z1] = spec.rect;
    let top: [number, number][] = [];
    let bottom: [number, number][] = [];
    let sides: [number, number][] = [];
    const xs = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, j) => a + j);
    if (spec.dir === '-z' || spec.dir === '+z') {
      const topZ = spec.dir === '-z' ? z0 - 1 : z1 + 1;
      const botZ = spec.dir === '-z' ? z1 + 1 : z0 - 1;
      top = xs(x0, x1).map((x) => [x, topZ]);
      bottom = xs(x0, x1).map((x) => [x, botZ]);
      sides = [...xs(z0, z1).map((z) => [x0 - 1, z] as [number, number]), ...xs(z0, z1).map((z) => [x1 + 1, z] as [number, number])];
    } else {
      const topX = spec.dir === '-x' ? x0 - 1 : x1 + 1;
      const botX = spec.dir === '-x' ? x1 + 1 : x0 - 1;
      top = xs(z0, z1).map((z) => [topX, z]);
      bottom = xs(z0, z1).map((z) => [botX, z]);
      sides = [...xs(x0, x1).map((x) => [x, z0 - 1] as [number, number]), ...xs(x0, x1).map((x) => [x, z1 + 1] as [number, number])];
    }
    const lower = floors[spec.lower];
    const upper = floors[spec.lower + 1];
    const lowerRoom = lower.room[idx(bottom[0][0], bottom[0][1])];
    const upperRoom = upper.room[idx(top[0][0], top[0][1])];
    forRect(spec.rect, (x, z) => {
      const k = idx(x, z);
      for (const [g, fallbackRoom] of [
        [lower, lowerRoom],
        [upper, upperRoom],
      ] as const) {
        g.type[k] = CT.STAIR;
        g.ent[k] = i;
        if (g.room[k] < 0) g.room[k] = fallbackRoom;
      }
    });
    for (const [x, z] of [...sides, ...bottom]) {
      if (!inBounds(x, z)) continue;
      const k = idx(x, z);
      if (upper.type[k] === CT.FLOOR) upper.type[k] = CT.RAIL;
    }
    return { index: i, spec };
  });

  // ladders
  const ladders: Ladder[] = Lay.LADDERS.map((spec, i) => ({
    index: i,
    spec,
    pa: [spec.a.x + 0.5, floorBase(spec.a.f), spec.a.z + 0.5],
    pb: [spec.b.x + 0.5, floorBase(spec.b.f), spec.b.z + 0.5],
  }));

  // mechanisms
  const mechById = new Map<string, number>();
  const mechs: Mech[] = Lay.MECHS.map((spec, i) => {
    mechById.set(spec.id, i);
    return { index: i, spec, room: floors[spec.f].room[idx(spec.access[0], spec.access[1])] };
  });

  // windows (computed before furniture so wall pieces never cover them)
  for (const fi of [2, 3]) {
    const g = floors[fi];
    for (let z = 1; z < D - 1; z++)
      for (let x = 1; x < W - 1; x++) {
        const k = idx(x, z);
        if (g.type[k] !== CT.SOLID || SOLID_STYLES[g.style[k]] !== 'facade') continue;
        const interior = (kk: number) => g.type[kk] === CT.FLOOR && g.room[kk] >= 0 && Lay.ROOMS[g.room[kk]].zone === 'mansion';
        const exterior = (kk: number) => g.type[kk] === CT.OUTDOOR || (g.type[kk] === CT.VOID && g.room[kk] < 0);
        const n = idx(x, z - 1);
        const s = idx(x, z + 1);
        const wv = idx(x - 1, z);
        const e = idx(x + 1, z);
        const alongX = (interior(n) && exterior(s)) || (interior(s) && exterior(n));
        const alongZ = (interior(wv) && exterior(e)) || (interior(e) && exterior(wv));
        const roomIn = alongX ? (interior(n) ? g.room[n] : g.room[s]) : alongZ ? (interior(wv) ? g.room[wv] : g.room[e]) : -1;
        if (roomIn < 0) continue;
        const nearDoor = [idx(x - 1, z), idx(x + 1, z), idx(x, z - 1), idx(x, z + 1)].some((kk) => g.type[kk] === CT.DOOR);
        if (nearDoor) continue;
        const conservatory = Lay.ROOMS[roomIn].id === 'conservatory';
        if (conservatory || (alongX ? x % 3 === 1 : z % 3 === 1)) g.flags[k] |= F.WINDOW;
      }
  }


  // ---------------------------------------------------------------------------
  // Furniture
  // ---------------------------------------------------------------------------
  const reserved = floors.map(() => new Uint8Array(W * D));
  const reserve = (f: number, x: number, z: number) => inBounds(x, z) && (reserved[f][idx(x, z)] = 1);
  for (const r of Lay.RESERVED_RECTS) forRect(r.rect, (x, z) => reserve(r.f, x, z));
  for (const r of Lay.WEAK_RECTS) forRect(r.rect, (x, z) => reserve(r.f, x, z));
  for (const m of Lay.MECHS) reserve(m.f, m.access[0], m.access[1]);
  for (const l of Lay.LADDERS) {
    reserve(l.a.f, l.a.x, l.a.z);
    reserve(l.b.f, l.b.x, l.b.z);
  }
  for (const p of Lay.PLAYER_STARTS) reserve(3, Math.floor(p[0]), Math.floor(p[2]));
  reserve(1, Math.floor(Lay.ENEMY_START[0]), Math.floor(Lay.ENEMY_START[2]));
  forRect(Lay.CAGE_RECT, (x, z) => reserve(1, x, z));

  const furniture: Furniture[] = [];
  const hides: HideSpot[] = [];
  const containers: Container[] = [];

  const dims = (t: string, rot: number) => {
    const s = furnSpec(t);
    return rot % 2 === 0 ? { w: s.w, d: s.d } : { w: s.d, d: s.w };
  };
  const frontCell = (x: number, z: number, w: number, d: number, rot: number): [number, number] => {
    switch (rot) {
      case 0:
        return [x + Math.floor((w - 1) / 2), z + d];
      case 1:
        return [x + w, z + Math.floor((d - 1) / 2)];
      case 2:
        return [x + Math.floor((w - 1) / 2), z - 1];
      default:
        return [x - 1, z + Math.floor((d - 1) / 2)];
    }
  };

  const commitFurniture = (t: string, f: number, x: number, z: number, rot: 0 | 1 | 2 | 3): Furniture => {
    const g = floors[f];
    const s = furnSpec(t);
    const { w, d } = dims(t, rot);
    const fi = furniture.length;
    for (let zz = z; zz < z + d; zz++)
      for (let xx = x; xx < x + w; xx++) {
        const k = idx(xx, zz);
        if (s.block !== false) g.flags[k] |= F.FURN;
        if (s.tall) g.flags[k] |= F.TALL;
        g.furn[k] = fi;
      }
    const room = g.room[idx(x, z)];
    const fur: Furniture = {
      index: fi,
      t,
      f,
      x,
      z,
      w,
      d,
      rot,
      room,
      center: [x + w / 2, g.base, z + d / 2],
      front: frontCell(x, z, w, d, rot),
    };
    furniture.push(fur);
    const [fx, fz] = FRONT_OF_ROT[rot];
    if (s.hide) {
      const hi = hides.length;
      const ex = fur.front[0] + 0.5;
      const ez = fur.front[1] + 0.5;
      hides.push({
        index: hi,
        kind: s.hide,
        furn: fi,
        f,
        inside: [fur.center[0] - fx * 0.1, g.base, fur.center[2] - fz * 0.1],
        exit: [ex, g.base, ez],
        yaw: YAW_OF_ROT[rot],
        room,
      });
      fur.hide = hi;
    }
    if (s.container) {
      const ci = containers.length;
      containers.push({ index: ci, kind: s.container.kind, furn: fi, f, pos: [fur.center[0] + fx * (d * 0.25), g.base + s.h * 0.5, fur.center[2] + fz * (d * 0.25)], room });
      fur.container = ci;
    }
    return fur;
  };

  for (const p of Lay.PLACES) {
    const fur = commitFurniture(p.t, p.f, p.x, p.z, p.rot);
    reserve(p.f, fur.front[0], fur.front[1]);
  }

  const levelRng = new Rng(hashString('nower-estate-v1'));

  // Auto-furnish each room while guaranteeing that every doorway, stair, ladder, mechanism and
  // piece of interactive furniture stays reachable inside the room.
  Lay.ROOMS.forEach((spec, ri) => {
    const list = spec.furnish ?? [];
    if (!list.length) return;
    const g = floors[spec.f];
    const res = reserved[spec.f];
    const cells: number[] = [];
    for (let k = 0; k < W * D; k++) if (g.room[k] === ri && (g.type[k] === CT.FLOOR || g.type[k] === CT.OUTDOOR)) cells.push(k);
    const isPortal = new Uint8Array(W * D);
    const targets: number[] = [];
    for (const k of cells) {
      const x = k % W;
      const z = (k / W) | 0;
      let portal = false;
      for (const [dx, dz] of FRONT_OF_ROT) {
        const nx = x + dx;
        const nz = z + dz;
        if (!inBounds(nx, nz)) continue;
        const nk = idx(nx, nz);
        const t = g.type[nk];
        if (t === CT.DOOR || t === CT.STAIR || ((t === CT.FLOOR || t === CT.OUTDOOR || t === CT.WATER) && g.room[nk] !== ri)) portal = true;
      }
      if (portal) {
        isPortal[k] = 1;
        targets.push(k);
      } else if (res[k] && !(g.flags[k] & F.FURN)) targets.push(k);
      if (g.furn[k] >= 0) {
        const fu = furniture[g.furn[k]];
        const fk = idx(fu.front[0], fu.front[1]);
        if (g.room[fk] === ri) targets.push(fk);
      }
    }
    const traversable = (k: number) => {
      const t = g.type[k];
      if (t === CT.DOOR) return true;
      return g.room[k] === ri && (t === CT.FLOOR || t === CT.OUTDOOR) && !(g.flags[k] & F.FURN);
    };
    const components = () => {
      const label = new Int32Array(W * D).fill(-1);
      let n = 0;
      const seen = new Set<number>();
      for (const t0 of targets) {
        if (label[t0] >= 0) {
          seen.add(label[t0]);
          continue;
        }
        if (!traversable(t0)) return Infinity;
        const q = [t0];
        label[t0] = n;
        while (q.length) {
          const k = q.pop()!;
          const x = k % W;
          const z = (k / W) | 0;
          for (const [dx, dz] of FRONT_OF_ROT) {
            const nx = x + dx;
            const nz = z + dz;
            if (!inBounds(nx, nz)) continue;
            const nk = idx(nx, nz);
            if (label[nk] < 0 && traversable(nk)) {
              label[nk] = n;
              q.push(nk);
            }
          }
        }
        seen.add(n);
        n++;
      }
      return seen.size;
    };
    const baseline = components();
    const free = (k: number) =>
      g.room[k] === ri && (g.type[k] === CT.FLOOR || g.type[k] === CT.OUTDOOR) && !(g.flags[k] & (F.FURN | F.SHALLOW)) && !res[k] && !isPortal[k];

    for (const t of list) {
      const s = furnSpec(t);
      const interactive = !!(s.hide || s.container || s.surface);
      const rots: (0 | 1 | 2 | 3)[] = s.wall ? [0, 1, 2, 3] : s.w === s.d ? [0] : [0, 1];
      const cand: [number, number, 0 | 1 | 2 | 3][] = [];
      for (const rot of rots) {
        const { w, d } = dims(t, rot);
        for (const k0 of cells) {
          const x = k0 % W;
          const z = (k0 / W) | 0;
          let ok = true;
          for (let zz = z; zz < z + d && ok; zz++)
            for (let xx = x; xx < x + w && ok; xx++) if (!inBounds(xx, zz) || !free(idx(xx, zz))) ok = false;
          if (!ok) continue;
          if (s.wall) {
            const [fx, fz] = FRONT_OF_ROT[rot];
            const backs: [number, number][] = [];
            if (fz !== 0) for (let xx = x; xx < x + w; xx++) backs.push([xx, fz > 0 ? z - 1 : z + d]);
            else for (let zz = z; zz < z + d; zz++) backs.push([fx > 0 ? x - 1 : x + w, zz]);
            for (const [bx, bz] of backs) if (!inBounds(bx, bz) || g.type[idx(bx, bz)] !== CT.SOLID || g.flags[idx(bx, bz)] & F.WINDOW) ok = false;
          }
          if (!ok) continue;
          if (interactive) {
            const [fx, fz] = frontCell(x, z, w, d, rot);
            if (!inBounds(fx, fz)) continue;
            const fk = idx(fx, fz);
            if (g.room[fk] !== ri || !(g.type[fk] === CT.FLOOR || g.type[fk] === CT.OUTDOOR) || g.flags[fk] & F.FURN) continue;
          }
          cand.push([x, z, rot]);
        }
      }
      levelRng.shuffle(cand);
      let placed = false;
      for (let a = 0; a < Math.min(cand.length, 45) && !placed; a++) {
        const [x, z, rot] = cand[a];
        const { w, d } = dims(t, rot);
        const keys: number[] = [];
        for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) keys.push(idx(xx, zz));
        for (const k of keys) g.flags[k] |= F.FURN;
        let fk = -1;
        if (interactive) {
          const fc = frontCell(x, z, w, d, rot);
          fk = idx(fc[0], fc[1]);
          targets.push(fk);
        }
        const ok = components() <= baseline;
        for (const k of keys) g.flags[k] &= ~F.FURN;
        if (!ok) {
          if (fk >= 0) targets.pop();
          continue;
        }
        commitFurniture(t, spec.f, x, z, rot);
        if (fk >= 0) res[fk] = 1;
        placed = true;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Spawn points
  // ---------------------------------------------------------------------------
  const spawns: SpawnPoint[] = [];
  const roomOk = (ri: number) => ri >= 0 && !Lay.ROOMS[ri].noSpawn && !Lay.ROOMS[ri].escape;
  for (const fu of furniture) {
    const s = furnSpec(fu.t);
    if (!roomOk(fu.room)) continue;
    const base = floors[fu.f].base;
    const alongX = fu.rot % 2 === 0;
    const len = alongX ? fu.w : fu.d;
    const [fx, fz] = FRONT_OF_ROT[fu.rot];
    if (s.surface && s.slots) {
      for (let i = 0; i < s.slots; i++) {
        const t = ((i + 0.5) / s.slots - 0.5) * len * 0.8;
        const px = fu.center[0] + (alongX ? t : 0) + fx * 0.08;
        const pz = fu.center[2] + (alongX ? 0 : t) + fz * 0.08;
        spawns.push({ index: spawns.length, f: fu.f, pos: [px, base + s.surface + 0.01, pz], room: fu.room, cats: ['small', 'medium'], container: -1, access: fu.front });
      }
    }
    if (s.container && fu.container !== undefined) {
      for (let i = 0; i < s.container.slots; i++) {
        const t = ((i + 0.5) / s.container.slots - 0.5) * len * 0.6;
        const px = fu.center[0] + (alongX ? t : 0) + fx * 0.1;
        const pz = fu.center[2] + (alongX ? 0 : t) + fz * 0.1;
        const h = s.container.kind === 'fridge' ? 1.0 : Math.min(0.45, s.h * 0.45);
        spawns.push({
          index: spawns.length,
          f: fu.f,
          pos: [px, base + h, pz],
          room: fu.room,
          cats: s.container.big ? ['small', 'medium'] : ['small'],
          container: fu.container,
          access: fu.front,
        });
      }
    }
  }
  Lay.ROOMS.forEach((spec, ri) => {
    const n = spec.floorSpawns ?? 0;
    if (!n || !roomOk(ri)) return;
    const g = floors[spec.f];
    const res = reserved[spec.f];
    const rng = new Rng(hashString('floorspawn-' + spec.id));
    const cand: number[] = [];
    for (let k = 0; k < W * D; k++) {
      if (g.room[k] !== ri || !(g.type[k] === CT.FLOOR || g.type[k] === CT.OUTDOOR) || g.flags[k] & (F.FURN | F.SHALLOW) || res[k]) continue;
      const x = k % W;
      const z = (k / W) | 0;
      let nearWall = false;
      let blocked = false;
      for (const [dx, dz] of FRONT_OF_ROT) {
        const nk = idx(x + dx, z + dz);
        if (g.type[nk] === CT.SOLID || g.flags[nk] & F.FURN) nearWall = true;
        if (g.type[nk] === CT.DOOR || g.type[nk] === CT.STAIR) blocked = true;
      }
      if (nearWall && !blocked) cand.push(k);
    }
    rng.shuffle(cand);
    for (const k of cand.slice(0, n)) {
      res[k] = 1;
      const x = k % W;
      const z = (k / W) | 0;
      spawns.push({ index: spawns.length, f: spec.f, pos: [x + 0.5, g.base, z + 0.5], room: ri, cats: ['heavy', 'medium'], container: -1, access: [x, z] });
    }
  });

  // notes take one surface spawn in their room
  const notes: NotePlaced[] = [];
  for (const spec of Lay.NOTES) {
    const ri = roomById.get(spec.room)!;
    let si = spawns.findIndex((s) => s.room === ri && s.container < 0 && s.cats.includes('small'));
    let pos: [number, number, number];
    let f = Lay.ROOMS[ri].f;
    if (si >= 0) {
      pos = spawns[si].pos;
      f = spawns[si].f;
      spawns.splice(si, 1);
    } else {
      const g = floors[f];
      let k = -1;
      for (let kk = 0; kk < W * D; kk++)
        if (g.room[kk] === ri && (g.type[kk] === CT.FLOOR || g.type[kk] === CT.OUTDOOR) && !(g.flags[kk] & F.FURN) && !reserved[f][kk]) {
          k = kk;
          if (levelRng.chance(0.08)) break;
        }
      pos = [(k % W) + 0.5, g.base, ((k / W) | 0) + 0.5];
    }
    notes.push({ index: notes.length, spec, f, pos, room: ri });
  }
  spawns.forEach((s, i) => (s.index = i));

  // ---------------------------------------------------------------------------
  // Creaky boards and windows
  // ---------------------------------------------------------------------------
  const creakRng = new Rng(hashString('creaks'));
  for (const g of floors) {
    for (let k = 0; k < W * D; k++) {
      const ri = g.room[k];
      if (ri < 0 || g.type[k] !== CT.FLOOR || g.flags[k] & F.FURN) continue;
      const mat = Lay.ROOMS[ri].floor;
      if ((mat.startsWith('wood') || mat === 'parquet' || mat === 'attic_boards') && creakRng.chance(0.07)) g.flags[k] |= F.CREAKY;
    }
  }
  // ---------------------------------------------------------------------------
  // Lights
  // ---------------------------------------------------------------------------
  const lights: LightDef[] = [];
  const lightRng = new Rng(hashString('lights'));
  Lay.ROOMS.forEach((spec, ri) => {
    const kind = spec.light ?? 'none';
    if (kind === 'none') return;
    const g = floors[spec.f];
    const on = () => lightRng.chance(spec.lightOn ?? 0.6);
    const r = spec.rects[0];
    const cx = (r[0] + r[2] + 1) / 2;
    const cz = (r[1] + r[3] + 1) / 2;
    const area = (r[2] - r[0] + 1) * (r[3] - r[1] + 1);
    const ceilY = (x: number, z: number) => {
      const up = floors[spec.f + 1];
      if (up && up.type[idx(Math.floor(x), Math.floor(z))] === CT.VOID && up.room[idx(Math.floor(x), Math.floor(z))] === ri) return up.base + up.ceilH;
      return g.base + g.ceilH;
    };
    const push = (x: number, y: number, z: number, color: number, intensity: number, range: number) => {
      const isOn = on();
      lights.push({ f: spec.f, pos: [x, y, z], kind, color, intensity, range, on: isOn, flicker: isOn && lightRng.chance(0.3) ? lightRng.range(0.3, 1) : 0, room: ri });
    };
    const grid = (spacing: number, color: number, intensity: number, range: number, drop: number) => {
      const nx = Math.max(1, Math.round((r[2] - r[0] + 1) / spacing));
      const nz = Math.max(1, Math.round((r[3] - r[1] + 1) / spacing));
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) {
          const x = r[0] + ((i + 0.5) * (r[2] - r[0] + 1)) / nx;
          const z = r[1] + ((j + 0.5) * (r[3] - r[1] + 1)) / nz;
          const k = idx(Math.floor(x), Math.floor(z));
          if (g.type[k] === CT.SOLID) continue;
          push(x, ceilY(x, z) - drop, z, color, intensity, range);
        }
    };
    switch (kind) {
      case 'chandelier':
        push(cx, ceilY(cx, cz) - 1.0, cz, 0xffb066, 1.0, 16);
        break;
      case 'lamp':
        push(cx, g.base + g.ceilH - 0.5, cz, 0xffc489, 0.75, 11);
        break;
      case 'bulbs':
        grid(area > 60 ? 7 : 9, 0xffd29a, 0.6, 9, 0.45);
        break;
      case 'fluoro':
        grid(8, 0xd8f0ff, 0.75, 10, 0.1);
        break;
      case 'sewer':
        grid(9, 0x9fd6a8, 0.55, 9, 0.6);
        break;
      case 'lantern':
        push(cx, g.base + 2.2, r[1] + 1.2, 0xffa050, 0.7, 10);
        break;
      case 'sconces': {
        // wall lamps along both long walls of every rect
        for (const rr of spec.rects) {
          const lenX = rr[2] - rr[0] + 1;
          const lenZ = rr[3] - rr[1] + 1;
          if (Math.max(lenX, lenZ) < 4) continue;
          const alongX = lenX >= lenZ;
          const n = Math.max(1, Math.round(Math.max(lenX, lenZ) / 9));
          for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n;
            if (alongX) push(rr[0] + t * lenX, g.base + 2.3, rr[1] + 0.12, 0xffa65c, 0.5, 8);
            else push(rr[0] + 0.12, g.base + 2.3, rr[1] + t * lenZ, 0xffa65c, 0.5, 8);
          }
        }
        break;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Rooms, traps, patrol points
  // ---------------------------------------------------------------------------
  const rooms: Room[] = Lay.ROOMS.map((spec, ri) => {
    const g = floors[spec.f];
    let n = 0;
    let sx = 0;
    let sz = 0;
    for (let k = 0; k < W * D; k++)
      if (g.room[k] === ri && g.type[k] !== CT.VOID) {
        n++;
        sx += (k % W) + 0.5;
        sz += ((k / W) | 0) + 0.5;
      }
    const lit = lights.some((l) => l.room === ri && l.on);
    return { index: ri, spec, cells: n, center: [sx / Math.max(1, n), g.base, sz / Math.max(1, n)], bright: spec.outdoor ? 0.7 : lit ? 1 : 0.45 };
  });

  const trapCandidates: { f: number; x: number; z: number }[] = [];
  const patrolPoints: { f: number; x: number; z: number; room: number }[] = [];
  const startRoom = roomById.get('westbed')!;
  for (const g of floors) {
    for (let z = 1; z < D - 1; z++)
      for (let x = 1; x < W - 1; x++) {
        const k = idx(x, z);
        const ri = g.room[k];
        if (ri < 0 || ri === startRoom || !(g.type[k] === CT.FLOOR || g.type[k] === CT.OUTDOOR)) continue;
        const spec = Lay.ROOMS[ri];
        if (spec.escape || spec.noSpawn || spec.zone === 'yard') continue;
        if (g.flags[k] & (F.FURN | F.SHALLOW) || reserved[g.index][k]) continue;
        let open = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const nk = idx(x + dx, z + dz);
            if ((g.type[nk] === CT.FLOOR || g.type[nk] === CT.OUTDOOR) && !(g.flags[nk] & F.FURN) && g.room[nk] === ri) open++;
          }
        if (open === 9 && (x * 7 + z * 13) % 5 === 0) trapCandidates.push({ f: g.index, x, z });
      }
  }
  rooms.forEach((room, ri) => {
    const spec = room.spec;
    if (spec.noPatrol || spec.escape || spec.zone === 'yard') return;
    const g = floors[spec.f];
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < W * D; k++) {
      if (g.room[k] !== ri || !(g.type[k] === CT.FLOOR || g.type[k] === CT.OUTDOOR) || g.flags[k] & F.FURN) continue;
      const dx = (k % W) + 0.5 - room.center[0];
      const dz = ((k / W) | 0) + 0.5 - room.center[2];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        best = k;
      }
    }
    if (best >= 0) patrolPoints.push({ f: spec.f, x: best % W, z: (best / W) | 0, room: ri });
  });

  const cageCells: { f: number; x: number; z: number }[] = [];
  forRect(Lay.CAGE_RECT, (x, z) => cageCells.push({ f: 1, x, z }));

  return {
    W,
    D,
    floors,
    rooms,
    roomById,
    doors,
    doorById,
    stairs,
    ladders,
    furniture,
    hides,
    containers,
    spawns,
    lights,
    notes,
    mechs,
    mechById,
    water,
    trapCandidates,
    playerStarts: Lay.PLAYER_STARTS,
    enemyStart: Lay.ENEMY_START,
    patrolPoints,
    cageCells,
    cageDoor: doorById.get('cage_door')!,
    carStart: Lay.CAR_START,
  };
}

export const FLOOR_H = FLOOR_HEIGHT;
