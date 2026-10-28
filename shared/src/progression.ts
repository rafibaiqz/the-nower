/**
 * Item randomisation with dependency validation.
 *
 * The walkable world is split into "areas" (connected regions when every door is closed).
 * Doors, the flooded cistern and ladders are edges carrying requirements (items, mechanisms,
 * one-way bolts). A placement is valid when a simulated team, starting from the bedroom and
 * collecting everything it can reach, can complete ALL THREE escape routes. Placement retries
 * with the same seeded RNG until valid, then falls back to a deterministic safe layout.
 */
import { FLOOR_COUNT } from './constants';
import { ITEMS, ROUTE_ITEMS, allItemIds, itemDef } from './items';
import { Rng } from './rng';
import { CT, F, type Level } from './level/types';
import { stairHeight } from './level/grid';

export interface Areas {
  areaOf: Int32Array; // per (floor * plane + cell), -1 if not walkable
  count: number;
  edges: AreaEdge[];
}

export type Requirement =
  | { kind: 'none' }
  | { kind: 'item'; item: string }
  | { kind: 'bolt'; area: number }
  | { kind: 'mech'; mech: string }
  | { kind: 'never' };

export interface AreaEdge {
  a: number;
  b: number;
  req: Requirement;
  label: string;
}

const N4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function computeAreas(level: Level): Areas {
  const W = level.W;
  const plane = W * level.D;
  const areaOf = new Int32Array(plane * FLOOR_COUNT).fill(-1);
  const height = (f: number, k: number) => {
    const g = level.floors[f];
    return g.type[k] === CT.STAIR ? stairHeight(level.stairs[g.ent[k]], (k % W) + 0.5, ((k / W) | 0) + 0.5) : g.base;
  };
  const open = (f: number, k: number) => {
    const g = level.floors[f];
    const t = g.type[k];
    return (t === CT.FLOOR || t === CT.OUTDOOR || t === CT.STAIR) && !(g.flags[k] & F.FURN);
  };
  let count = 0;
  const waterArea = new Map<number, number>();
  for (let f = 0; f < FLOOR_COUNT; f++) {
    for (let k = 0; k < plane; k++) {
      const g = level.floors[f];
      if (areaOf[f * plane + k] >= 0) continue;
      if (g.type[k] === CT.WATER) {
        // each water zone is a single area of its own
        const zone = g.ent[k];
        let a = waterArea.get(zone);
        if (a === undefined) {
          a = count++;
          waterArea.set(zone, a);
        }
        areaOf[f * plane + k] = a;
        continue;
      }
      if (!open(f, k)) continue;
      const a = count++;
      const stack = [f * plane + k];
      areaOf[f * plane + k] = a;
      while (stack.length) {
        const n = stack.pop()!;
        const cf = (n / plane) | 0;
        const ck = n % plane;
        const x = ck % W;
        const z = (ck / W) | 0;
        const h = height(cf, ck);
        for (const [dx, dz] of N4) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= level.D) continue;
          const nk = nz * W + nx;
          const ni = cf * plane + nk;
          if (areaOf[ni] >= 0 || !open(cf, nk)) continue;
          if (Math.abs(height(cf, nk) - h) > 0.62) continue;
          areaOf[ni] = a;
          stack.push(ni);
        }
        if (level.floors[cf].type[ck] === CT.STAIR) {
          for (const nf of [cf - 1, cf + 1]) {
            if (nf < 0 || nf >= FLOOR_COUNT) continue;
            const ni = nf * plane + ck;
            if (areaOf[ni] < 0 && level.floors[nf].type[ck] === CT.STAIR) {
              areaOf[ni] = a;
              stack.push(ni);
            }
          }
        }
      }
    }
  }
  // Water cells that border open cells link to them
  const edges: AreaEdge[] = [];
  const seenWaterLinks = new Set<string>();
  for (const [zone, wa] of waterArea) {
    const spec = level.water[zone].spec;
    const g = level.floors[spec.f];
    for (let k = 0; k < plane; k++) {
      if (g.type[k] !== CT.WATER || g.ent[k] !== zone) continue;
      const x = k % W;
      const z = (k / W) | 0;
      for (const [dx, dz] of N4) {
        const nk = (z + dz) * W + (x + dx);
        const na = areaOf[spec.f * plane + nk];
        if (na >= 0 && na !== wa && g.type[nk] !== CT.DOOR) {
          const key = `${wa}-${na}`;
          if (!seenWaterLinks.has(key)) {
            seenWaterLinks.add(key);
            edges.push({ a: wa, b: na, req: { kind: 'mech', mech: 'pump' }, label: `water:${spec.id}` });
          }
        }
      }
    }
  }
  // Door edges
  for (const d of level.doors) {
    const g = level.floors[d.spec.f];
    const [x, z] = d.spec.cells[0];
    const [ax, az, bx, bz] = d.pass === 'z' ? [x, z - 1, x, z + 1] : [x - 1, z, x + 1, z];
    const aa = areaOf[d.spec.f * plane + az * W + ax];
    const ba = areaOf[d.spec.f * plane + bz * W + bx];
    // a door between a water area and an open area still requires the water to be drained
    if (aa < 0 || ba < 0) continue;
    let req: Requirement = { kind: 'none' };
    const lock = d.spec.lock;
    if (lock?.kind === 'item') req = { kind: 'item', item: lock.item };
    else if (lock?.kind === 'mech') req = { kind: 'mech', mech: lock.mech };
    else if (lock?.kind === 'cage') req = { kind: 'never' };
    else if (lock?.kind === 'bolt') {
      const ri = level.roomById.get(lock.room)!;
      const sideA = g.room[az * W + ax] === ri;
      req = { kind: 'bolt', area: sideA ? aa : ba };
    }
    edges.push({ a: aa, b: ba, req, label: `door:${d.spec.id}` });
  }
  for (const l of level.ladders) {
    const a = areaOf[l.spec.a.f * plane + l.spec.a.z * W + l.spec.a.x];
    const b = areaOf[l.spec.b.f * plane + l.spec.b.z * W + l.spec.b.x];
    if (a < 0 || b < 0) continue;
    edges.push({ a, b, req: l.spec.lockMech ? { kind: 'mech', mech: l.spec.lockMech } : { kind: 'none' }, label: `ladder:${l.spec.id}` });
  }
  return { areaOf, count, edges };
}

export function areaAt(level: Level, areas: Areas, f: number, x: number, z: number): number {
  const plane = level.W * level.D;
  return areas.areaOf[f * plane + Math.floor(z) * level.W + Math.floor(x)];
}

export interface SolveResult {
  ok: boolean;
  routes: { front: boolean; garage: boolean; sewer: boolean };
  reachable: Set<number>;
  collected: Set<string>;
}

/**
 * Simulates progression for an item assignment (item type -> area) and reports which escape
 * routes can be completed.
 */
export function simulate(level: Level, areas: Areas, itemArea: Map<string, number>): SolveResult {
  const plane = level.W * level.D;
  const mechArea = (id: string) => {
    const m = level.mechs[level.mechById.get(id)!];
    return areas.areaOf[m.spec.f * plane + m.spec.access[1] * level.W + m.spec.access[0]];
  };
  const startArea = areaAt(level, areas, 3, level.playerStarts[0][0], level.playerStarts[0][2]);
  const reachable = new Set<number>([startArea]);
  const collected = new Set<string>();
  const mechs = new Set<string>();
  const has = (...items: string[]) => items.every((i) => collected.has(i));
  const at = (id: string) => reachable.has(mechArea(id));
  const carArea = areaAt(level, areas, 2, level.carStart.x, level.carStart.z + 4);

  let changed = true;
  while (changed) {
    changed = false;
    for (const [item, a] of itemArea) {
      if (!collected.has(item) && reachable.has(a)) {
        collected.add(item);
        changed = true;
      }
    }
    const evalMech = (id: string, ok: boolean) => {
      if (ok && !mechs.has(id)) {
        mechs.add(id);
        changed = true;
      }
    };
    evalMech('front_door', has(...ROUTE_ITEMS.front) && at('front_door') && at('security_panel') && at('winch') && at('fuse_box'));
    evalMech('shutter', has('wrench') && at('shutter'));
    evalMech(
      'drive_gate',
      mechs.has('shutter') && has('car_battery', 'ignition_coil', 'starter_relay', 'fuel_canister', 'car_key') && reachable.has(carArea),
    );
    evalMech('pump', has('pump_fuse') && at('pump_panel'));
    evalMech('floodgate', has('valve_handle', 'pressure_gauge', 'floodgate_key') && at('manifold') && at('valve_1') && at('floodgate_box'));
    evalMech('final_grate', has('access_wheel') && at('final_wheel'));
    const grateTop = level.ladders.find((l) => l.spec.lockMech === 'garden_grate')!;
    evalMech(
      'garden_grate',
      has('hydraulic_tool') &&
        (reachable.has(areaAt(level, areas, grateTop.spec.a.f, grateTop.spec.a.x, grateTop.spec.a.z)) ||
          reachable.has(areaAt(level, areas, grateTop.spec.b.f, grateTop.spec.b.x, grateTop.spec.b.z))),
    );
    for (const e of areas.edges) {
      const inA = reachable.has(e.a);
      const inB = reachable.has(e.b);
      if (inA === inB) continue;
      let open = false;
      switch (e.req.kind) {
        case 'none':
          open = true;
          break;
        case 'item':
          open = collected.has(e.req.item);
          break;
        case 'mech':
          open = mechs.has(e.req.mech);
          break;
        case 'bolt':
          open = reachable.has(e.req.area);
          break;
      }
      if (open) {
        reachable.add(inA ? e.b : e.a);
        changed = true;
      }
    }
  }
  const routes = { front: mechs.has('front_door'), garage: mechs.has('drive_gate'), sewer: mechs.has('final_grate') };
  return { ok: routes.front && routes.garage && routes.sewer, routes, reachable, collected };
}

export interface PuzzleSetup {
  code: string;
  panelSymbols: string[];
  cipher: { symbol: string; digit: number }[];
  valveWeights: number[];
  valveTarget: number;
  valveStart: boolean[];
}

export const CIPHER_GLYPHS = ['☽', '✶', '♄', '☿', '✠', '♆', '☉', '⚘', '◬', '⌘'];

export function makePuzzles(seed: number): PuzzleSetup {
  const rng = new Rng(seed ^ 0x5a5a5a5a);
  const glyphs = rng.shuffle([...CIPHER_GLYPHS]);
  const cipher = glyphs.map((symbol, digit) => ({ symbol, digit }));
  rng.shuffle(cipher);
  const digits = Array.from({ length: 4 }, () => rng.int(0, 9));
  const code = digits.join('');
  const panelSymbols = digits.map((d) => cipher.find((c) => c.digit === d)!.symbol);
  let weights: number[] = [];
  for (;;) {
    weights = [rng.int(1, 9), rng.int(1, 9), rng.int(1, 9)];
    const sums = new Set<number>();
    for (let m = 0; m < 8; m++) sums.add((m & 1 ? weights[0] : 0) + (m & 2 ? weights[1] : 0) + (m & 4 ? weights[2] : 0));
    if (sums.size === 8) break;
  }
  const mask = rng.int(1, 6);
  const target = (mask & 1 ? weights[0] : 0) + (mask & 2 ? weights[1] : 0) + (mask & 4 ? weights[2] : 0);
  let startMask = rng.int(0, 7);
  if (startMask === mask) startMask = (startMask + 3) % 8;
  return { code, panelSymbols, cipher, valveWeights: weights, valveTarget: target, valveStart: [!!(startMask & 1), !!(startMask & 2), !!(startMask & 4)] };
}

export interface ItemPlacement {
  /** item instance id -> spawn index */
  spawnOf: Map<string, number>;
  attempts: number;
  fallback: boolean;
}

const LOCKED_ROOMS = ['library', 'storage', 'clockroom'];

/** Seeded, dependency-validated item placement. */
export function placeItems(level: Level, areas: Areas, seed: number): ItemPlacement {
  const rng = new Rng(seed);
  const items = allItemIds();
  const critical = new Set(ITEMS.filter((d) => d.route !== 'tool').map((d) => d.type));
  const plane = level.W * level.D;
  const spawnArea = level.spawns.map((s) => areas.areaOf[s.f * plane + s.access[1] * level.W + s.access[0]]);
  const candidatesFor = (type: string) => {
    const def = itemDef(type);
    return level.spawns.filter((s) => {
      if (spawnArea[s.index] < 0) return false;
      const room = level.rooms[s.room];
      return s.cats.includes(def.cat) && def.zones.includes(room.spec.zone);
    });
  };
  const cand = new Map(items.map((it) => [it.type, candidatesFor(it.type)]));
  const order = [...items].sort((a, b) => Number(critical.has(b.type)) - Number(critical.has(a.type)));

  for (let attempt = 1; attempt <= 400; attempt++) {
    const used = new Set<number>();
    const perRoom = new Map<number, number>();
    const spawnOf = new Map<string, number>();
    let failed = false;
    for (const it of order) {
      const list = cand.get(it.type)!.filter((s) => !used.has(s.index) && (!critical.has(it.type) || (perRoom.get(s.room) ?? 0) < 2));
      if (!list.length) {
        failed = true;
        break;
      }
      const s = rng.pick(list);
      used.add(s.index);
      spawnOf.set(it.id, s.index);
      if (critical.has(it.type)) perRoom.set(s.room, (perRoom.get(s.room) ?? 0) + 1);
    }
    if (failed) continue;
    if (attempt < 300) {
      // every locked room should reward its key
      const lockedOk = LOCKED_ROOMS.every((rid) => {
        const ri = level.roomById.get(rid)!;
        return [...spawnOf].some(([id, si]) => critical.has(id) && level.spawns[si].room === ri);
      });
      if (!lockedOk) continue;
    }
    const itemArea = new Map<string, number>();
    for (const [id, si] of spawnOf) if (critical.has(id)) itemArea.set(id, spawnArea[si]);
    if (simulate(level, areas, itemArea).ok) return { spawnOf, attempts: attempt, fallback: false };
  }
  // Deterministic fallback: everything in areas reachable without any requirement.
  const free = simulate(level, areas, new Map()).reachable;
  const used = new Set<number>();
  const spawnOf = new Map<string, number>();
  for (const it of order) {
    const s = cand.get(it.type)!.find((sp) => !used.has(sp.index) && free.has(spawnArea[sp.index])) ?? cand.get(it.type)!.find((sp) => !used.has(sp.index))!;
    used.add(s.index);
    spawnOf.set(it.id, s.index);
  }
  return { spawnOf, attempts: 401, fallback: true };
}
