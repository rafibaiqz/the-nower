import { describe, expect, it } from 'vitest';
import { ITEMS, ROUTE_ITEMS, computeAreas, getLevel, itemDef, makePuzzles, placeItems, simulate } from '../src/index';

const level = getLevel();
const areas = computeAreas(level);
const plane = level.W * level.D;

describe('item randomisation', () => {
  it('produces a fully solvable layout for 300 seeds without fallback', () => {
    for (let s = 1; s <= 300; s++) {
      const p = placeItems(level, areas, s * 2654435761);
      expect(p.fallback).toBe(false);
      const itemArea = new Map<string, number>();
      for (const [id, si] of p.spawnOf) {
        const sp = level.spawns[si];
        if (itemDef(id.split('#')[0]).route !== 'tool') itemArea.set(id, areas.areaOf[sp.f * plane + sp.access[1] * level.W + sp.access[0]]);
      }
      const r = simulate(level, areas, itemArea);
      expect(r.routes).toEqual({ front: true, garage: true, sewer: true });
    }
  });

  it('never duplicates spawn points and respects categories and zones', () => {
    const p = placeItems(level, areas, 99);
    const used = new Set<number>();
    for (const [id, si] of p.spawnOf) {
      expect(used.has(si)).toBe(false);
      used.add(si);
      const def = itemDef(id.split('#')[0]);
      const sp = level.spawns[si];
      expect(sp.cats).toContain(def.cat);
      expect(def.zones).toContain(level.rooms[sp.room].spec.zone);
      expect(level.rooms[sp.room].spec.escape).toBeUndefined();
      expect(level.rooms[sp.room].spec.id).not.toBe('holding');
    }
    expect(p.spawnOf.size).toBe(ITEMS.reduce((n, d) => n + d.count, 0));
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const a = placeItems(level, areas, 1234);
    const b = placeItems(level, areas, 1234);
    const c = placeItems(level, areas, 4321);
    expect([...a.spawnOf]).toEqual([...b.spawnOf]);
    expect([...a.spawnOf]).not.toEqual([...c.spawnOf]);
  });

  it('detects unsolvable layouts', () => {
    // put the library key inside the library: the library becomes unreachable
    const p = placeItems(level, areas, 7);
    const itemArea = new Map<string, number>();
    for (const [id, si] of p.spawnOf) {
      const sp = level.spawns[si];
      if (itemDef(id.split('#')[0]).route !== 'tool') itemArea.set(id, areas.areaOf[sp.f * plane + sp.access[1] * level.W + sp.access[0]]);
    }
    const lib = level.spawns.find((s) => level.rooms[s.room].spec.id === 'library')!;
    const libArea = areas.areaOf[lib.f * plane + lib.access[1] * level.W + lib.access[0]];
    itemArea.set('library_key', libArea);
    for (const id of ROUTE_ITEMS.front) itemArea.set(id, libArea);
    expect(simulate(level, areas, itemArea).routes.front).toBe(false);
  });

  it('every critical item is needed by a route or unlocks a room', () => {
    const lockItems = level.doors.flatMap((d) => (d.spec.lock?.kind === 'item' ? [d.spec.lock.item] : []));
    for (const d of ITEMS) {
      if (d.route === 'tool') continue;
      const used = Object.values(ROUTE_ITEMS).some((l) => l.includes(d.type)) || lockItems.includes(d.type) || d.type === 'hydraulic_tool';
      expect(used, d.type).toBe(true);
    }
  });

  it('generates consistent puzzles', () => {
    for (let s = 0; s < 50; s++) {
      const p = makePuzzles(s);
      expect(p.code).toMatch(/^\d{4}$/);
      expect(p.panelSymbols.map((sym) => p.cipher.find((c) => c.symbol === sym)!.digit).join('')).toBe(p.code);
      const sums = new Set<number>();
      for (let m = 0; m < 8; m++) sums.add(p.valveWeights.reduce((acc, w, i) => acc + (m & (1 << i) ? w : 0), 0));
      expect(sums.size).toBe(8);
      expect(sums.has(p.valveTarget)).toBe(true);
    }
  });
});
