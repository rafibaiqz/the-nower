import { describe, expect, it } from 'vitest';
import {
  CT,
  F,
  FLOOR_COUNT,
  Navigator,
  STATIC_OPEN,
  floorOfY,
  getLevel,
  groundAt,
  lineOfSight,
  moveBody,
  type NavWorld,
} from '../src/index';

const level = getLevel();
const openWorld: NavWorld = { doorOpen: () => true, doorPassable: () => true, waterDrained: () => true, ladderOpen: () => true };

describe('level build', () => {
  it('is deterministic', async () => {
    const { buildLevel } = await import('../src/level/build');
    const other = buildLevel();
    expect(other.furniture.length).toBe(level.furniture.length);
    expect(other.spawns.map((s) => s.pos.join(','))).toEqual(level.spawns.map((s) => s.pos.join(',')));
  });

  it('has the required areas of a large mansion', () => {
    const ids = level.rooms.map((r) => r.spec.id);
    for (const id of ['hall', 'living', 'dining', 'kitchen', 'pantry', 'study', 'library', 'trophy', 'guest', 'storage', 'conservatory', 'corridor', 'utility', 'garage', 'garden',
      'master', 'children', 'bathroom', 'gallery', 'hidden', 'boiler', 'electrical', 'workshop', 'tools', 'holding', 'generator', 'pumproom', 'archive', 'tunnel',
      'alanding', 'dusty', 'cistern', 'valves', 'north', 'outfall', 'courtyard', 'shed'])
      expect(ids).toContain(id);
    expect(level.rooms.length).toBeGreaterThan(55);
    expect(level.hides.length).toBeGreaterThan(25);
    expect(level.spawns.length).toBeGreaterThan(150);
  });

  it('every door sits between two walkable rooms', () => {
    for (const d of level.doors) {
      expect(d.rooms[0], d.spec.id).toBeGreaterThanOrEqual(0);
      expect(d.rooms[1], d.spec.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('every room is reachable from the bedroom when all doors are open', () => {
    const nav = new Navigator(level);
    const s = level.playerStarts[0];
    for (const room of level.rooms) {
      if (room.spec.id === 'holding') continue; // cage interior is a separate pocket
      const pp = level.patrolPoints.find((p) => p.room === room.index);
      if (!pp) continue;
      const path = nav.findPath(openWorld, floorOfY(s[1]), s[0], s[2], pp.f, pp.x + 0.5, pp.z + 0.5, 200000);
      expect(path, `path to ${room.spec.id}`).not.toBeNull();
    }
  });

  it('item spawns and hiding spots are reachable cells', () => {
    for (const sp of level.spawns) {
      const g = level.floors[sp.f];
      const k = sp.access[1] * level.W + sp.access[0];
      expect([CT.FLOOR, CT.OUTDOOR]).toContain(g.type[k]);
      expect(g.flags[k] & F.FURN).toBe(0);
    }
    for (const h of level.hides) {
      const h0 = groundAt(level, STATIC_OPEN, h.f, Math.floor(h.exit[0]), Math.floor(h.exit[2]), h.exit[0], h.exit[2]);
      expect(Number.isNaN(h0), `hide ${h.index} exit`).toBe(false);
    }
  });

  it('collision stops a body at walls', () => {
    // walk west from the hall into the hall/living wall (x=39) away from the door
    const b = { x: 41.5, y: 0, z: 43.5 };
    for (let i = 0; i < 40; i++) moveBody(level, STATIC_OPEN, b, -0.2, 0, 0.3);
    expect(b.x).toBeGreaterThan(40.25);
    expect(b.x).toBeLessThan(40.4);
  });

  it('stairs carry a body between floors', () => {
    const b = { x: 48.5, y: 0, z: 54.5 };
    for (let i = 0; i < 80; i++) moveBody(level, STATIC_OPEN, b, 0, -0.15, 0.3);
    expect(floorOfY(b.y)).toBe(3);
    expect(b.y).toBeCloseTo(4, 1);
  });

  it('walls block line of sight but open doorways do not', () => {
    expect(lineOfSight(level, STATIC_OPEN, 41.5, 1.6, 43.5, 37.5, 1.6, 43.5)).toBe(false);
    expect(lineOfSight(level, STATIC_OPEN, 48.5, 1.6, 50.5, 48.5, 1.6, 38.5)).toBe(true);
  });

  it('has five floors with stairs linking them', () => {
    expect(level.floors.length).toBe(FLOOR_COUNT);
    expect(level.stairs.length).toBeGreaterThanOrEqual(6);
  });
});
