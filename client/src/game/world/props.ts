/** Decorative set dressing, light fixtures and the world beyond the walls. */
import * as THREE from 'three';
import { CT, F, Rng, hashString, type Level, type LightDef } from '@nower/shared';
import { MeshBuilder, pk, registerMat } from './MeshBuilder';
import { getMat, portrait } from './textures';

const BRASS = pk(0x8a6a2a, 0.35, 0.8);
const IRON = pk(0x1e1e1e, 0.5, 0.7);

function alphaTexture(draw: (c: CanvasRenderingContext2D, s: number) => void, size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let registered = false;
function registerPropMats() {
  if (registered) return;
  registered = true;
  for (let i = 0; i < 6; i++) registerMat(`portrait_${i}`, new THREE.MeshStandardMaterial({ map: portrait(i), roughness: 0.7 }));
  const web = alphaTexture((c, s) => {
    c.strokeStyle = 'rgba(220,220,210,0.55)';
    c.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 0.5;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      c.stroke();
    }
    for (let r = 20; r < s; r += 22) {
      c.beginPath();
      c.arc(0, 0, r + Math.random() * 6, 0, Math.PI / 2);
      c.stroke();
    }
  });
  registerMat('cobweb', new THREE.MeshBasicMaterial({ map: web, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.6 }));
  const stain = alphaTexture((c, s) => {
    for (let i = 0; i < 14; i++) {
      const x = s / 2 + (Math.random() - 0.5) * s * 0.5;
      const y = s / 2 + (Math.random() - 0.5) * s * 0.5;
      const r = 10 + Math.random() * s * 0.25;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(40,6,4,0.75)');
      g.addColorStop(1, 'rgba(20,4,2,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    }
  });
  registerMat('stain', new THREE.MeshStandardMaterial({ map: stain, transparent: true, depthWrite: false, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }));
  const drawing = alphaTexture((c, s) => {
    c.fillStyle = '#cfc6b0';
    c.fillRect(0, 0, s, s);
    c.strokeStyle = '#222';
    c.lineWidth = 4;
    // a stick figure with very long fingers next to a house
    c.beginPath();
    c.arc(s * 0.35, s * 0.3, 18, 0, Math.PI * 2);
    c.moveTo(s * 0.35, s * 0.36);
    c.lineTo(s * 0.35, s * 0.65);
    c.moveTo(s * 0.35, s * 0.45);
    c.lineTo(s * 0.12, s * 0.55);
    c.moveTo(s * 0.35, s * 0.45);
    c.lineTo(s * 0.58, s * 0.55);
    for (let i = 0; i < 4; i++) {
      c.moveTo(s * 0.58, s * 0.55);
      c.lineTo(s * 0.7, s * (0.48 + i * 0.04));
    }
    c.moveTo(s * 0.35, s * 0.65);
    c.lineTo(s * 0.25, s * 0.85);
    c.moveTo(s * 0.35, s * 0.65);
    c.lineTo(s * 0.45, s * 0.85);
    c.stroke();
    c.strokeStyle = '#7a1010';
    c.strokeRect(s * 0.62, s * 0.62, s * 0.3, s * 0.25);
    c.fillStyle = '#7a1010';
    c.font = 'bold 26px sans-serif';
    c.fillText('NOW', s * 0.6, s * 0.15);
  });
  registerMat('drawing', new THREE.MeshStandardMaterial({ map: drawing, roughness: 1 }));
  registerMat('bulb_on', new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb060, emissiveIntensity: 2.4 }));
  registerMat('bulb_off', new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.3 }));
  registerMat('tube_on', new THREE.MeshStandardMaterial({ color: 0xe0f0ff, emissive: 0xc8e4ff, emissiveIntensity: 2.0 }));
  registerMat('green_on', new THREE.MeshStandardMaterial({ color: 0xb0ffc0, emissive: 0x80ff90, emissiveIntensity: 1.6 }));
  registerMat('shade', new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x3a1a00, emissiveIntensity: 0.3 }));
}

/** Free wall cells beside a room, for hanging things. */
function wallSpots(level: Level, ri: number) {
  const room = level.rooms[ri];
  const g = level.floors[room.spec.f];
  const W = level.W;
  const out: { x: number; z: number; nx: number; nz: number }[] = [];
  for (let k = 0; k < W * level.D; k++) {
    if (g.room[k] !== ri || g.type[k] !== CT.FLOOR || g.flags[k] & F.FURN) continue;
    const x = k % W;
    const z = (k / W) | 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nk = (z + dz) * W + (x + dx);
      if (g.type[nk] === CT.SOLID && !(g.flags[nk] & F.WINDOW)) out.push({ x, z, nx: dx, nz: dz });
    }
  }
  return out;
}

export function buildDecor(level: Level, mb: MeshBuilder) {
  registerPropMats();
  for (const room of level.rooms) {
    const spec = room.spec;
    if (spec.outdoor || spec.escape) continue;
    const rng = new Rng(hashString('decor-' + spec.id));
    const g = level.floors[spec.f];
    const base = g.base;
    const f = spec.f;
    const spots = rng.shuffle(wallSpots(level, room.index));
    const mansion = spec.zone === 'mansion';

    // paintings
    const nPaint = mansion ? Math.min(spots.length, 1 + rng.int(0, 2) + (room.cells > 120 ? 2 : 0)) : 0;
    for (let i = 0; i < nPaint; i++) {
      const s = spots[i];
      const wx = s.x + 0.5 + s.nx * 0.5;
      const wz = s.z + 0.5 + s.nz * 0.5;
      const rot = Math.atan2(-s.nx, -s.nz);
      const m = new THREE.Matrix4().makeRotationY(rot).setPosition(wx - s.nx * 0.03, base + 1.75, wz - s.nz * 0.03);
      const sx = 0.6 + rng.next() * 0.3;
      mb.boxM('trim', f, m, sx + 0.12, sx * 1.25 + 0.12, 0.05);
      const pm = new THREE.Matrix4().makeRotationY(rot).setPosition(wx - s.nx * 0.06, base + 1.75, wz - s.nz * 0.06);
      const plane = new THREE.PlaneGeometry(sx, sx * 1.25);
      mb.geom(`portrait_${rng.int(0, 5)}`, f, plane, pm);
      plane.dispose();
    }
    // trophy heads
    if (spec.id === 'trophy')
      for (let i = nPaint; i < Math.min(spots.length, nPaint + 5); i++) {
        const s = spots[i];
        const rot = Math.atan2(-s.nx, -s.nz);
        const wx = s.x + 0.5 + s.nx * 0.42;
        const wz = s.z + 0.5 + s.nz * 0.42;
        const m = (dx: number, dy: number, dz: number) => new THREE.Matrix4().makeRotationY(rot).setPosition(wx + dx, base + 1.9 + dy, wz + dz);
        mb.boxM('trim', f, m(0, 0, 0), 0.4, 0.5, 0.06);
        mb.boxM(pk(0x4a3626, 1), f, m(-s.nx * 0.18, -0.05, -s.nz * 0.18), 0.22, 0.25, 0.35);
        mb.boxM(pk(0xcbbf9f, 0.6), f, m(-s.nx * 0.18 + 0.15, 0.3, -s.nz * 0.18), 0.04, 0.4, 0.04);
        mb.boxM(pk(0xcbbf9f, 0.6), f, m(-s.nx * 0.18 - 0.15, 0.3, -s.nz * 0.18), 0.04, 0.4, 0.04);
      }
    // children's drawings
    if (spec.id === 'children' || spec.id === 'westbed')
      for (let i = nPaint; i < Math.min(spots.length, nPaint + 3); i++) {
        const s = spots[i];
        const rot = Math.atan2(-s.nx, -s.nz);
        const pm = new THREE.Matrix4().makeRotationY(rot).multiply(new THREE.Matrix4().makeRotationZ((rng.next() - 0.5) * 0.3));
        pm.setPosition(s.x + 0.5 + s.nx * 0.47, base + 1.2 + rng.next() * 0.4, s.z + 0.5 + s.nz * 0.47);
        const plane = new THREE.PlaneGeometry(0.42, 0.42);
        mb.geom('drawing', f, plane, pm);
        plane.dispose();
      }
    // rugs
    if (mansion && rng.chance(0.55) && room.cells > 30) {
      const cx = room.center[0];
      const cz = room.center[2];
      const ck = Math.floor(cz) * level.W + Math.floor(cx);
      if (g.type[ck] === CT.FLOOR) mb.hquad(spec.floor.startsWith('carpet') ? 'runner' : 'carpet_red', f, cx - 1.6, cz - 1.1, cx + 1.6, cz + 1.1, base + 0.006, true);
    }
    // runner carpet down corridors
    if (spec.runner) {
      const r = spec.rects[0];
      const midZ = (r[1] + r[3] + 1) / 2;
      mb.hquad('runner', f, r[0] + 0.4, midZ - 0.7, r[2] + 0.6, midZ + 0.7, base + 0.006, true);
    }
    // stains on floors
    const nStain = spec.zone === 'basement' || spec.zone === 'sewer' ? 3 : 1 + rng.int(0, 1);
    for (let i = 0; i < nStain; i++) {
      const x = spec.rects[0][0] + rng.next() * (spec.rects[0][2] - spec.rects[0][0] + 1);
      const z = spec.rects[0][1] + rng.next() * (spec.rects[0][3] - spec.rects[0][1] + 1);
      const k = Math.floor(z) * level.W + Math.floor(x);
      if (g.type[k] !== CT.FLOOR || g.flags[k] & F.SHALLOW) continue;
      const sz = 0.6 + rng.next() * 1.4;
      mb.hquad('stain', f, x - sz / 2, z - sz / 2, x + sz / 2, z + sz / 2, base + 0.012 + i * 0.001, true);
    }
    // papers on the floor
    for (let i = 0; i < (mansion ? 3 : 1); i++) {
      const x = spec.rects[0][0] + 0.3 + rng.next() * (spec.rects[0][2] - spec.rects[0][0]);
      const z = spec.rects[0][1] + 0.3 + rng.next() * (spec.rects[0][3] - spec.rects[0][1]);
      const k = Math.floor(z) * level.W + Math.floor(x);
      if (g.type[k] !== CT.FLOOR) continue;
      const m = new THREE.Matrix4().makeRotationY(rng.next() * 6).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).setPosition(x, base + 0.015, z);
      const plane = new THREE.PlaneGeometry(0.21, 0.29);
      mb.geom('paper', f, plane, m);
      plane.dispose();
    }
    // cobwebs in ceiling corners
    if (spec.zone !== 'garden') {
      const corners = spots.filter((s) => s.nx !== 0).slice(0, spec.zone === 'attic' || spec.zone === 'basement' || spec.id === 'hidden' ? 4 : 2);
      for (const s of corners) {
        const y = base + g.ceilH - 0.02;
        const m = new THREE.Matrix4()
          .makeRotationY(s.nx > 0 ? Math.PI : 0)
          .multiply(new THREE.Matrix4().makeRotationZ(Math.PI))
          .setPosition(s.x + 0.5 + s.nx * 0.49, y, s.z + 0.5);
        const plane = new THREE.PlaneGeometry(0.9, 0.9);
        plane.translate(0.45, 0.45, 0);
        mb.geom('cobweb', f, plane, m);
        plane.dispose();
      }
    }
    // pipes along basement and sewer ceilings
    if (spec.zone === 'basement' || spec.zone === 'sewer') {
      const r = spec.rects[0];
      const alongX = r[2] - r[0] >= r[3] - r[1];
      const y = base + g.ceilH - 0.25;
      const len = alongX ? r[2] - r[0] + 1 : r[3] - r[1] + 1;
      const pipe = new THREE.CylinderGeometry(0.08, 0.08, len, 8);
      const m = alongX
        ? new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition((r[0] + r[2] + 1) / 2, y, r[1] + 0.35)
        : new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(r[0] + 0.35, y, (r[1] + r[3] + 1) / 2);
      mb.geom('rust', f, pipe, m);
      pipe.dispose();
    }
    // chains and hooks in the holding cells
    if (spec.id === 'holding') {
      for (let i = 0; i < 6; i++) {
        const x = 34.4 + (i % 3) * 1.2;
        const z = 30.6 + Math.floor(i / 3) * 3;
        for (let l = 0; l < 8; l++) mb.box(IRON, x, base + g.ceilH - 0.1 - l * 0.12, z, 0.04, 0.1, 0.02, l % 2 ? Math.PI / 2 : 0);
      }
    }
  }
}

/** Light fixture meshes (merged, emissive when the light works). */
export function buildFixtures(level: Level, mb: MeshBuilder) {
  registerPropMats();
  for (const l of level.lights) fixture(mb, l);
}

function fixture(mb: MeshBuilder, l: LightDef) {
  const [x, y, z] = l.pos;
  const f = l.f;
  const bulb = l.on ? (l.kind === 'fluoro' ? 'tube_on' : l.kind === 'sewer' ? 'green_on' : 'bulb_on') : 'bulb_off';
  const g = new THREE.CylinderGeometry(0.008, 0.008, 1, 4);
  const bx = (mat: string, px: number, py: number, pz: number, sx: number, sy: number, sz: number, r = 0): void => mb.box(mat, f, px, py, pz, sx, sy, sz, r);
  const cord = (top: number) => {
    const m = new THREE.Matrix4().makeScale(1, top - y, 1).setPosition(x, (top + y) / 2, z);
    mb.geom(IRON, f, g, m);
  };
  switch (l.kind) {
    case 'chandelier': {
      const ring = new THREE.TorusGeometry(0.55, 0.03, 6, 20);
      mb.geom(BRASS, f, ring, new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, y, z));
      ring.dispose();
      cord(y + 1.0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        bx(pk(0xd8d0c0, 0.6), x + Math.cos(a) * 0.55, y + 0.1, z + Math.sin(a) * 0.55, 0.035, 0.18, 0.035);
        bx(bulb, x + Math.cos(a) * 0.55, y + 0.22, z + Math.sin(a) * 0.55, 0.03, 0.06, 0.03);
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        bx(BRASS, x + Math.cos(a) * 0.28, y + 0.3, z + Math.sin(a) * 0.28, 0.02, 0.6, 0.02, a);
      }
      break;
    }
    case 'lamp': {
      cord(y + 0.5);
      const shade = new THREE.CylinderGeometry(0.12, 0.3, 0.25, 12, 1, true);
      mb.geom('shade', f, shade, new THREE.Matrix4().setPosition(x, y + 0.05, z));
      shade.dispose();
      bx(bulb, x, y - 0.02, z, 0.08, 0.1, 0.08);
      break;
    }
    case 'bulbs': {
      cord(y + 0.45);
      const s = new THREE.SphereGeometry(0.06, 8, 6);
      mb.geom(bulb, f, s, new THREE.Matrix4().setPosition(x, y, z));
      s.dispose();
      break;
    }
    case 'fluoro':
      bx(IRON, x, y + 0.05, z, 1.3, 0.05, 0.16);
      bx(bulb, x, y, z, 1.2, 0.05, 0.06);
      break;
    case 'sewer':
      bx(IRON, x, y, z, 0.22, 0.28, 0.22);
      bx(bulb, x, y, z, 0.14, 0.18, 0.14);
      break;
    case 'sconces': {
      const side = l.pos[2] % 1 < 0.2 ? 1 : 0;
      void side;
      bx(BRASS, x, y - 0.1, z, 0.08, 0.25, 0.08);
      bx(bulb, x, y + 0.08, z, 0.06, 0.1, 0.06);
      break;
    }
    case 'lantern':
      bx(IRON, x, y - 1.1, z, 0.1, 2.2, 0.1);
      bx(IRON, x, y + 0.05, z, 0.28, 0.4, 0.28);
      bx(bulb, x, y + 0.05, z, 0.2, 0.3, 0.2);
      break;
  }
  g.dispose();
}

/** Sky dome, moon, stars, the land around the estate, forest, road and gates. */
export function buildEnvironment(level: Level): THREE.Group {
  registerPropMats();
  const group = new THREE.Group();
  // sky
  const skyGeo = new THREE.SphereGeometry(420, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { flash: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform float flash; varying vec3 vP; void main(){ float h = clamp(vP.y, -0.1, 1.0); vec3 top = vec3(0.004,0.006,0.012); vec3 hor = vec3(0.035,0.04,0.055); vec3 c = mix(hor, top, smoothstep(0.0, 0.5, h)); c += flash * vec3(0.35,0.38,0.45) * (1.0 - h*0.6); gl_FragColor = vec4(c,1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  group.add(sky);
  // moon
  const moonTex = alphaTexture((c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(220,225,235,1)');
    g.addColorStop(0.32, 'rgba(200,205,220,1)');
    g.addColorStop(0.36, 'rgba(120,130,160,0.35)');
    g.addColorStop(1, 'rgba(40,50,80,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false }));
  moon.position.set(-160, 190, -240);
  moon.lookAt(48, 0, 40);
  group.add(moon);
  // stars
  const starPos: number[] = [];
  const rng = new Rng(77);
  for (let i = 0; i < 900; i++) {
    const a = rng.next() * Math.PI * 2;
    const e = 0.15 + rng.next() * 1.3;
    starPos.push(Math.cos(a) * Math.cos(e) * 400, Math.sin(e) * 400, Math.sin(a) * Math.cos(e) * 400);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8a90a0, size: 1.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.55 }));
  stars.frustumCulled = false;
  group.add(stars);

  // land outside the property (with a hole for the estate and the sewer outfall pit)
  const outer = new THREE.Shape([new THREE.Vector2(-150, -150), new THREE.Vector2(250, -150), new THREE.Vector2(250, 250), new THREE.Vector2(-150, 250)]);
  outer.holes.push(new THREE.Path([new THREE.Vector2(4, 3), new THREE.Vector2(4, 88), new THREE.Vector2(92, 88), new THREE.Vector2(92, 3), new THREE.Vector2(17, 3), new THREE.Vector2(17, -0.2), new THREE.Vector2(6, -0.2), new THREE.Vector2(6, 3)]));
  const landGeo = new THREE.ShapeGeometry(outer);
  landGeo.rotateX(Math.PI / 2);
  const uv = landGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
  const land = new THREE.Mesh(landGeo, getMat('grass'));
  land.position.y = -0.01;
  land.receiveShadow = true;
  group.add(land);
  // road continues beyond the property
  const road = new THREE.Mesh(new THREE.PlaneGeometry(400, 5.6), getMat('asphalt'));
  road.rotation.x = -Math.PI / 2;
  road.position.set(48, 0.01, 84);
  const ruv = road.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * 100, ruv.getY(i) * 1.4);
  group.add(road);

  // forest ring (instanced)
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.4, 9, 6);
  trunkGeo.translate(0, 4.5, 0);
  const crownGeo = new THREE.ConeGeometry(2.6, 7, 7);
  crownGeo.translate(0, 9, 0);
  const n = 520;
  const trunks = new THREE.InstancedMesh(trunkGeo, getMat('bark'), n);
  const crowns = new THREE.InstancedMesh(crownGeo, getMat('leaves'), n);
  const m = new THREE.Matrix4();
  let c = 0;
  for (let i = 0; i < 4000 && c < n; i++) {
    const x = -70 + rng.next() * 236;
    const z = -70 + rng.next() * 200;
    const inside = x > 1 && x < 95 && z > -1 && z < 90;
    const onRoad = z > 79 && z < 90;
    if (inside || onRoad) continue;
    const s = 0.7 + rng.next() * 0.8;
    m.makeRotationY(rng.next() * 6).scale(new THREE.Vector3(s, s * (0.8 + rng.next() * 0.6), s)).setPosition(x, 0, z);
    trunks.setMatrixAt(c, m);
    crowns.setMatrixAt(c, m);
    c++;
  }
  trunks.count = crowns.count = c;
  group.add(trunks, crowns);

  // front gate pillars and the open wrought-iron gate
  const mb = new MeshBuilder();
  for (const x of [46.6, 50.4]) {
    mb.box('stone', 2, x, 1.4, 80.5, 0.7, 2.8, 0.7);
    mb.box('stone', 2, x, 2.9, 80.5, 0.85, 0.2, 0.85);
    const s = new THREE.SphereGeometry(0.25, 8, 6);
    mb.geom('stone', 2, s, new THREE.Matrix4().setPosition(x, 3.2, 80.5));
    s.dispose();
  }
  for (const [x, rot] of [
    [46.9, -1.9],
    [50.1, 1.9],
  ] as const) {
    for (let i = 0; i < 8; i++) {
      const off = 0.1 + i * 0.18;
      const px = x + Math.cos(rot) * off;
      const pz = 80.5 + Math.sin(rot) * off;
      mb.box(IRON, 2, px, 1.2, pz, 0.04, 2.4, 0.04);
    }
  }
  // distant lamp post on the road
  mb.box(IRON, 2, 30, 2.5, 87.5, 0.15, 5, 0.15);
  mb.box(IRON, 2, 30, 5, 87.5, 0.6, 0.3, 0.6);
  group.add(mb.build());

  void level;
  return group;
}

/** Falling rain around the camera (only shown outdoors). */
export class Rain {
  readonly obj: THREE.LineSegments;
  private pos: Float32Array;
  private readonly n = 1400;
  constructor() {
    this.pos = new Float32Array(this.n * 6);
    for (let i = 0; i < this.n; i++) this.reset(i, Math.random() * 20);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8a96a8, transparent: true, opacity: 0.28, fog: true }));
    this.obj.frustumCulled = false;
  }
  private reset(i: number, y: number) {
    const x = (Math.random() - 0.5) * 30;
    const z = (Math.random() - 0.5) * 30;
    this.pos.set([x, y, z, x + 0.03, y + 0.55, z + 0.02], i * 6);
  }
  update(dt: number, center: THREE.Vector3, visible: boolean) {
    this.obj.visible = visible;
    if (!visible) return;
    this.obj.position.set(center.x, center.y - 8, center.z);
    for (let i = 0; i < this.n; i++) {
      const o = i * 6;
      this.pos[o + 1] -= dt * 16;
      this.pos[o + 4] -= dt * 16;
      if (this.pos[o + 1] < 0) this.reset(i, 18 + Math.random() * 3);
    }
    (this.obj.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
