/**
 * Every hiding place (46 of them, all orientations) must give the hidden player a real view:
 * the camera is not buried in geometry (nothing within the near plane), and a meaningful part
 * of the allowed look range reaches the room outside through the door gap, the louvres, the
 * open space under the bed frame or between the niche bars.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { getLevel } from '@nower/shared';

vi.mock('../src/game/world/textures', () => {
  const mat = () => new THREE.MeshBasicMaterial();
  return { getMat: mat, plain: mat, getTexture: () => new THREE.Texture(), tileSize: () => 2, textTexture: () => new THREE.Texture(), portrait: () => new THREE.Texture(), warmTextures: async () => {}, ALL_TEXTURE_KEYS: [] };
});

const { buildLevelMesh } = await import('../src/game/world/LevelMesh');
const { buildFurniture } = await import('../src/game/world/furniture');
const { MeshBuilder } = await import('../src/game/world/MeshBuilder');
const { TriGrid, collect } = await import('./raycast');

const level = getLevel();

describe('hiding places give a usable view', () => {
  const mb = new MeshBuilder();
  const furn = buildFurniture(level, mb);
  // the occupant sees their own doors slightly ajar
  for (const h of furn.hides) {
    h.occupiedByMe = true;
    h.update(10, 0);
  }
  const tris: number[] = [];
  collect(buildLevelMesh(level), tris);
  collect(mb.build(), tris);
  collect(furn.dynamic, tris);
  const grid = new TriGrid(tris);

  it('covers every hiding place', () => {
    expect(furn.hides.length).toBe(level.hides.length);
    expect(new Set(furn.hides.map((h) => h.kind))).toEqual(new Set(['wardrobe', 'bed', 'locker', 'niche']));
  });

  for (const kind of ['wardrobe', 'bed', 'locker', 'niche'] as const) {
    it(`${kind}: camera is not inside geometry and sees out`, () => {
      const spots = furn.hides.filter((h) => h.kind === kind);
      expect(spots.length).toBeGreaterThan(0);
      for (const h of spots) {
        // nothing within the near plane in any direction
        let nearest = Infinity;
        for (let i = 0; i < 64; i++) {
          const u = (i + 0.5) / 64;
          const theta = Math.acos(1 - 2 * u);
          const phi = i * 2.399963;
          const d = new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
          nearest = Math.min(nearest, grid.cast(h.cam, d, true));
        }
        expect(nearest, `hide ${h.index} camera clearance`).toBeGreaterThan(0.06);
        // fan of view rays across the allowed look range
        let out = 0;
        let total = 0;
        for (let yi = -6; yi <= 6; yi++)
          for (let pi = -2; pi <= 2; pi++) {
            const yaw = h.yaw + (yi / 6) * h.yawRange;
            const pitch = h.pitchRange[0] + ((pi + 2) / 4) * (h.pitchRange[1] - h.pitchRange[0]);
            const d = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
            total++;
            if (grid.cast(h.cam, d) > 1.2) out++;
          }
        const share = out / total;
        // a crack/louvre view is narrow by design; under a bed or behind bars it is wide
        const min = kind === 'wardrobe' || kind === 'locker' ? 0.04 : 0.3;
        expect(share, `hide ${h.index} (${kind}) sees out through ${Math.round(share * 100)}% of its view`).toBeGreaterThanOrEqual(min);
      }
    });
  }
});
