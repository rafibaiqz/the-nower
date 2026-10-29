/**
 * Development-time validation of the generated architecture (runs in Node, not per frame).
 *
 * The real level mesh is built and rays are cast from thousands of interior points: eye height,
 * floor level, just under ceilings and every height along every staircase. With all doors
 * treated as closed, every ray must hit a FRONT-facing surface (back faces are culled by the
 * renderer, so hitting one means you would see straight through it) before leaving the
 * estate. A ray that escapes is a hole through which the outside of the house is visible.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CT, F, FLOOR_COUNT, FLOOR_HEIGHT, floorOfY, getLevel, roomAt, stairHeight, type Level } from '@nower/shared';

vi.mock('../src/game/world/textures', () => {
  const mat = () => new THREE.MeshBasicMaterial();
  return { getMat: mat, plain: mat, getTexture: () => new THREE.Texture(), tileSize: () => 2, textTexture: () => new THREE.Texture(), portrait: () => new THREE.Texture(), warmTextures: async () => {}, ALL_TEXTURE_KEYS: [] };
});

const { buildLevelMesh, buildRoof } = await import('../src/game/world/LevelMesh');
const { TriGrid, collect } = await import('./raycast');

const level = getLevel();
/** Closed doors: a box filling each door cell (both orientations face outward). */
function doorBlockers(L: Level, out: number[]) {
  for (const d of L.doors) {
    const base = L.floors[d.spec.f].base;
    for (const [x, z] of d.spec.cells) {
      const g = new THREE.BoxGeometry(1, FLOOR_HEIGHT, 1);
      g.translate(x + 0.5, base + FLOOR_HEIGHT / 2, z + 0.5);
      collect(new THREE.Mesh(g), out);
    }
  }
}

function interiorSamples(L: Level): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let f = 0; f < FLOOR_COUNT; f++) {
    const g = L.floors[f];
    for (let z = 0; z < L.D; z++)
      for (let x = 0; x < L.W; x++) {
        const k = z * L.W + x;
        const t = g.type[k];
        const ri = g.room[k];
        if (ri < 0 || L.rooms[ri].spec.outdoor) continue;
        // positions a camera can occupy: walkable cells, never inside furniture or balustrades
        if (t !== CT.FLOOR && t !== CT.STAIR && t !== CT.WATER) continue;
        if (g.flags[k] & F.FURN) continue;
        const isStair = t === CT.STAIR;
        // every stair cell; a checkerboard of ordinary cells
        if (!isStair && (x + z) % 2 !== 0) continue;
        const cx = x + 0.5;
        const cz = z + 0.5;
        const ground = isStair ? stairHeight(L.stairs[g.ent[k]], cx, cz) : g.base;
        if (isStair && Math.abs(ground - g.base) > FLOOR_HEIGHT / 2 + 0.01 && L.stairs[g.ent[k]].spec.lower !== f) continue;
        // on stairs the steps rise above the ramp line, so sample from knee height (a crouched eye is 0.95)
        const heights = isStair ? [0.9, 1.6, 2.3] : [0.15, 1.6, g.ceilH - 0.15];
        for (const h of heights) pts.push(new THREE.Vector3(cx + 0.13, ground + h, cz + 0.17));
      }
  }
  return pts;
}

function directions(): THREE.Vector3[] {
  const dirs: THREE.Vector3[] = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.07;
    dirs.push(new THREE.Vector3(Math.cos(a), 0.001, Math.sin(a)).normalize());
    if (i % 2 === 0) {
      dirs.push(new THREE.Vector3(Math.cos(a), 0.45, Math.sin(a)).normalize());
      dirs.push(new THREE.Vector3(Math.cos(a), -0.45, Math.sin(a)).normalize());
    }
  }
  return dirs;
}

describe('estate geometry is watertight', () => {
  it('no interior view escapes the building (stairwells, slabs, walls, windows)', () => {
    const tris: number[] = [];
    collect(buildLevelMesh(level), tris);
    collect(buildRoof(), tris);
    doorBlockers(level, tris);
    const grid = new TriGrid(tris);
    const pts = interiorSamples(level);
    const dirs = directions();
    const leaks: string[] = [];
    for (const p of pts)
      for (const d of dirs) {
        if (grid.cast(p, d) === Infinity) leaks.push(`(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) dir (${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)})`);
      }
    if (leaks.length) {
      const byRoom = new Map<string, string[]>();
      for (const l of leaks) {
        const [x, y, z] = l.slice(1, l.indexOf(')')).split(',').map(Number);
        const ri = roomAt(level, floorOfY(y - 0.5), x, z);
        const name = ri >= 0 ? level.rooms[ri].spec.name : '?';
        byRoom.set(name, [...(byRoom.get(name) ?? []), l]);
      }
      console.log(`${leaks.length} leaking rays:\n` + [...byRoom].map(([n, ls]) => `  ${n}: ${ls.length}  e.g. ${ls[0]}`).join('\n'));
    }
    console.log(`checked ${pts.length} interior points x ${dirs.length} directions`);
    expect(leaks.length).toBe(0);
  });
});
