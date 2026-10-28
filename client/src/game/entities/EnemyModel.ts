/**
 * THE NOWER — original procedural character. A gaunt, hunched old man with uneven shoulders,
 * long fingers, sunken eyes and a tattered frock coat. The rig is a joint hierarchy animated
 * procedurally per AI animation state (walk with a dragged right foot, listening head-tilts,
 * lunging chase, flinching stun...).
 */
import * as THREE from 'three';
import type { EnemyAnim } from '@nower/shared';
import { plain } from '../world/textures';

function skinTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#a69b8a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${90 + Math.random() * 40},${70 + Math.random() * 30},${70 + Math.random() * 40},${0.05 + Math.random() * 0.12})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  // wrinkles and veins
  ctx.strokeStyle = 'rgba(60,45,40,0.45)';
  for (let i = 0; i < 60; i++) {
    ctx.lineWidth = 0.6 + Math.random();
    ctx.beginPath();
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 20, y + (Math.random() - 0.5) * 8, x + 40 + Math.random() * 30, y + (Math.random() - 0.5) * 10);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(70,70,110,0.25)';
  for (let i = 0; i < 25; i++) {
    ctx.beginPath();
    let x = Math.random() * 256;
    let y = Math.random() * 256;
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (Math.random() - 0.5) * 20;
      y += 8 + Math.random() * 10;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function clothTexture(base: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `rgba(30,20,10,${0.15 + Math.random() * 0.25})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 16, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Sculpted head: displaced sphere with sunken eyes, gaunt cheeks, heavy brow and long jaw. */
function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.115, 32, 24);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const front = Math.max(0, v.z / 0.115);
    // elongate downward (long face) and narrow
    if (v.y < 0) v.y *= 1.35;
    v.x *= 0.86;
    // eye sockets
    for (const ex of [-0.038, 0.038]) {
      const d = Math.hypot(v.x - ex, v.y - 0.015, (v.z - 0.1) * 0.7);
      if (d < 0.04) v.z -= (0.04 - d) * 0.9 * front;
    }
    // brow ridge
    if (v.y > 0.03 && v.y < 0.055 && front > 0.6) v.z += 0.008;
    // sunken cheeks
    const cheek = Math.hypot(Math.abs(v.x) - 0.055, v.y + 0.04);
    if (cheek < 0.035 && front > 0.3) v.z -= (0.035 - cheek) * 0.7;
    // pointed chin
    if (v.y < -0.12) v.z += (-0.12 - v.y) * 0.4 * front;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

interface Limb {
  upper: THREE.Group;
  lower: THREE.Group;
  end: THREE.Group;
}

export class EnemyModel {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private armL: Limb;
  private armR: Limb;
  private legL: Limb;
  private legR: Limb;
  private coatTail: THREE.Mesh;
  private eyes: THREE.Mesh[] = [];
  private fingersL: THREE.Group[] = [];
  private fingersR: THREE.Group[] = [];
  private phase = 0;
  private t = 0;
  private twitch = 0;
  private lookTarget = 0;
  private look = 0;
  private cur = new Map<THREE.Object3D, THREE.Euler>();

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ map: skinTexture(), roughness: 0.82, color: 0x948a7c });
    const coat = new THREE.MeshStandardMaterial({ map: clothTexture('#2a2118'), roughness: 0.95 });
    const shirt = new THREE.MeshStandardMaterial({ map: clothTexture('#8a7f62'), roughness: 0.95 });
    const trousers = new THREE.MeshStandardMaterial({ map: clothTexture('#1c1a18'), roughness: 0.95 });
    const shoe = plain(0x0c0a08, 0.5, 0.1);
    const dark = plain(0x020101, 1);
    const hair = new THREE.MeshStandardMaterial({ color: 0xbab4a8, roughness: 1, side: THREE.DoubleSide });
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const mm = new THREE.Mesh(geo, mat);
      mm.position.set(x, y, z);
      mm.rotation.set(rx, ry, rz);
      mm.castShadow = true;
      parent.add(mm);
      return mm;
    };

    this.root.add(this.hips);
    this.hips.position.y = 0.98;
    add(this.hips, new THREE.CylinderGeometry(0.15, 0.17, 0.2, 10), trousers, 0, 0, 0);
    this.hips.add(this.spine);
    this.spine.position.y = 0.08;
    add(this.spine, new THREE.CylinderGeometry(0.15, 0.16, 0.32, 10), shirt, 0, 0.16, 0);
    add(this.spine, new THREE.CylinderGeometry(0.17, 0.18, 0.34, 10), coat, 0, 0.17, -0.01);
    this.spine.add(this.chest);
    this.chest.position.y = 0.32;
    add(this.chest, new THREE.CylinderGeometry(0.2, 0.17, 0.3, 10), coat, 0, 0.12, 0, 0, 0, 0.06);
    // hunch: a bulge on the upper back
    add(this.chest, new THREE.SphereGeometry(0.15, 10, 8), coat, -0.02, 0.18, -0.08);
    // tattered collar
    add(this.chest, new THREE.TorusGeometry(0.11, 0.03, 6, 12), coat, 0, 0.29, 0.01, Math.PI / 2 - 0.2);
    this.chest.add(this.neck);
    this.neck.position.set(0, 0.3, 0.03);
    add(this.neck, new THREE.CylinderGeometry(0.045, 0.055, 0.14, 8), skin, 0, 0.06, 0);
    this.neck.add(this.head);
    this.head.position.set(0, 0.17, 0.02);
    add(this.head, headGeometry(), skin);
    // nose
    add(this.head, new THREE.ConeGeometry(0.018, 0.06, 6), skin, 0, -0.012, 0.115, Math.PI / 2 + 0.25);
    // ears
    add(this.head, new THREE.SphereGeometry(0.03, 8, 6), skin, -0.1, 0.0, 0.0).scale.set(0.35, 1.3, 0.8);
    add(this.head, new THREE.SphereGeometry(0.03, 8, 6), skin, 0.1, 0.0, 0.0).scale.set(0.35, 1.3, 0.8);
    // sunken eyes: dark sockets with tiny wet glints
    for (const ex of [-0.036, 0.036]) {
      add(this.head, new THREE.SphereGeometry(0.022, 10, 8), dark, ex, 0.014, 0.078);
      const eye = add(this.head, new THREE.SphereGeometry(0.0065, 8, 6), new THREE.MeshStandardMaterial({ color: 0x9a8a60, emissive: 0x5a3a10, emissiveIntensity: 0.9, roughness: 0.1 }), ex * 0.95, 0.012, 0.094);
      this.eyes.push(eye);
    }
    // mouth / jaw: slack, slightly open, with a few teeth
    this.head.add(this.jaw);
    this.jaw.position.set(0, -0.085, 0.06);
    add(this.jaw, new THREE.BoxGeometry(0.06, 0.012, 0.03), dark, 0, 0, 0.035);
    for (let i = 0; i < 4; i++) add(this.jaw, new THREE.BoxGeometry(0.007, 0.012, 0.006), plain(0x8a7a50, 0.5), -0.018 + i * 0.012 + (i === 2 ? 0.003 : 0), 0.009, 0.045);
    add(this.jaw, headGeometry().scale(0.6, 0.35, 0.6), skin, 0, -0.03, -0.01);
    // thin wispy hair
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 1.6 - Math.PI * 0.8;
      const len = 0.1 + Math.random() * 0.14;
      const strand = add(this.head, new THREE.PlaneGeometry(0.012, len), hair, Math.sin(a) * 0.1, 0.05 - len * 0.3, -Math.cos(a) * 0.09 - 0.01, 0.4 + Math.random() * 0.3, a, 0);
      strand.castShadow = false;
    }
    // arms (uneven shoulders: right lower)
    this.armL = this.limb(this.chest, coat, skin, -0.19, 0.26, 0.02, 0.3, 0.29, true);
    this.armR = this.limb(this.chest, coat, skin, 0.19, 0.2, 0.02, 0.31, 0.3, true);
    this.fingersL = this.hand(this.armL.end, skin, -1);
    this.fingersR = this.hand(this.armR.end, skin, 1);
    // legs
    this.legL = this.limb(this.hips, trousers, shoe, -0.09, -0.06, 0, 0.45, 0.45, false);
    this.legR = this.limb(this.hips, trousers, shoe, 0.09, -0.06, 0, 0.45, 0.45, false);
    // long tattered coat tail
    const tail = new THREE.CylinderGeometry(0.2, 0.3, 0.75, 12, 4, true);
    const tp = tail.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) if (tp.getY(i) < -0.3) tp.setY(i, tp.getY(i) - Math.random() * 0.12);
    tail.computeVertexNormals();
    const coatSide = coat.clone();
    coatSide.side = THREE.DoubleSide;
    this.coatTail = add(this.hips, tail, coatSide, 0, -0.32, -0.02);
    this.root.traverse((o) => (o.frustumCulled = false));
  }

  private limb(parent: THREE.Object3D, mat: THREE.Material, endMat: THREE.Material, x: number, y: number, z: number, l1: number, l2: number, arm: boolean): Limb {
    const upper = new THREE.Group();
    upper.position.set(x, y, z);
    parent.add(upper);
    const r = arm ? 0.045 : 0.07;
    const m1 = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, l1, 8), mat);
    m1.position.y = -l1 / 2;
    m1.castShadow = true;
    upper.add(m1);
    const lower = new THREE.Group();
    lower.position.y = -l1;
    upper.add(lower);
    const m2 = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * (arm ? 0.55 : 0.7), l2, 8), arm ? mat : mat);
    m2.position.y = -l2 / 2;
    m2.castShadow = true;
    lower.add(m2);
    const end = new THREE.Group();
    end.position.y = -l2;
    lower.add(end);
    if (!arm) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.26), endMat);
      foot.position.set(0, -0.03, 0.06);
      foot.castShadow = true;
      end.add(foot);
    } else {
      const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.06, 8), endMat);
      wrist.position.y = -0.02;
      end.add(wrist);
    }
    return { upper, lower, end };
  }

  /** Hands with abnormally long, jointed fingers. */
  private hand(parent: THREE.Object3D, skin: THREE.Material, side: number): THREE.Group[] {
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.025), skin);
    palm.position.y = -0.08;
    parent.add(palm);
    const fingers: THREE.Group[] = [];
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Group();
      const thumb = i === 4;
      f.position.set(thumb ? side * 0.04 : -0.027 + i * 0.018, thumb ? -0.07 : -0.12, 0);
      if (thumb) f.rotation.z = side * 0.6;
      const len = thumb ? 0.08 : 0.15 + (i === 1 || i === 2 ? 0.03 : 0);
      const seg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.007, len * 0.55, 5), skin);
      seg1.position.y = -len * 0.275;
      f.add(seg1);
      const j = new THREE.Group();
      j.position.y = -len * 0.55;
      const seg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.0068, 0.004, len * 0.45, 5), skin);
      seg2.position.y = -len * 0.225;
      j.add(seg2);
      // yellowed nail
      const nail = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.02, 4), plain(0x8a7a4a, 0.4));
      nail.position.y = -len * 0.45 - 0.008;
      nail.rotation.x = Math.PI;
      j.add(nail);
      f.add(j);
      parent.add(f);
      fingers.push(f);
    }
    return fingers;
  }

  /** Smoothly drive a joint towards a target rotation. */
  private pose(o: THREE.Object3D, x: number, y: number, z: number, k: number) {
    o.rotation.x += (x - o.rotation.x) * k;
    o.rotation.y += (y - o.rotation.y) * k;
    o.rotation.z += (z - o.rotation.z) * k;
  }

  update(dt: number, anim: EnemyAnim, speed: number) {
    this.t += dt;
    const k = Math.min(1, dt * 8);
    const moving = speed > 0.1 && (anim === 'walk' || anim === 'investigate' || anim === 'chase');
    const chase = anim === 'chase';
    const stride = chase ? 1.5 : 1.0;
    this.phase += dt * (moving ? speed * (chase ? 2.1 : 2.6) : 0);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    // occasional nervous twitch of the head
    this.twitch = Math.max(0, this.twitch - dt * 4);
    if (Math.random() < dt * (chase ? 1.5 : 0.35)) this.twitch = 1;
    // look direction wanders
    if (Math.random() < dt * 0.6) this.lookTarget = (Math.random() - 0.5) * (anim === 'look' ? 2.2 : 0.8);
    this.look += (this.lookTarget - this.look) * Math.min(1, dt * (anim === 'look' ? 2.5 : 1.2));

    // spine hunch
    const hunch = chase ? 0.55 : anim === 'searchHide' ? 0.9 : anim === 'attack' ? 0.6 : 0.32;
    const breathe = Math.sin(this.t * 1.7) * 0.02;
    this.pose(this.spine, hunch * 0.5 + breathe, 0, 0.05 + (moving ? s * 0.04 : 0), k);
    this.pose(this.chest, hunch * 0.5 - breathe, moving ? s * 0.12 : 0, 0.08, k);
    // head
    let hx = -0.25 - hunch * 0.3;
    let hy = this.look;
    let hz = this.twitch * 0.25 * Math.sin(this.t * 40);
    if (anim === 'listen') {
      hz = 0.45;
      hy = 0.3;
      hx = -0.1;
    }
    if (anim === 'react') {
      hx = -0.5;
      hz = 0.3 * Math.sin(this.t * 30);
    }
    if (chase) hy = Math.sin(this.t * 7) * 0.08;
    this.pose(this.neck, hx * 0.5, hy * 0.4, hz * 0.5, k);
    this.pose(this.head, hx * 0.5, hy * 0.6, hz * 0.5, k);
    const jawOpen = anim === 'attack' ? 0.5 : chase ? 0.25 + Math.abs(s) * 0.15 : 0.08 + Math.sin(this.t * 0.7) * 0.04;
    this.pose(this.jaw, jawOpen, 0, 0, k);
    // legs: the right foot drags (shorter, lagging swing)
    if (moving) {
      this.pose(this.legL.upper, -s * 0.55 * stride, 0, -0.04, 0.6);
      this.pose(this.legL.lower, Math.max(0, c) * 0.8 * stride, 0, 0, 0.6);
      this.pose(this.legR.upper, s * 0.32 * stride, 0.15, 0.06, 0.6);
      this.pose(this.legR.lower, Math.max(0, -c) * 0.35 * stride, 0, 0, 0.6);
      this.hips.position.y = 0.96 + Math.abs(c) * 0.03 - (s > 0 ? 0.03 : 0);
      this.hips.rotation.z = s * 0.06;
    } else {
      const sway = Math.sin(this.t * 0.9) * 0.03;
      this.pose(this.legL.upper, anim === 'searchHide' ? -0.4 : 0, 0, -0.04, k);
      this.pose(this.legL.lower, anim === 'searchHide' ? 0.7 : 0.05, 0, 0, k);
      this.pose(this.legR.upper, anim === 'stunned' ? 0.3 : 0.08, 0.15, 0.06, k);
      this.pose(this.legR.lower, 0.1, 0, 0, k);
      this.hips.position.y += ((anim === 'searchHide' ? 0.82 : 0.97) - this.hips.position.y) * k;
      this.hips.rotation.z = sway;
    }
    // arms
    const armTarget = (side: number): [number, number, number, number] => {
      switch (anim) {
        case 'chase':
          return [-1.3 + s * side * 0.3, 0, side * 0.15, -0.5];
        case 'attack':
          return [-1.6, 0, side * 0.05, -0.2];
        case 'door':
          return side > 0 ? [-1.3, 0, 0.1, -0.3] : [0.1, 0, -0.1, -0.2];
        case 'searchHide':
          return [-1.1, 0, side * 0.25, -0.6];
        case 'listen':
          return side > 0 ? [-0.4, 0, 0.9, -2.2] : [0.15, 0, -0.1, -0.2];
        case 'stunned':
          return [-2.2 + Math.sin(this.t * 12) * 0.1, 0, side * -0.5, -1.9];
        case 'climb':
          return [-2.6 + Math.sin(this.t * 4 + side) * 0.4, 0, side * 0.2, -0.6];
        case 'investigate':
          return side > 0 ? [-0.5 + s * 0.2, 0, 0.15, -0.6] : [s * -0.25, 0, -0.12, -0.3];
        default:
          return [moving ? -0.25 - s * side * 0.3 : -0.3, 0, side * -0.02, moving ? -0.45 : -0.55];
      }
    };
    const [lx, ly, lz, le] = armTarget(-1);
    const [rx, ry, rz, re] = armTarget(1);
    this.pose(this.armL.upper, lx, ly, lz, k);
    this.pose(this.armL.lower, le, 0, 0, k);
    this.pose(this.armR.upper, rx, ry, rz, k);
    this.pose(this.armR.lower, re, 0, 0, k);
    // fingers curl and twitch independently
    const curl = anim === 'attack' || chase ? 0.5 : 0.25;
    [...this.fingersL, ...this.fingersR].forEach((f, i) => {
      const tw = Math.sin(this.t * (3 + i * 0.7) + i) * 0.12;
      f.rotation.x = curl + tw;
      (f.children[1] as THREE.Object3D).rotation.x = curl * 1.2 + tw;
    });
    // coat sways
    this.coatTail.rotation.x = (moving ? -0.12 * Math.min(1, speed / 2) : 0) + Math.sin(this.t * 1.3) * 0.03;
    // eyes catch light
    for (const e of this.eyes) ((e.material as THREE.MeshStandardMaterial).emissiveIntensity = chase || anim === 'attack' ? 2.4 : 0.9);
    if (anim === 'stunned') this.root.rotation.z = Math.sin(this.t * 6) * 0.05;
    else this.root.rotation.z = 0;
    void this.cur;
  }
}
