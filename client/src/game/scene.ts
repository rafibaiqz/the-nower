/** Assembles the static estate (architecture, furniture, decor, fixtures, exterior). */
import * as THREE from 'three';
import type { Level } from '@nower/shared';
import { buildFurniture, type ContainerView } from './world/furniture';
import { buildLevelMesh, buildRoof } from './world/LevelMesh';
import { MeshBuilder } from './world/MeshBuilder';
import { buildDecor, buildEnvironment, buildFixtures } from './world/props';
import { warmTextures } from './world/textures';

export interface StaticWorld {
  root: THREE.Group;
  containers: ContainerView[];
  sky: THREE.Mesh;
  /** Merged chunk meshes with their floor index, for floor/distance culling. */
  chunks: { mesh: THREE.Mesh; floor: number; center: THREE.Vector3; radius: number; exterior: boolean }[];
}

const tick = () => new Promise((r) => setTimeout(r, 0));

let cached: StaticWorld | null = null;

export async function buildStaticWorld(level: Level, progress: (text: string, p: number) => void): Promise<StaticWorld> {
  if (cached) {
    // containers are animated: reset them when re-entering a match
    for (const c of cached.containers) {
      c.target = 0;
      c.t = 0.0001;
      c.update(1);
    }
    return cached;
  }
  progress('Staining the wallpaper', 0.05);
  await warmTextures((p) => progress('Staining the wallpaper', 0.05 + p * 0.45));
  progress('Raising the walls', 0.55);
  await tick();
  const root = new THREE.Group();
  root.add(buildLevelMesh(level));
  progress('Dragging in the furniture', 0.7);
  await tick();
  const mb = new MeshBuilder();
  mb.castShadows = true;
  const furn = buildFurniture(level, mb);
  root.add(mb.build());
  root.add(furn.dynamic);
  progress('Hanging the portraits', 0.82);
  await tick();
  const deco = new MeshBuilder();
  buildDecor(level, deco);
  buildFixtures(level, deco);
  root.add(deco.build(true));
  progress('Waiting for the rain', 0.92);
  await tick();
  const env = buildEnvironment(level);
  root.add(env);
  root.add(buildRoof());
  const sky = env.getObjectByName('sky') as THREE.Mesh;
  const chunks: StaticWorld['chunks'] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.floor === undefined || Number.isNaN(m.userData.floor)) return;
    const bs = m.geometry.boundingSphere!;
    const mat = m.material as THREE.Material & { name?: string };
    void mat;
    chunks.push({ mesh: m, floor: m.userData.floor, center: bs.center.clone(), radius: bs.radius, exterior: false });
  });
  cached = { root, containers: furn.containers, sky, chunks };
  return cached;
}
