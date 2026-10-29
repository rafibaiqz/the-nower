/**
 * Procedural furniture models. Static parts are merged through the MeshBuilder; the moving
 * parts of containers (drawers, cupboard doors, lids) are separate animated objects.
 */
import * as THREE from 'three';
import { Rng, furnSpec, type Container, type Furniture, type HideKind, type Level } from '@nower/shared';
import { MeshBuilder, pk, resolveMat } from './MeshBuilder';

const ROT_ANGLE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

const BRASS = pk(0x8a6a2a, 0.35, 0.8);
const IRON = pk(0x222222, 0.5, 0.7);
const DARK = pk(0x0a0806, 1);
const BLACK_LACQUER = pk(0x080706, 0.25, 0.1);
const CREAM = pk(0xcbbf9f, 0.6);
const BOOK_COLORS = [0x3a1010, 0x10203a, 0x1e3018, 0x3a2a10, 0x2a1a2a, 0x403a30, 0x201810];

interface P {
  box(mat: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry?: number): void;
  cyl(mat: string, x: number, y: number, z: number, r0: number, r1: number, h: number, seg?: number, rx?: number, rz?: number): void;
  sphere(mat: string, x: number, y: number, z: number, r: number, sy?: number, seg?: number): void;
  torus(mat: string, x: number, y: number, z: number, r: number, tube: number, rx?: number): void;
  w: number;
  d: number;
  rng: Rng;
  zone: string;
}

export interface ContainerView {
  index: number;
  kind: Container['kind'];
  part: THREE.Object3D;
  target: number;
  t: number;
  update(dt: number): void;
}

/**
 * A hiding place as seen from inside: where the hidden player's camera sits (inside the hollow
 * furniture, behind the door gap / louvres / under the frame), how far it may turn, and the
 * animated door leaves (ajar for the occupant, flung open when the Nower checks it).
 */
export interface HideView {
  index: number;
  kind: HideKind;
  cam: THREE.Vector3;
  yaw: number;
  yawRange: number;
  pitchRange: [number, number];
  fov: number;
  leaves: { pivot: THREE.Object3D; sign: number; angle: number; target: number; ajar: number }[];
  searchedUntil: number;
  occupiedByMe: boolean;
  update(dt: number, now: number): void;
}

const HIDE_CAM: Record<HideKind, { pos: [number, number, number]; yawRange: number; pitch: [number, number]; fov: number }> = {
  wardrobe: { pos: [0, 1.55, 0.27], yawRange: 0.55, pitch: [-0.35, 0.3], fov: 62 },
  locker: { pos: [0.03, 1.55, 0.2], yawRange: 0.5, pitch: [-0.3, 0.25], fov: 62 },
  bed: { pos: [0, 0.17, 0.45], yawRange: 1.05, pitch: [-0.3, 0.22], fov: 70 },
  niche: { pos: [0, 1.25, -0.08], yawRange: 0.8, pitch: [-0.35, 0.35], fov: 66 },
};

function hideView(level: Level, fu: Furniture, world: THREE.Matrix4, zone: string): { view: HideView; holder: THREE.Object3D } {
  const h = level.hides[fu.hide!];
  const cfg = HIDE_CAM[h.kind];
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(world);
  const leaves: HideView['leaves'] = [];
  const wood = resolveMat(h.kind === 'locker' && !(zone === 'mansion' || zone === 'attic') ? 'rust' : 'wood_dark');
  const brass = resolveMat(BRASS);
  const piece = (parent: THREE.Object3D, w: number, hgt: number, d: number, x: number, y: number, z: number, mat = wood) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  if (h.kind === 'wardrobe') {
    // two leaves hinged at the outer edges, 4 cm apart in the middle
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.93, 0, 0.375);
      const w = 0.905;
      const cx = -side * (w / 2);
      piece(pivot, w, 1.95, 0.03, cx, 1.075, 0);
      piece(pivot, w * 0.72, 0.7, 0.012, cx, 0.6, 0.02, resolveMat('trim'));
      piece(pivot, w * 0.72, 0.7, 0.012, cx, 1.55, 0.02, resolveMat('trim'));
      piece(pivot, 0.025, 0.12, 0.03, -side * (w - 0.06), 1.12, 0.03, brass);
      holder.add(pivot);
      leaves.push({ pivot, sign: side, angle: 0, target: 0, ajar: side > 0 ? 0.36 : 0.06 });
    }
  } else if (h.kind === 'locker') {
    // one door with a louvred vent at eye height: slats with real gaps between them
    const pivot = new THREE.Group();
    pivot.position.set(-0.43, 0, 0.375);
    const w = 0.85;
    piece(pivot, w, 1.32, 0.03, w / 2, 0.68, 0);
    piece(pivot, w, 0.2, 0.03, w / 2, 1.9, 0);
    piece(pivot, 0.1, 0.48, 0.03, 0.05, 1.56, 0);
    piece(pivot, 0.1, 0.48, 0.03, w - 0.05, 1.56, 0);
    for (let i = 0; i < 5; i++) piece(pivot, w - 0.2, 0.025, 0.05, w / 2, 1.36 + i * 0.1, 0.005, wood).rotation.x = -0.35;
    piece(pivot, 0.025, 0.12, 0.03, w - 0.1, 1.0, 0.03, brass);
    holder.add(pivot);
    leaves.push({ pivot, sign: -1, angle: 0, target: 0, ajar: 0.05 });
  }
  const view: HideView = {
    index: h.index,
    kind: h.kind,
    cam: new THREE.Vector3(...cfg.pos).applyMatrix4(world),
    yaw: h.yaw,
    yawRange: cfg.yawRange,
    pitchRange: cfg.pitch,
    fov: cfg.fov,
    leaves,
    searchedUntil: 0,
    occupiedByMe: false,
    update(dt, now) {
      const searched = now < this.searchedUntil;
      for (const l of this.leaves) {
        l.target = searched ? 1.55 : this.occupiedByMe ? l.ajar : 0;
        const k = Math.min(1, dt * (searched ? 9 : 4));
        l.angle += (l.target - l.angle) * k;
        // left leaf extends +x from its hinge, right leaf -x: both swing outwards (+z)
        l.pivot.rotation.y = l.sign > 0 ? l.angle : -l.angle;
      }
    },
  };
  return { view, holder };
}

export function buildFurniture(level: Level, mb: MeshBuilder): { containers: ContainerView[]; hides: HideView[]; dynamic: THREE.Group } {
  const dynamic = new THREE.Group();
  const containers: ContainerView[] = [];
  const hides: HideView[] = [];
  for (const fu of level.furniture) {
    const spec = furnSpec(fu.t);
    const base = level.floors[fu.f].base;
    const world = new THREE.Matrix4().makeRotationY(ROT_ANGLE[fu.rot]).setPosition(fu.center[0], base, fu.center[2]);
    const tmp = new THREE.Matrix4();
    const zone = fu.room >= 0 ? level.rooms[fu.room].spec.zone : 'basement';
    const p: P = {
      w: spec.w,
      d: spec.d,
      rng: new Rng(fu.index * 7919 + 13),
      zone,
      box: (mat, x, y, z, sx, sy, sz, ry = 0) => {
        tmp.makeRotationY(ry).setPosition(x, y, z);
        mb.boxM(mat, fu.f, world.clone().multiply(tmp), sx, sy, sz);
      },
      cyl: (mat, x, y, z, r0, r1, h, seg = 12, rx = 0, rz = 0) => {
        const g = new THREE.CylinderGeometry(r0, r1, h, seg);
        tmp.makeRotationFromEuler(new THREE.Euler(rx, 0, rz)).setPosition(x, y, z);
        mb.geom(mat, fu.f, g, world.clone().multiply(tmp));
        g.dispose();
      },
      sphere: (mat, x, y, z, r, sy = 1, seg = 10) => {
        const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2));
        tmp.makeScale(1, sy, 1).setPosition(x, y, z);
        mb.geom(mat, fu.f, g, world.clone().multiply(tmp));
        g.dispose();
      },
      torus: (mat, x, y, z, r, tube, rx = Math.PI / 2) => {
        const g = new THREE.TorusGeometry(r, tube, 6, 16);
        tmp.makeRotationX(rx).setPosition(x, y, z);
        mb.geom(mat, fu.f, g, world.clone().multiply(tmp));
        g.dispose();
      },
    };
    const builder = BUILDERS[fu.t];
    builder?.(p);
    if (fu.hide !== undefined) {
      const { view, holder } = hideView(level, fu, world, zone);
      if (view.leaves.length) dynamic.add(holder);
      holder.updateMatrixWorld(true);
      hides.push(view);
    }
    if (fu.container !== undefined) {
      const c = level.containers[fu.container];
      const view = containerPart(c, fu, spec.w, spec.d, spec.h, world, zone);
      dynamic.add(view.part.parent ?? view.part);
      containers.push(view);
    }
  }
  hides.sort((a, b) => a.index - b.index);
  return { containers, hides, dynamic };
}

/** Moving part of a container in local furniture space. */
function containerPart(c: Container, fu: Furniture, w: number, d: number, h: number, world: THREE.Matrix4, zone: string): ContainerView {
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(world);
  const wood = resolveMat(zone === 'basement' || zone === 'garage' || zone === 'sewer' ? 'metal' : 'trim');
  const part = new THREE.Group();
  let update: (t: number) => void;
  if (c.kind === 'drawer') {
    const dw = Math.min(w * 0.85, 0.9);
    const y = fu.t === 'toolchest' ? 0.82 : fu.t === 'desk' ? 0.62 : fu.t === 'nightstand' ? 0.42 : h * 0.72;
    const front = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.2, 0.04), wood);
    front.position.set(0, 0, 0);
    const boxM = resolveMat('trim');
    const tray = new THREE.Mesh(new THREE.BoxGeometry(dw * 0.95, 0.16, d * 0.7), boxM);
    tray.position.set(0, -0.01, -d * 0.35);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), resolveMat(BRASS));
    knob.position.set(0, 0, 0.03);
    part.add(front, tray, knob);
    part.position.set(0, y, d / 2 - 0.03);
    const z0 = part.position.z;
    update = (t) => (part.position.z = z0 + t * 0.42);
  } else if (c.kind === 'chest') {
    const lid = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.08, d * 0.8), resolveMat(fu.t === 'toychest' ? 'trim' : 'leather'));
    lid.position.set(0, 0.04, d * 0.4);
    part.add(lid);
    part.position.set(0, h - 0.02, -d * 0.4);
    update = (t) => (part.rotation.x = -t * 1.6);
  } else {
    // cupboard / fridge door hinged on the left
    const dw = c.kind === 'fridge' ? 0.8 : Math.min(w * 0.45, 0.9);
    const dh = c.kind === 'fridge' ? 1.75 : h * 0.75;
    const door = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 0.04), c.kind === 'fridge' ? resolveMat('porcelain') : wood);
    door.position.set(dw / 2, dh / 2, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.04), resolveMat(BRASS));
    handle.position.set(dw - 0.08, dh * 0.6, 0.03);
    part.add(door, handle);
    part.position.set(-dw / 2 - (c.kind === 'fridge' ? 0 : 0.02), c.kind === 'fridge' ? 0.1 : 0.06, d / 2 + 0.01);
    update = (t) => (part.rotation.y = -t * 1.75);
  }
  holder.add(part);
  holder.updateMatrixWorld(true);
  const view: ContainerView = {
    index: c.index,
    kind: c.kind,
    part,
    target: 0,
    t: 0,
    update(dt) {
      if (this.t === this.target) return;
      this.t += Math.sign(this.target - this.t) * Math.min(Math.abs(this.target - this.t), dt * 3.5);
      update(this.t);
    },
  };
  return view;
}

const BUILDERS: Record<string, (p: P) => void> = {
  bed: (p) => {
    // raised on legs with an open foot end, so the space underneath is a usable hiding view
    const W = 1.9;
    const L = 1.95;
    for (const [x, z] of [
      [-W / 2 + 0.05, -L / 2 + 0.05],
      [W / 2 - 0.05, -L / 2 + 0.05],
      [-W / 2 + 0.05, L / 2 - 0.05],
      [W / 2 - 0.05, L / 2 - 0.05],
    ])
      p.box('trim', x, 0.21, z, 0.08, 0.42, 0.08);
    p.box('trim', 0, 0.42, 0, W, 0.12, L);
    // slats seen from underneath
    for (let i = 0; i < 6; i++) p.box('wood_rough', 0, 0.355, -L / 2 + 0.2 + i * 0.31, W - 0.1, 0.02, 0.08);
    p.box('trim', 0, 0.88, -L / 2 + 0.04, W, 1.05, 0.08);
    // the footboard is a rail above the frame: open below it
    p.box('trim', 0, 0.62, L / 2 - 0.04, W, 0.28, 0.06);
    p.box('sheet', 0, 0.58, 0.02, W - 0.1, 0.2, L - 0.12);
    p.box('sheet', -0.45, 0.74, -L / 2 + 0.3, 0.7, 0.14, 0.35);
    p.box('sheet', 0.45, 0.74, -L / 2 + 0.3, 0.7, 0.14, 0.35);
    p.box(p.rng.chance(0.5) ? 'fabric' : 'fabric_green', 0, 0.7, 0.35, W - 0.05, 0.06, L * 0.6);
    // the blanket hangs over the sides but stops above the frame's underside
    p.box('fabric', -W / 2 + 0.01, 0.55, 0.35, 0.03, 0.3, L * 0.6);
    p.box('fabric', W / 2 - 0.01, 0.55, 0.35, 0.03, 0.3, L * 0.6);
  },
  wardrobe: (p) => {
    // hollow carcass (the doors are animated separately); a camera inside sees real inner faces
    p.box('trim', 0, 1.1, -0.43, 1.9, 2.2, 0.04);
    p.box('trim', -0.93, 1.1, -0.04, 0.04, 2.2, 0.82);
    p.box('trim', 0.93, 1.1, -0.04, 0.04, 2.2, 0.82);
    p.box('trim', 0, 2.18, -0.04, 1.9, 0.04, 0.82);
    p.box('trim', 0, 2.25, -0.04, 2.0, 0.1, 0.9);
    p.box('trim', 0, 0.05, -0.04, 1.86, 0.1, 0.82);
    p.cyl(pk(0x5a4a30, 0.4, 0.7), 0, 1.95, -0.12, 0.015, 0.015, 1.8, 6, 0, Math.PI / 2);
    // old coats hanging at the sides, leaving room in the middle
    p.box('fabric', -0.62, 1.38, -0.12, 0.42, 1.1, 0.12);
    p.box('fabric_green', 0.66, 1.42, -0.14, 0.36, 1.0, 0.1);
  },
  locker: (p) => {
    const m = p.zone === 'mansion' || p.zone === 'attic' ? 'trim' : 'metal';
    p.box(m, 0, 1.0, -0.43, 0.9, 2.0, 0.04);
    p.box(m, -0.43, 1.0, -0.04, 0.04, 2.0, 0.8);
    p.box(m, 0.43, 1.0, -0.04, 0.04, 2.0, 0.8);
    p.box(m, 0, 1.98, -0.04, 0.9, 0.04, 0.8);
    p.box(m, 0, 0.04, -0.04, 0.86, 0.08, 0.8);
  },
  dresser: (p) => {
    p.box('trim', 0, 0.47, -0.05, 1.9, 0.94, 0.7);
    p.box('wood_dark', 0, 0.96, -0.05, 1.96, 0.04, 0.76);
    for (let i = 0; i < 2; i++) p.box('wood_dark', 0, 0.2 + i * 0.25, 0.31, 1.7, 0.2, 0.03);
    p.box(DARK, 0, 1.45, -0.32, 1.2, 0.9, 0.04);
    p.box('trim', 0, 1.45, -0.34, 1.3, 1.0, 0.03);
  },
  nightstand: (p) => {
    p.box('trim', 0, 0.3, -0.05, 0.6, 0.6, 0.55);
    p.cyl(BRASS, -0.15, 0.68, -0.1, 0.05, 0.07, 0.12);
    p.cyl(CREAM, -0.15, 0.82, -0.1, 0.08, 0.13, 0.16);
  },
  desk: (p) => {
    p.box('wood_dark', 0, 0.76, -0.05, 1.9, 0.05, 0.8);
    for (const x of [-0.9, 0.9]) p.box('trim', x, 0.38, -0.05, 0.08, 0.76, 0.75);
    p.box('trim', 0.55, 0.45, -0.1, 0.65, 0.5, 0.6);
    p.box('paper', -0.3, 0.79, 0.05, 0.4, 0.01, 0.3, 0.2);
    p.box('paper', -0.5, 0.795, -0.1, 0.3, 0.01, 0.4, -0.3);
    p.cyl(IRON, 0.7, 0.85, -0.25, 0.06, 0.08, 0.16);
  },
  table: (p) => {
    p.box('wood_dark', 0, 0.76, 0, 1.9, 0.05, 0.9);
    for (const [x, z] of [
      [-0.85, -0.38],
      [0.85, -0.38],
      [-0.85, 0.38],
      [0.85, 0.38],
    ])
      p.box('trim', x, 0.37, z, 0.07, 0.74, 0.07);
    if (p.rng.chance(0.5)) p.box('sheet', 0, 0.79, 0, 1.2, 0.01, 0.95);
  },
  bigtable: (p) => {
    p.box('wood_dark', 0, 0.76, 0, 3.8, 0.07, 1.7);
    for (const x of [-1.7, 0, 1.7])
      for (const z of [-0.7, 0.7]) p.box('trim', x, 0.37, z, 0.09, 0.74, 0.09);
    p.box('sheet', 0, 0.8, 0, 3.2, 0.01, 1.1);
    for (const x of [-1.2, -0.4, 0.4, 1.2]) {
      p.cyl(CREAM, x, 0.82, -0.45, 0.13, 0.13, 0.02, 14);
      p.cyl(CREAM, x, 0.82, 0.45, 0.13, 0.13, 0.02, 14);
    }
    p.cyl(BRASS, 0, 0.95, 0, 0.03, 0.08, 0.3);
    for (const dx of [-0.15, 0, 0.15]) p.cyl(CREAM, dx, 1.15, 0, 0.015, 0.015, 0.16);
  },
  sidetable: (p) => {
    p.box('wood_dark', 0, 0.74, -0.04, 0.92, 0.04, 0.8);
    for (const [x, z] of [
      [-0.41, -0.39],
      [0.41, -0.39],
      [-0.41, 0.31],
      [0.41, 0.31],
    ])
      p.box('trim', x, 0.36, z, 0.05, 0.72, 0.05);
    p.box('trim', 0, 0.62, -0.04, 0.86, 0.1, 0.74);
    if (p.rng.chance(0.5)) {
      p.cyl(pk(0x30402a, 0.4), 0.2, 0.86, -0.15, 0.05, 0.08, 0.22);
      p.sphere(DARK, 0.2, 1.02, -0.15, 0.08, 0.6);
    }
  },
  chair: (p) => {
    // a high-backed chair that fills its cell (the whole cell blocks movement)
    p.box('trim', 0, 0.45, 0, 0.62, 0.05, 0.62);
    for (const [x, z] of [
      [-0.28, -0.28],
      [0.28, -0.28],
      [-0.28, 0.28],
      [0.28, 0.28],
    ])
      p.box('trim', x, 0.22, z, 0.05, 0.45, 0.05);
    p.box('trim', 0, 0.85, -0.29, 0.62, 0.8, 0.05, 0.0);
    p.box('fabric', 0, 0.49, 0, 0.58, 0.05, 0.58);
  },
  armchair: (p) => {
    p.box('fabric', 0, 0.25, 0, 0.85, 0.5, 0.8);
    p.box('fabric', 0, 0.75, -0.3, 0.85, 0.7, 0.2);
    p.box('fabric', -0.38, 0.55, 0, 0.12, 0.3, 0.75);
    p.box('fabric', 0.38, 0.55, 0, 0.12, 0.3, 0.75);
  },
  sofa: (p) => {
    p.box('fabric', 0, 0.25, 0, 2.8, 0.5, 0.85);
    p.box('fabric', 0, 0.7, -0.33, 2.8, 0.6, 0.2);
    p.box('fabric', -1.35, 0.55, 0, 0.15, 0.3, 0.8);
    p.box('fabric', 1.35, 0.55, 0, 0.15, 0.3, 0.8);
    if (p.rng.chance(0.6)) p.box('sheet', 0.3, 0.75, 0, 2.2, 0.08, 0.8, 0.05);
  },
  bench: (p) => {
    const m = p.zone === 'garden' ? 'stone' : 'trim';
    p.box(m, 0, 0.45, 0, 1.8, 0.08, 0.45);
    p.box(m, -0.75, 0.22, 0, 0.12, 0.44, 0.4);
    p.box(m, 0.75, 0.22, 0, 0.12, 0.44, 0.4);
  },
  bookshelf: (p) => {
    p.box('trim', 0, 1.15, -0.32, 1.9, 2.3, 0.04);
    p.box('trim', -0.93, 1.15, -0.12, 0.04, 2.3, 0.45);
    p.box('trim', 0.93, 1.15, -0.12, 0.04, 2.3, 0.45);
    for (let i = 0; i < 6; i++) {
      const y = 0.05 + i * 0.45;
      p.box('trim', 0, y, -0.12, 1.86, 0.04, 0.45);
      if (i === 5) continue;
      let x = -0.9;
      while (x < 0.86) {
        const bw = 0.04 + p.rng.next() * 0.05;
        const bh = 0.25 + p.rng.next() * 0.13;
        if (p.rng.chance(0.08)) {
          x += 0.12;
          continue;
        }
        const tilt = p.rng.chance(0.1) ? 0.3 : 0;
        p.box(pk(p.rng.pick(BOOK_COLORS), 0.9), x + bw / 2, y + 0.02 + bh / 2, -0.15, bw, bh, 0.28, tilt);
        x += bw + 0.003;
      }
    }
  },
  trophycase: (p) => {
    p.box('trim', 0, 1.0, -0.1, 1.9, 2.0, 0.55);
    p.box('glass_window', 0, 1.1, 0.19, 1.8, 1.6, 0.02);
    for (let i = 0; i < 3; i++) {
      p.sphere(CREAM, -0.5 + i * 0.5, 1.4, -0.1, 0.09, 1.2);
      p.box(DARK, -0.5 + i * 0.5, 1.4, -0.02, 0.06, 0.03, 0.02);
    }
    p.box(BRASS, 0.2, 0.75, -0.1, 0.2, 0.25, 0.1);
  },
  fireplace: (p) => {
    p.box('stone', 0, 0.7, -0.15, 2.8, 1.4, 0.7);
    p.box(DARK, 0, 0.5, 0.18, 1.3, 0.9, 0.06);
    p.box('trim', 0, 1.45, -0.1, 3.0, 0.08, 0.8);
    p.box(pk(0x3a1206, 1, 0, 0.6), 0, 0.12, 0.05, 0.9, 0.06, 0.4);
    p.cyl(BRASS, -1.1, 1.62, -0.2, 0.04, 0.06, 0.25);
    p.cyl(BRASS, 1.1, 1.62, -0.2, 0.04, 0.06, 0.25);
  },
  piano: (p) => {
    p.box(BLACK_LACQUER, 0, 0.75, -0.55, 1.9, 1.3, 0.75);
    p.box(BLACK_LACQUER, 0, 0.72, 0.0, 1.9, 0.08, 0.5);
    p.box(CREAM, 0, 0.77, 0.05, 1.7, 0.03, 0.18);
    for (let i = 0; i < 24; i++) p.box(DARK, -0.8 + i * 0.07, 0.8, 0.0, 0.03, 0.03, 0.1);
    for (const x of [-0.85, 0.85]) p.box(BLACK_LACQUER, x, 0.35, 0.1, 0.08, 0.7, 0.08);
    p.box('trim', 0, 0.25, 0.65, 0.9, 0.5, 0.4);
  },
  gclock: (p) => {
    p.box('trim', 0, 1.1, -0.1, 0.5, 2.2, 0.38);
    p.box('trim', 0, 2.2, -0.1, 0.58, 0.12, 0.44);
    p.cyl(CREAM, 0, 1.78, 0.1, 0.17, 0.17, 0.02, 16, Math.PI / 2);
    // hands frozen at 3:17
    p.box(DARK, 0.05, 1.78, 0.115, 0.1, 0.012, 0.005, 0);
    p.box(DARK, 0, 1.72, 0.115, 0.01, 0.13, 0.005, 0);
    p.box('glass_window', 0, 0.95, 0.1, 0.3, 0.9, 0.01);
    p.cyl(BRASS, 0, 0.75, 0.05, 0.07, 0.07, 0.01, 12, Math.PI / 2);
  },
  cabinet: (p) => {
    p.box('trim', 0, 0.45, -0.05, 1.9, 0.9, 0.7);
    p.box('wood_dark', 0, 0.92, -0.05, 1.96, 0.04, 0.75);
    p.box('wood_dark', 0.47, 0.45, 0.3, 0.88, 0.68, 0.03);
    p.cyl(CREAM, -0.5, 1.02, -0.1, 0.07, 0.05, 0.16);
  },
  counter: (p) => {
    p.box(p.zone === 'mansion' ? 'trim' : 'metal', 0, 0.45, -0.05, 1.9, 0.9, 0.7);
    p.box('tile_dirty', 0, 0.92, -0.05, 1.96, 0.05, 0.75);
    p.box('wood_dark', 0.47, 0.45, 0.3, 0.88, 0.68, 0.03);
    if (p.rng.chance(0.6)) p.cyl(IRON, -0.5, 1.0, -0.1, 0.13, 0.11, 0.12);
  },
  stove: (p) => {
    p.box(IRON, 0, 0.47, -0.05, 0.85, 0.94, 0.7);
    for (const [x, z] of [
      [-0.2, -0.2],
      [0.2, -0.2],
      [-0.2, 0.12],
      [0.2, 0.12],
    ])
      p.cyl(DARK, x, 0.95, z, 0.1, 0.1, 0.02);
    p.box(DARK, 0, 0.45, 0.3, 0.6, 0.45, 0.02);
    p.box(BRASS, 0, 0.7, 0.32, 0.5, 0.03, 0.03);
  },
  fridge: (p) => {
    p.box('porcelain', 0, 0.95, -0.08, 0.85, 1.9, 0.68);
  },
  sink: (p) => {
    p.box('trim', 0, 0.42, -0.05, 0.85, 0.84, 0.7);
    p.box('porcelain', 0, 0.88, -0.05, 0.85, 0.08, 0.72);
    p.box(DARK, 0, 0.9, 0.0, 0.55, 0.03, 0.42);
    p.cyl(BRASS, 0, 1.05, -0.3, 0.02, 0.02, 0.25);
    p.box(BRASS, 0, 1.15, -0.2, 0.03, 0.03, 0.2);
  },
  pantryshelf: (p) => shelfUnit(p, 'trim', true),
  shelf: (p) => shelfUnit(p, p.zone === 'mansion' || p.zone === 'attic' ? 'trim' : 'metal', false),
  crate: (p) => {
    p.box('wood_rough', 0, 0.4, 0, 0.8, 0.8, 0.8, p.rng.next() * 0.3);
    p.box('trim', 0, 0.4, 0.405, 0.82, 0.08, 0.02);
    p.box('trim', 0, 0.4, -0.405, 0.82, 0.08, 0.02);
  },
  barrel: (p) => {
    const m = p.zone === 'mansion' || p.zone === 'attic' ? 'wood_rough' : p.rng.chance(0.5) ? 'rust' : 'metal';
    p.cyl(m, 0, 0.5, 0, 0.36, 0.33, 1.0, 14);
    p.torus(IRON, 0, 0.2, 0, 0.345, 0.015);
    p.torus(IRON, 0, 0.8, 0, 0.345, 0.015);
  },
  workbench: (p) => {
    p.box('wood_rough', 0, 0.88, -0.05, 1.9, 0.08, 0.75);
    for (const x of [-0.85, 0.85]) for (const z of [-0.35, 0.25]) p.box('trim', x, 0.42, z, 0.08, 0.84, 0.08);
    p.box('wood_rough', 0, 0.25, -0.05, 1.8, 0.04, 0.7);
    p.box(IRON, 0.75, 0.98, 0.2, 0.18, 0.12, 0.2);
    p.box('wood_planks', 0, 1.5, -0.37, 1.9, 1.0, 0.04);
    for (let i = 0; i < 5; i++) p.box(IRON, -0.7 + i * 0.32, 1.55, -0.33, 0.04, 0.3, 0.02, p.rng.next() * 0.4);
  },
  toolchest: (p) => {
    p.box(pk(0x6a1a12, 0.5, 0.4), 0, 0.5, -0.05, 0.85, 1.0, 0.65);
    for (let i = 0; i < 3; i++) p.box(DARK, 0, 0.25 + i * 0.22, 0.28, 0.75, 0.01, 0.01);
  },
  bathtub: (p) => {
    p.box('porcelain', 0, 0.35, 0, 1.8, 0.55, 0.8);
    p.box(pk(0x2a2618, 0.2, 0.2), 0, 0.6, 0, 1.6, 0.02, 0.6);
    for (const x of [-0.75, 0.75]) for (const z of [-0.3, 0.3]) p.sphere(BRASS, x, 0.05, z, 0.06);
  },
  toilet: (p) => {
    p.cyl('porcelain', 0, 0.22, 0.1, 0.18, 0.2, 0.44);
    p.box('porcelain', 0, 0.45, 0.1, 0.42, 0.06, 0.5);
    p.box('porcelain', 0, 0.75, -0.25, 0.5, 0.6, 0.2);
  },
  vanity: (p) => {
    p.box('trim', 0, 0.4, -0.1, 0.85, 0.8, 0.5);
    p.box(pk(0x0c1014, 0.05, 0.9), 0, 1.35, -0.33, 0.6, 0.8, 0.03);
    p.box('trim', 0, 1.35, -0.35, 0.7, 0.9, 0.03);
  },
  crib: (p) => {
    p.box('trim', 0, 0.35, 0, 1.6, 0.06, 0.75);
    for (let i = 0; i < 14; i++) {
      const x = -0.78 + i * 0.12;
      p.box('trim', x, 0.65, 0.36, 0.03, 0.6, 0.03);
      p.box('trim', x, 0.65, -0.36, 0.03, 0.6, 0.03);
    }
    p.box('trim', 0, 0.97, 0.36, 1.62, 0.04, 0.05);
    p.box('trim', 0, 0.97, -0.36, 1.62, 0.04, 0.05);
    p.box('sheet', 0, 0.42, 0, 1.5, 0.08, 0.66);
    p.sphere(pk(0x8a7a6a, 1), 0.4, 0.55, 0, 0.12);
  },
  toychest: (p) => {
    p.box(pk(0x5a3a3a, 0.8), 0, 0.28, -0.05, 0.85, 0.56, 0.6);
  },
  rockinghorse: (p) => {
    p.box(pk(0x6a4a30, 0.8), 0, 0.55, 0, 0.18, 0.25, 0.6);
    p.box(pk(0x6a4a30, 0.8), 0, 0.75, 0.32, 0.14, 0.3, 0.12, 0);
    p.box('trim', 0.1, 0.05, 0, 0.04, 0.06, 0.8);
    p.box('trim', -0.1, 0.05, 0, 0.04, 0.06, 0.8);
    for (const z of [-0.2, 0.2]) {
      p.box('trim', 0.1, 0.3, z, 0.04, 0.45, 0.04);
      p.box('trim', -0.1, 0.3, z, 0.04, 0.45, 0.04);
    }
  },
  trunk: (p) => {
    p.box('leather', 0, 0.33, 0, 1.6, 0.66, 0.75);
    p.box(BRASS, 0, 0.5, 0.38, 0.12, 0.12, 0.02);
    for (const x of [-0.6, 0.6]) p.box(IRON, x, 0.33, 0, 0.05, 0.68, 0.78);
  },
  sheeted: (p) => {
    p.sphere('sheet', 0, 0.55, 0, 0.45, 1.3, 10);
    p.box('sheet', 0, 0.25, 0, 0.8, 0.5, 0.8, p.rng.next());
  },
  sheeted2: (p) => {
    p.box('sheet', 0, 0.4, 0, 1.8, 0.8, 0.8);
    p.sphere('sheet', -0.4, 0.8, 0, 0.45, 0.6, 10);
    p.sphere('sheet', 0.5, 0.75, 0.1, 0.4, 0.7, 10);
  },
  mannequin: (p) => {
    p.cyl(IRON, 0, 0.02, 0, 0.2, 0.25, 0.04);
    p.cyl(IRON, 0, 0.6, 0, 0.02, 0.02, 1.0);
    p.sphere(p.rng.chance(0.5) ? 'sheet' : 'fabric', 0, 1.35, 0, 0.22, 1.7);
    p.sphere(CREAM, 0, 1.78, 0, 0.11, 1.2);
  },
  sewingmachine: (p) => {
    p.box('wood_dark', 0, 0.76, 0, 0.9, 0.05, 0.55);
    for (const x of [-0.4, 0.4]) p.box(IRON, x, 0.38, 0, 0.05, 0.76, 0.5);
    p.box(BLACK_LACQUER, 0, 0.9, 0, 0.4, 0.2, 0.18);
    p.box(BLACK_LACQUER, 0.15, 1.02, 0, 0.12, 0.25, 0.14);
  },
  elcabinet: (p) => {
    p.box('metal', 0, 1.0, -0.05, 1.9, 2.0, 0.6);
    for (let i = 0; i < 6; i++) p.cyl(CREAM, -0.7 + i * 0.28, 1.5, 0.26, 0.07, 0.07, 0.02, 12, Math.PI / 2);
    for (let i = 0; i < 8; i++) p.box(pk(i % 3 ? 0x111111 : 0x5a1010, 0.6), -0.7 + i * 0.2, 1.0, 0.26, 0.06, 0.12, 0.04);
  },
  mechpress: (p) => {
    p.box(IRON, 0, 0.1, 0, 1.8, 0.2, 1.8);
    for (const x of [-0.75, 0.75]) p.box('rust', x, 1.0, 0, 0.2, 2.0, 0.3);
    p.box('rust', 0, 1.95, 0, 1.8, 0.25, 0.4);
    p.cyl('metal', 0, 1.2, 0, 0.12, 0.12, 1.4);
    p.cyl('rust', 0.95, 1.4, 0.3, 0.45, 0.45, 0.12, 20, 0, Math.PI / 2);
    p.cyl(IRON, -0.95, 0.8, 0.3, 0.3, 0.3, 0.1, 16, 0, Math.PI / 2);
  },
  coalpile: (p) => {
    p.sphere(pk(0x0a0a0a, 0.9), 0, 0.1, 0, 0.9, 0.5, 10);
    p.sphere(pk(0x0d0d0d, 0.9), 0.3, 0.15, 0.3, 0.5, 0.6, 8);
  },
  tirestack: (p) => {
    for (let i = 0; i < 4; i++) p.torus(pk(0x0e0e0e, 0.95), (p.rng.next() - 0.5) * 0.06, 0.1 + i * 0.2, 0, 0.32, 0.1);
  },
  boiler: (p) => {
    p.cyl('rust', 0, 1.2, 0, 0.8, 0.8, 2.3, 20);
    p.sphere('rust', 0, 2.35, 0, 0.8, 0.4, 16);
    p.box(IRON, 0, 0.35, 0.75, 0.5, 0.45, 0.12);
    p.cyl(CREAM, 0.4, 1.5, 0.78, 0.1, 0.1, 0.03, 12, Math.PI / 2);
    p.cyl('metal', 0.6, 2.7, -0.4, 0.1, 0.1, 1.5);
    p.cyl('metal', -0.6, 1.6, -0.8, 0.08, 0.08, 3.2);
  },
  generator: () => {
    /* drawn by the generator mechanism view (animated) */
  },
  pump: (p) => {
    p.box(pk(0x2a4a3a, 0.6, 0.4), 0, 0.5, 0, 1.4, 1.0, 1.0);
    p.cyl('metal', 0.8, 0.7, 0, 0.25, 0.25, 0.6, 14, 0, Math.PI / 2);
    p.cyl('rust', -0.2, 1.3, 0, 0.12, 0.12, 0.8);
    p.cyl('rust', -0.2, 1.7, -0.6, 0.12, 0.12, 1.2, 10, Math.PI / 2);
  },
  niche: (p) => {
    // a recess in the wall behind iron bars: hollow, so the view out between the bars is real
    p.box('sewer_brick', 0, 1.0, -0.45, 0.9, 2.0, 0.06);
    p.box('sewer_brick', -0.45, 1.0, -0.1, 0.06, 2.0, 0.8);
    p.box('sewer_brick', 0.45, 1.0, -0.1, 0.06, 2.0, 0.8);
    p.box('sewer_brick', 0, 2.0, -0.1, 0.9, 0.06, 0.8);
    p.box('rust', 0, 2.0, 0.3, 1.0, 0.08, 0.1);
    for (let i = 0; i < 5; i++) p.box(IRON, -0.36 + i * 0.18, 1.0, 0.32, 0.03, 2.0, 0.03);
  },
  plant: (p) => {
    p.cyl(pk(0x5a3020, 0.9), 0, 0.2, 0, 0.22, 0.16, 0.4);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      p.box(pk(0x1a2410, 1), Math.cos(a) * 0.12, 0.7, Math.sin(a) * 0.12, 0.04, 0.7, 0.04, a);
    }
    p.sphere('leaves', 0, 1.1, 0, 0.32, 0.8, 8);
  },
  tree: (p) => {
    const h = 5 + p.rng.next() * 4;
    p.cyl('bark', 0, h / 2, 0, 0.18, 0.32, h, 8);
    for (let i = 0; i < 4; i++) {
      const a = p.rng.next() * Math.PI * 2;
      p.cyl('bark', Math.cos(a) * 0.6, h * (0.55 + i * 0.1), Math.sin(a) * 0.6, 0.04, 0.09, 1.8, 6, Math.cos(a) * 0.9, Math.sin(a) * 0.9);
    }
    if (p.rng.chance(0.55)) {
      p.sphere('leaves', 0, h * 0.85, 0, 1.8 + p.rng.next(), 0.8, 8);
      p.sphere('leaves', 0.8, h * 0.7, 0.4, 1.2, 0.8, 7);
    }
  },
  deadbush: (p) => {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + p.rng.next();
      p.cyl('bark', Math.cos(a) * 0.2, 0.4, Math.sin(a) * 0.2, 0.01, 0.03, 0.9, 4, Math.cos(a) * 0.6, Math.sin(a) * 0.6);
    }
    p.sphere('leaves', 0, 0.35, 0, 0.4, 0.7, 6);
  },
  grave: (p) => {
    p.box('stone', 0, 0.45, -0.25, 0.6, 0.9, 0.14, (p.rng.next() - 0.5) * 0.15);
    p.box('dirt', 0, 0.05, 0.15, 0.7, 0.1, 0.9);
  },
  well: (p) => {
    p.cyl('stone', 0, 0.45, 0, 0.9, 0.95, 0.9, 16);
    p.cyl(DARK, 0, 0.91, 0, 0.7, 0.7, 0.02, 16);
    for (const x of [-0.8, 0.8]) p.box('trim', x, 1.3, 0, 0.1, 1.8, 0.1);
    p.box('roof', 0, 2.25, 0, 2.0, 0.08, 1.2);
    p.cyl('trim', 0, 1.8, 0, 0.06, 0.06, 1.6, 8, 0, Math.PI / 2);
  },
  watertank: (p) => {
    for (const [x, z] of [
      [-0.7, -0.7],
      [0.7, -0.7],
      [-0.7, 0.7],
      [0.7, 0.7],
    ])
      p.box(IRON, x, 0.6, z, 0.1, 1.2, 0.1);
    p.cyl('rust', 0, 2.0, 0, 0.95, 0.95, 1.6, 18);
  },
  fountain: (p) => {
    p.cyl('stone', 0, 0.3, 0, 1.45, 1.5, 0.6, 20);
    p.cyl(pk(0x14180f, 0.1, 0.3), 0, 0.55, 0, 1.25, 1.25, 0.04, 20);
    p.cyl('stone', 0, 0.9, 0, 0.18, 0.25, 1.2, 10);
    p.sphere('stone', 0, 1.7, 0, 0.3, 1.4, 10);
  },
  rubble: (p) => {
    for (let i = 0; i < 6; i++) p.box('stone', (p.rng.next() - 0.5) * 1.4, 0.2 + p.rng.next() * 0.3, (p.rng.next() - 0.5) * 0.6, 0.4, 0.3, 0.35, p.rng.next() * 3);
  },
};

function shelfUnit(p: P, mat: string, pantry: boolean) {
  for (const x of [-0.93, 0.93]) p.box(mat, x, 1.0, -0.1, 0.05, 2.0, 0.5);
  for (let i = 0; i < 4; i++) {
    const y = 0.1 + i * 0.5;
    p.box(mat, 0, y, -0.1, 1.9, 0.04, 0.5);
    if (i === 3) continue;
    let x = -0.85;
    while (x < 0.8) {
      const r = p.rng.next();
      if (r < 0.3) {
        x += 0.15;
        continue;
      }
      if (pantry) {
        const hh = 0.12 + p.rng.next() * 0.12;
        p.cyl(pk(p.rng.pick([0x3a3020, 0x5a2a1a, 0x2a3a2a, 0x8a8070]), 0.4), x + 0.06, y + 0.02 + hh / 2, -0.12, 0.05, 0.05, hh, 8);
        x += 0.13;
      } else {
        const bw = 0.15 + p.rng.next() * 0.2;
        const bh = 0.1 + p.rng.next() * 0.25;
        p.box(p.rng.chance(0.5) ? 'wood_rough' : 'rust', x + bw / 2, y + 0.02 + bh / 2, -0.1, bw, bh, 0.3, (p.rng.next() - 0.5) * 0.3);
        x += bw + 0.05;
      }
    }
  }
}
