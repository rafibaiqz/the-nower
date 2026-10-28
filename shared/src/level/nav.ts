/**
 * Enemy navigation: A* over the stacked cell grids. Nodes are (floor, cell). Stairs link the
 * same cell on two floors, ladders link their two ends. Closed doors are traversable at extra
 * cost when the Nower is allowed through them (he opens them on arrival).
 */
import { FLOOR_COUNT } from '../constants';
import { MinHeap } from './heap';
import { stairHeight } from './grid';
import { CT, F, type Level } from './types';

export interface NavWorld {
  doorOpen(door: number): boolean;
  /** Can the enemy pass this door when it is closed? */
  doorPassable(door: number): boolean;
  waterDrained(zone: number): boolean;
  ladderOpen(ladder: number): boolean;
}

export interface NavPoint {
  f: number;
  x: number;
  y: number;
  z: number;
  /** Door index at this waypoint (enemy must open it) or -1. */
  door: number;
  /** Ladder index when this waypoint is reached by climbing, or -1. */
  ladder: number;
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

export class Navigator {
  private readonly n: number;
  private readonly plane: number;
  private g: Float64Array;
  private came: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap = new MinHeap(8192);
  private ladderAt = new Map<number, { ladder: number; other: number }>();

  constructor(private level: Level) {
    this.plane = level.W * level.D;
    this.n = this.plane * FLOOR_COUNT;
    this.g = new Float64Array(this.n);
    this.came = new Int32Array(this.n);
    this.stamp = new Uint32Array(this.n);
    this.closed = new Uint32Array(this.n);
    for (const l of level.ladders) {
      const a = l.spec.a.f * this.plane + l.spec.a.z * level.W + l.spec.a.x;
      const b = l.spec.b.f * this.plane + l.spec.b.z * level.W + l.spec.b.x;
      this.ladderAt.set(a, { ladder: l.index, other: b });
      this.ladderAt.set(b, { ladder: l.index, other: a });
    }
  }

  node(f: number, x: number, z: number): number {
    return f * this.plane + z * this.level.W + x;
  }

  /** Cost multiplier of entering a cell, or -1 when impassable. */
  cellCost(world: NavWorld, f: number, k: number): number {
    const g = this.level.floors[f];
    const t = g.type[k];
    const fl = g.flags[k];
    if (fl & F.FURN) return -1;
    switch (t) {
      case CT.FLOOR:
      case CT.OUTDOOR:
        return fl & F.SHALLOW ? 1.25 : 1;
      case CT.STAIR:
        return 1.1;
      case CT.DOOR: {
        const d = g.ent[k];
        if (world.doorOpen(d)) return 1;
        return world.doorPassable(d) ? 3 : -1;
      }
      case CT.WATER:
        return world.waterDrained(g.ent[k]) ? 1.3 : -1;
      default:
        return -1;
    }
  }

  heightOf(f: number, k: number): number {
    const g = this.level.floors[f];
    if (g.type[k] === CT.STAIR) {
      const x = k % this.level.W;
      const z = (k / this.level.W) | 0;
      return stairHeight(this.level.stairs[g.ent[k]], x + 0.5, z + 0.5);
    }
    return g.base;
  }

  walkable(world: NavWorld, f: number, x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= this.level.W || z >= this.level.D || f < 0 || f >= FLOOR_COUNT) return false;
    return this.cellCost(world, f, z * this.level.W + x) > 0;
  }

  /** Finds a path between two world positions. Returns null when unreachable. */
  findPath(world: NavWorld, sf: number, sx: number, sz: number, tf: number, tx: number, tz: number, maxExpand = 40000): NavPoint[] | null {
    const L = this.level;
    const W = L.W;
    const start = this.snap(world, sf, Math.floor(sx), Math.floor(sz));
    const goal = this.snap(world, tf, Math.floor(tx), Math.floor(tz));
    if (start < 0 || goal < 0) return null;
    const gen = ++this.gen;
    const heap = this.heap;
    heap.clear();
    const gx = goal % this.plane % W;
    const gz = ((goal % this.plane) / W) | 0;
    const gf = (goal / this.plane) | 0;
    const h = (node: number) => {
      const f = (node / this.plane) | 0;
      const k = node % this.plane;
      const dx = Math.abs((k % W) - gx);
      const dz = Math.abs(((k / W) | 0) - gz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz) + Math.abs(f - gf) * 6;
    };
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.came[start] = -1;
    heap.push(start, h(start));
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) return this.reconstruct(world, cur);
      if (++expanded > maxExpand) return null;
      const f = (cur / this.plane) | 0;
      const k = cur % this.plane;
      const x = k % W;
      const z = (k / W) | 0;
      const g0 = this.g[cur];
      const grid = L.floors[f];
      const hc = this.heightOf(f, k);
      const curIsDoor = grid.type[k] === CT.DOOR;
      for (const [dx, dz, len] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= L.D) continue;
        const nk = nz * W + nx;
        const c = this.cellCost(world, f, nk);
        if (c < 0) continue;
        if (dx !== 0 && dz !== 0) {
          if (curIsDoor || grid.type[nk] === CT.DOOR) continue;
          if (this.cellCost(world, f, z * W + nx) < 0 || this.cellCost(world, f, nz * W + x) < 0) continue;
        }
        if (Math.abs(this.heightOf(f, nk) - hc) > 0.62) continue;
        this.relax(cur, f * this.plane + nk, g0 + len * c, gen, h);
      }
      // stairs connect the same cell on adjacent floors
      if (grid.type[k] === CT.STAIR) {
        for (const nf of [f - 1, f + 1]) {
          if (nf < 0 || nf >= FLOOR_COUNT) continue;
          if (L.floors[nf].type[k] === CT.STAIR && L.floors[nf].ent[k] === grid.ent[k]) this.relax(cur, nf * this.plane + k, g0 + 0.01, gen, h);
        }
      }
      const lad = this.ladderAt.get(cur);
      if (lad && world.ladderOpen(lad.ladder)) this.relax(cur, lad.other, g0 + 6, gen, h);
    }
    return null;
  }

  private relax(from: number, to: number, cost: number, gen: number, h: (n: number) => number) {
    if (this.closed[to] === gen) return;
    if (this.stamp[to] !== gen || cost < this.g[to]) {
      this.stamp[to] = gen;
      this.g[to] = cost;
      this.came[to] = from;
      this.heap.push(to, cost + h(to));
    }
  }

  /** Nearest walkable node to a cell (handles targets inside furniture etc.). */
  snap(world: NavWorld, f: number, x: number, z: number): number {
    for (let r = 0; r <= 3; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.walkable(world, f, x + dx, z + dz)) return this.node(f, x + dx, z + dz);
        }
    return -1;
  }

  private reconstruct(world: NavWorld, end: number): NavPoint[] {
    const nodes: number[] = [];
    for (let c = end; c >= 0; c = this.came[c]) nodes.push(c);
    nodes.reverse();
    const W = this.level.W;
    const pts: NavPoint[] = [];
    let prev = -1;
    for (const nd of nodes) {
      const f = (nd / this.plane) | 0;
      const k = nd % this.plane;
      const g = this.level.floors[f];
      const x = (k % W) + 0.5;
      const z = ((k / W) | 0) + 0.5;
      // collapse stair floor-switch duplicates
      if (prev >= 0 && prev % this.plane === k) {
        pts[pts.length - 1].f = f;
        prev = nd;
        continue;
      }
      let ladder = -1;
      if (prev >= 0) {
        const lad = this.ladderAt.get(prev);
        if (lad && lad.other === nd) ladder = lad.ladder;
      }
      pts.push({ f, x, y: this.heightOf(f, k), z, door: g.type[k] === CT.DOOR ? g.ent[k] : -1, ladder });
      prev = nd;
    }
    return this.smooth(world, pts);
  }

  /** Removes intermediate waypoints where a straight walk is clear (keeps doors, stairs, ladders). */
  private smooth(world: NavWorld, pts: NavPoint[]): NavPoint[] {
    if (pts.length <= 2) return pts;
    const out: NavPoint[] = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      for (let cand = Math.min(pts.length - 1, i + 14); cand > i + 1; cand--) {
        if (this.clearRun(world, pts, i, cand)) {
          j = cand;
          break;
        }
      }
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  private clearRun(world: NavWorld, pts: NavPoint[], i: number, j: number): boolean {
    const a = pts[i];
    const b = pts[j];
    if (a.f !== b.f) return false;
    for (let m = i + 1; m <= j; m++) {
      const p = pts[m];
      if (p.door >= 0 || p.ladder >= 0 || p.f !== a.f) return false;
      const k = Math.floor(p.z) * this.level.W + Math.floor(p.x);
      if (this.level.floors[p.f].type[k] === CT.STAIR) return false;
    }
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(dist / 0.25);
    for (let s = 1; s < n; s++) {
      const t = s / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      for (const [ox, oz] of [
        [0.38, 0.38],
        [-0.38, 0.38],
        [0.38, -0.38],
        [-0.38, -0.38],
      ]) {
        const cx = Math.floor(x + ox);
        const cz = Math.floor(z + oz);
        if (!this.walkable(world, a.f, cx, cz)) return false;
        const k = cz * this.level.W + cx;
        const t2 = this.level.floors[a.f].type[k];
        if (t2 === CT.DOOR || t2 === CT.STAIR) return false;
      }
    }
    return true;
  }
}
