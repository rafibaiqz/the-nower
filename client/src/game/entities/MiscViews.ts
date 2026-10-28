/** Traps, readable notes, the cistern water and ladders. */
import * as THREE from 'three';
import { CT, F, type Level, type TrapState } from '@nower/shared';
import { getMat, plain } from '../world/textures';

export class TrapView {
  readonly obj = new THREE.Group();
  private jawL: THREE.Object3D | null = null;
  private jawR: THREE.Object3D | null = null;
  constructor(
    level: Level,
    readonly s: TrapState,
  ) {
    const base = level.floors[s.f].base;
    this.obj.position.set(s.x + 0.5, base + 0.01, s.z + 0.5);
    const iron = plain(0x3a3430, 0.6, 0.7);
    if (s.kind === 'snare') {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 12), iron);
      plate.position.y = 0.02;
      this.obj.add(plate);
      const mk = (side: number) => {
        const pivot = new THREE.Group();
        const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.015, 4, 16, Math.PI), getMat('rust'));
        jaw.rotation.x = -Math.PI / 2;
        pivot.add(jaw);
        for (let i = 0; i < 7; i++) {
          const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 4), getMat('rust'));
          const a = (i / 6) * Math.PI;
          tooth.position.set(Math.cos(a) * 0.25, 0.02, -Math.sin(a) * 0.25 * side);
          pivot.add(tooth);
        }
        pivot.rotation.y = side > 0 ? 0 : Math.PI;
        this.obj.add(pivot);
        return pivot;
      };
      this.jawL = mk(1);
      this.jawR = mk(-1);
    } else if (s.kind === 'cans') {
      const wire = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.004, 0.004), plain(0x8a8a80, 0.4, 0.8));
      wire.position.y = 0.15;
      this.obj.add(wire);
      for (let i = 0; i < 4; i++) {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8), plain(0x6a6a60, 0.4, 0.8));
        can.position.set(-0.35 + i * 0.23, 0.06, 0.03 * (i % 2));
        this.obj.add(can);
      }
    } else {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.5), getMat('wood_rough'));
      plate.position.y = 0.015;
      this.obj.add(plate);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.09, 0.14, 10, 1, true), plain(0x8a6a2a, 0.3, 0.9));
      bell.position.set(0.3, 0.3, 0.3);
      this.obj.add(bell);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.4, 0.03), iron);
      post.position.set(0.3, 0.2, 0.3);
      this.obj.add(post);
    }
    this.set(s);
  }
  set(s: TrapState) {
    if (this.jawL && this.jawR) {
      const ang = s.armed ? 1.35 : 0.1;
      this.jawL.rotation.z = ang;
      this.jawR.rotation.z = ang;
    }
    this.obj.children.forEach((c) => (c.visible = true));
  }
}

export function buildNotes(level: Level): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: getMat('paper').map, roughness: 1, emissive: 0x2a2418, emissiveIntensity: 0.6 });
  for (const n of level.notes) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = (n.index * 1.7) % 1 - 0.5;
    m.position.set(n.pos[0], n.pos[1] + 0.012, n.pos[2]);
    g.add(m);
  }
  return g;
}

/** The flooded cistern: a dark reflective plane that sinks as the pump drains it. */
export class WaterView {
  readonly obj: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private base: number;
  private level = 1;
  private target = 1;
  private t = 0;
  constructor(lv: Level) {
    const w = lv.water[0].spec;
    this.base = lv.floors[w.f].base;
    const [x0, z0, x1, z1] = w.rect;
    this.mat = new THREE.MeshStandardMaterial({ color: 0x0e1610, roughness: 0.04, metalness: 0.55, transparent: true, opacity: 0.88 });
    const normal = getMat('sewer_stone').map!.clone();
    normal.repeat.set(4, 6);
    this.mat.bumpMap = normal;
    this.mat.bumpScale = 0.4;
    this.obj = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 1, z1 - z0 + 1), this.mat);
    this.obj.rotation.x = -Math.PI / 2;
    this.obj.position.set((x0 + x1 + 1) / 2, this.base + 1.1, (z0 + z1 + 1) / 2);
  }
  set(level: number) {
    this.target = level;
  }
  update(dt: number) {
    this.t += dt;
    this.level += (this.target - this.level) * Math.min(1, dt * 0.8);
    this.obj.position.y = this.base + 0.04 + this.level * 1.1;
    this.obj.visible = this.level > 0.02;
    if (this.mat.bumpMap) this.mat.bumpMap.offset.set(Math.sin(this.t * 0.1) * 0.05, this.t * 0.01);
  }
}

/** Ladders, the attic hatch and the garden drainage grate. */
export class LadderViews {
  readonly obj = new THREE.Group();
  private grates: THREE.Object3D[] = [];
  constructor(level: Level) {
    const rail = getMat('rust');
    for (const l of level.ladders) {
      const top = l.pa[1] > l.pb[1] ? l.pa : l.pb;
      const bot = l.pa[1] > l.pb[1] ? l.pb : l.pa;
      const h = top[1] - bot[1];
      const g = new THREE.Group();
      g.position.set(bot[0], bot[1], bot[2]);
      for (const x of [-0.22, 0.22]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), rail);
        r.position.set(x, h / 2, -0.4);
        g.add(r);
      }
      for (let y = 0.3; y < h; y += 0.3) {
        const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.44, 6), rail);
        rung.rotation.z = Math.PI / 2;
        rung.position.set(0, y, -0.4);
        g.add(rung);
      }
      this.obj.add(g);
      // hatch / grate on the upper end
      const lid = new THREE.Group();
      lid.position.set(top[0], top[1] + 0.02, top[2]);
      const mat = l.spec.id === 'garden_grate' ? plain(0x2a2826, 0.6, 0.7) : getMat('wood_rough');
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.08), mat);
        b.position.set(0, 0, -0.4 + i * 0.16);
        lid.add(b);
      }
      this.obj.add(lid);
      this.grates.push(lid);
      // the ladder shaft itself is dark, so make a black pit under the lid
      const pit = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), plain(0x000000, 1));
      pit.rotation.x = -Math.PI / 2;
      pit.position.set(top[0], top[1] + 0.008, top[2]);
      this.obj.add(pit);
    }
    void CT;
    void F;
  }
  set(i: number, open: boolean) {
    const lid = this.grates[i];
    if (!lid) return;
    lid.rotation.z = open ? 1.35 : 0;
    lid.position.x += 0;
  }
}
