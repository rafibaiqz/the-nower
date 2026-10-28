/**
 * Sound propagation model used by the Nower's hearing.
 *
 * A bounded Dijkstra flood from the listener over the stacked cell grids produces an
 * "effective distance" field. Open air costs 1 per metre (less in echoing sewers), closed
 * doors add a heavy penalty, solid walls cost much more per metre, and floor slabs are
 * expensive except through stairwells and the open hall. A sound event is audible when its
 * intensity (audible range in effective metres) times the hearing multiplier reaches the
 * listener's field value at the event's cell. Sound therefore bends around corners through
 * open doors, is muffled by walls, and does not carry through the whole house.
 */
import { FLOOR_COUNT } from '../constants';
import { MinHeap } from './heap';
import type { DynWorld } from './grid';
import { CT, type Level } from './types';

export const SOUND_COST = {
  open: 1,
  sewer: 0.72,
  closedDoor: 7,
  wall: 9,
  slab: 14,
  openVertical: 1.5,
};

/** Design intensities: audible range in effective metres at normal hearing. */
export const NOISE = {
  crouch: 2.2,
  walk: 6.5,
  sprint: 15,
  creak: 19,
  creakCrouch: 6,
  weakBoard: 26,
  landWater: 9,
  dropLight: 9,
  dropMetal: 22,
  dropHeavy: 28,
  dropGlass: 30,
  doorOpen: 6,
  doorRusty: 13,
  doorSlam: 30,
  doorRattle: 7,
  drawer: 4,
  glassBreak: 32,
  machine: 26,
  install: 10,
  crank: 22,
  lockpick: 7,
  carRepair: 14,
  carStart: 75,
  carEngine: 30,
  generator: 36,
  trapSnare: 24,
  trapCans: 28,
  trapBell: 34,
  alarm: 60,
  pump: 30,
  floodgate: 45,
  shutter: 34,
  grate: 24,
  decoy: 26,
  breathing: 3.5,
  gasp: 9,
  cageRattle: 12,
  ladder: 6,
  voice: 0,
} as const;

export class SoundField {
  readonly plane: number;
  readonly dist: Float64Array;
  private heap = new MinHeap(16384);
  private touched: number[] = [];

  constructor(private level: Level) {
    this.plane = level.W * level.D;
    this.dist = new Float64Array(this.plane * FLOOR_COUNT).fill(Infinity);
  }

  private cost(dyn: DynWorld, f: number, k: number): number {
    const g = this.level.floors[f];
    const t = g.type[k];
    const zoneSewer = f === 0;
    switch (t) {
      case CT.SOLID:
        return SOUND_COST.wall;
      case CT.DOOR:
        return dyn.doorOpen(g.ent[k]) ? SOUND_COST.open : SOUND_COST.closedDoor;
      default:
        return zoneSewer ? SOUND_COST.sewer : SOUND_COST.open;
    }
  }

  /** Floods from a listener cell. Cells beyond maxCost stay Infinity. */
  compute(dyn: DynWorld, f: number, x: number, z: number, maxCost = 90) {
    const L = this.level;
    const W = L.W;
    for (const n of this.touched) this.dist[n] = Infinity;
    this.touched.length = 0;
    const heap = this.heap;
    heap.clear();
    const start = f * this.plane + z * W + x;
    if (x < 0 || z < 0 || x >= W || z >= L.D) return;
    this.dist[start] = 0;
    this.touched.push(start);
    heap.push(start, 0);
    while (heap.size) {
      const d0 = heap.peekKey();
      const cur = heap.pop();
      if (d0 > this.dist[cur]) continue;
      if (d0 > maxCost) break;
      const cf = (cur / this.plane) | 0;
      const k = cur % this.plane;
      const cx = k % W;
      const cz = (k / W) | 0;
      const g = L.floors[cf];
      const curSolid = g.type[k] === CT.SOLID;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= L.D) continue;
          const nk = nz * W + nx;
          const len = dx && dz ? Math.SQRT2 : 1;
          let c = this.cost(dyn, cf, nk);
          if (curSolid && c < SOUND_COST.wall) c = Math.max(c, 1.2);
          const nd = d0 + len * c;
          const ni = cf * this.plane + nk;
          if (nd < this.dist[ni]) {
            if (this.dist[ni] === Infinity) this.touched.push(ni);
            this.dist[ni] = nd;
            heap.push(ni, nd);
          }
        }
      // vertical neighbours
      for (const nf of [cf - 1, cf + 1]) {
        if (nf < 0 || nf >= FLOOR_COUNT) continue;
        const ng = L.floors[nf];
        const t1 = g.type[k];
        const t2 = ng.type[k];
        if (t1 === CT.SOLID || t2 === CT.SOLID) continue;
        const upper = nf > cf ? ng : g;
        const ut = upper.type[k];
        const open = ut === CT.STAIR || (ut === CT.VOID && upper.room[k] >= 0) || (ut === CT.VOID && (t1 === CT.OUTDOOR || t2 === CT.OUTDOOR));
        const nd = d0 + (open ? SOUND_COST.openVertical : SOUND_COST.slab);
        const ni = nf * this.plane + k;
        if (nd < this.dist[ni]) {
          if (this.dist[ni] === Infinity) this.touched.push(ni);
          this.dist[ni] = nd;
          heap.push(ni, nd);
        }
      }
    }
  }

  at(f: number, wx: number, wz: number): number {
    const x = Math.floor(wx);
    const z = Math.floor(wz);
    if (f < 0 || f >= FLOOR_COUNT || x < 0 || z < 0 || x >= this.level.W || z >= this.level.D) return Infinity;
    return this.dist[f * this.plane + z * this.level.W + x];
  }
}

/** Fraction of an event's intensity that reaches a listener (0 = inaudible). */
export function audibility(intensity: number, hearingMult: number, effDist: number): number {
  const range = intensity * hearingMult;
  if (!(effDist < range)) return 0;
  return 1 - effDist / range;
}
