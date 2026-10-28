import type { ContainerKind, HideKind } from './types';

/**
 * Gameplay footprint of each furniture type. w/d are cells for rotation 0 (front faces +z).
 * Visual models live in the client and are built to fit these footprints.
 */
export interface FurnSpec {
  w: number;
  d: number;
  h: number;
  block?: boolean; // default true
  tall?: boolean;
  wall?: boolean; // must stand with its back against a wall
  surface?: number; // height of a surface items can rest on
  slots?: number;
  container?: { kind: ContainerKind; slots: number; big?: boolean };
  hide?: HideKind;
  outdoor?: boolean;
}

export const FURN: Record<string, FurnSpec> = {
  bed: { w: 2, d: 2, h: 0.65, wall: true, hide: 'bed' },
  wardrobe: { w: 2, d: 1, h: 2.2, tall: true, wall: true, hide: 'wardrobe' },
  locker: { w: 1, d: 1, h: 2.0, tall: true, wall: true, hide: 'locker' },
  dresser: { w: 2, d: 1, h: 0.95, wall: true, surface: 0.95, slots: 2, container: { kind: 'drawer', slots: 2 } },
  nightstand: { w: 1, d: 1, h: 0.62, wall: true, surface: 0.62, slots: 1, container: { kind: 'drawer', slots: 1 } },
  desk: { w: 2, d: 1, h: 0.78, wall: true, surface: 0.78, slots: 2, container: { kind: 'drawer', slots: 1 } },
  table: { w: 2, d: 1, h: 0.78, surface: 0.78, slots: 2 },
  bigtable: { w: 4, d: 2, h: 0.78, surface: 0.78, slots: 4 },
  sidetable: { w: 1, d: 1, h: 0.75, wall: true, surface: 0.75, slots: 1 },
  chair: { w: 1, d: 1, h: 1.0 },
  armchair: { w: 1, d: 1, h: 1.05 },
  sofa: { w: 3, d: 1, h: 0.9, wall: true },
  bench: { w: 2, d: 1, h: 0.5 },
  bookshelf: { w: 2, d: 1, h: 2.3, tall: true, wall: true, surface: 0.97, slots: 2 },
  trophycase: { w: 2, d: 1, h: 2.0, tall: true, wall: true },
  fireplace: { w: 3, d: 1, h: 1.45, wall: true, surface: 1.49, slots: 2 },
  piano: { w: 2, d: 2, h: 1.25, wall: true },
  gclock: { w: 1, d: 1, h: 2.25, tall: true, wall: true },
  cabinet: { w: 2, d: 1, h: 0.92, wall: true, surface: 0.92, slots: 2, container: { kind: 'cupboard', slots: 2, big: true } },
  counter: { w: 2, d: 1, h: 0.92, wall: true, surface: 0.92, slots: 2, container: { kind: 'cupboard', slots: 1, big: true } },
  stove: { w: 1, d: 1, h: 0.95, wall: true, surface: 0.95, slots: 1 },
  fridge: { w: 1, d: 1, h: 1.9, tall: true, wall: true, container: { kind: 'fridge', slots: 1 } },
  sink: { w: 1, d: 1, h: 0.9, wall: true },
  pantryshelf: { w: 2, d: 1, h: 2.1, tall: true, wall: true, surface: 1.12, slots: 3 },
  shelf: { w: 2, d: 1, h: 2.0, tall: true, wall: true, surface: 1.12, slots: 3 },
  crate: { w: 1, d: 1, h: 0.8, surface: 0.8, slots: 1 },
  barrel: { w: 1, d: 1, h: 1.0 },
  workbench: { w: 2, d: 1, h: 0.9, wall: true, surface: 0.9, slots: 3 },
  toolchest: { w: 1, d: 1, h: 1.0, wall: true, container: { kind: 'drawer', slots: 2, big: true } },
  bathtub: { w: 2, d: 1, h: 0.6, wall: true },
  toilet: { w: 1, d: 1, h: 0.8, wall: true },
  vanity: { w: 1, d: 1, h: 0.8, wall: true, surface: 0.8, slots: 1 },
  crib: { w: 2, d: 1, h: 1.0, wall: true },
  toychest: { w: 1, d: 1, h: 0.6, wall: true, container: { kind: 'chest', slots: 1, big: true } },
  rockinghorse: { w: 1, d: 1, h: 0.9 },
  trunk: { w: 2, d: 1, h: 0.7, container: { kind: 'chest', slots: 2, big: true } },
  sheeted: { w: 1, d: 1, h: 1.3 },
  sheeted2: { w: 2, d: 1, h: 1.1 },
  mannequin: { w: 1, d: 1, h: 1.8, tall: true },
  sewingmachine: { w: 1, d: 1, h: 0.85, surface: 0.79, slots: 1 },
  elcabinet: { w: 2, d: 1, h: 2.0, tall: true, wall: true },
  mechpress: { w: 2, d: 2, h: 2.1, tall: true },
  coalpile: { w: 2, d: 2, h: 0.8 },
  tirestack: { w: 1, d: 1, h: 0.9 },
  boiler: { w: 2, d: 2, h: 2.6, tall: true, wall: true },
  generator: { w: 2, d: 2, h: 1.4 },
  pump: { w: 2, d: 2, h: 1.6 },
  niche: { w: 1, d: 1, h: 2.0, tall: true, wall: true, hide: 'niche' },
  plant: { w: 1, d: 1, h: 1.4 },
  tree: { w: 1, d: 1, h: 7, tall: true, outdoor: true },
  deadbush: { w: 1, d: 1, h: 1.1, outdoor: true },
  grave: { w: 1, d: 1, h: 0.9, outdoor: true },
  well: { w: 2, d: 2, h: 1.0, outdoor: true },
  watertank: { w: 2, d: 2, h: 2.8, tall: true, outdoor: true },
  fountain: { w: 3, d: 3, h: 1.3, outdoor: true },
  rubble: { w: 2, d: 1, h: 0.9 },
};

export function furnSpec(t: string): FurnSpec {
  const s = FURN[t];
  if (!s) throw new Error(`Unknown furniture type ${t}`);
  return s;
}
