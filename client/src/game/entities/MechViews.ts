/** Visuals for puzzle mechanisms; each reflects the replicated MechStates. */
import * as THREE from 'three';
import type { Level, MechStates } from '@nower/shared';
import { getMat, plain, textTexture } from '../world/textures';

function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function cyl(parent: THREE.Object3D, r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, 0, rz);
  parent.add(m);
  return m;
}
const led = (on: boolean, color: number) => new THREE.MeshStandardMaterial({ color, emissive: on ? color : 0x000000, emissiveIntensity: on ? 2 : 0 });

export class MechViews {
  readonly obj = new THREE.Group();
  private front: Record<string, THREE.Object3D> = {};
  private panelLed!: THREE.Mesh;
  private panelScreen!: THREE.Mesh;
  private winchHandle!: THREE.Object3D;
  private winchDrum!: THREE.Object3D;
  private fuse!: THREE.Object3D;
  private fuseLed!: THREE.Mesh;
  private flywheel!: THREE.Object3D;
  private genBody!: THREE.Object3D;
  private boltsHead: THREE.Object3D[] = [];
  private pumpLed!: THREE.Mesh;
  private pumpLever!: THREE.Object3D;
  private valveWheels: THREE.Object3D[] = [];
  private valveHandles: THREE.Object3D[] = [];
  private gauge!: THREE.Object3D;
  private needle!: THREE.Object3D;
  private floodKey!: THREE.Object3D;
  private floodLed!: THREE.Mesh;
  private wheel!: THREE.Object3D;
  private s: MechStates | null = null;
  private t = 0;
  wheelSpin = 0;
  winchSpin = 0;

  constructor(
    private level: Level,
    panelSymbols: string[],
    private valveWeights: number[],
    private valveTarget: number,
  ) {
    const at = (id: string) => level.mechs[level.mechById.get(id)!].spec;
    const iron = plain(0x2a2826, 0.55, 0.7);
    const brass = plain(0x8a6a2a, 0.35, 0.8);
    const rust = getMat('rust');

    // --- front door: four visible locks on the inside face of the door
    const fd = new THREE.Group();
    fd.position.set(49, 0, 55.88);
    this.obj.add(fd);
    this.front.keyLock = box(fd, 0.18, 0.26, 0.06, brass, 0.35, 1.05, 0);
    const chain = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 10), plain(0x5a5a58, 0.4, 0.9));
      link.position.set(-0.45 + i * 0.13, 1.35, 0);
      link.rotation.y = i % 2 ? Math.PI / 2 : 0;
      chain.add(link);
    }
    box(chain, 0.1, 0.13, 0.05, brass, 0, 1.25, 0.02);
    fd.add(chain);
    this.front.padlock = chain;
    const mag = new THREE.Group();
    box(mag, 0.4, 0.12, 0.1, iron, 0, 1.8, 0);
    this.front.magLed = box(mag, 0.03, 0.03, 0.02, led(true, 0xff2010), 0.15, 1.8, 0.06);
    fd.add(mag);
    this.front.mag = mag;
    this.front.bar = box(fd, 2.3, 0.14, 0.1, rust, 0, 1.15, -0.04);
    for (const x of [-1.15, 1.15]) box(fd, 0.12, 0.25, 0.14, iron, x, 1.15, -0.02);

    // --- security panel with symbol screen
    const sp = at('security_panel');
    const panel = new THREE.Group();
    panel.position.set(sp.pos[0], sp.pos[1], sp.pos[2] + 0.02);
    panel.rotation.y = Math.PI;
    box(panel, 0.3, 0.42, 0.06, iron);
    this.panelScreen = box(panel, 0.24, 0.1, 0.01, new THREE.MeshStandardMaterial({ map: textTexture([panelSymbols.join(' ')], { w: 256, h: 96, bg: '#060a06', fg: '#3aff6a', font: 'bold 52px serif' }), emissive: 0x000000 }), 0, 0.12, -0.035);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) box(panel, 0.05, 0.04, 0.015, plain(0x8a8a80, 0.6, 0.4), -0.065 + c * 0.065, 0.0 - r * 0.05, -0.035);
    this.panelLed = box(panel, 0.025, 0.025, 0.01, led(false, 0x30ff60), 0.11, 0.18, -0.035);
    this.obj.add(panel);

    // --- winch beside the door
    const wp = at('winch');
    const winch = new THREE.Group();
    winch.position.set(wp.pos[0], wp.pos[1], wp.pos[2] + 0.05);
    box(winch, 0.4, 0.5, 0.14, iron);
    this.winchDrum = cyl(winch, 0.12, 0.3, rust, 0, 0, -0.12, 0, Math.PI / 2);
    this.winchHandle = new THREE.Group();
    box(this.winchHandle, 0.3, 0.025, 0.03, plain(0x3a3a3a, 0.6, 0.7), 0.15, 0, 0);
    cyl(this.winchHandle, 0.015, 0.1, plain(0x3a2010, 0.8), 0.3, 0, -0.05, Math.PI / 2);
    this.winchHandle.position.set(0, 0, -0.22);
    winch.add(this.winchHandle);
    // chain up to the bar
    box(winch, 0.03, 0.6, 0.03, plain(0x4a4a48, 0.5, 0.8), -0.18, 0.4, -0.12);
    this.obj.add(winch);

    // --- basement fuse board
    const fb = at('fuse_box');
    const fuseBox = new THREE.Group();
    fuseBox.position.set(fb.pos[0], fb.pos[1], fb.pos[2] - 0.05);
    box(fuseBox, 0.6, 0.8, 0.12, plain(0x3a4038, 0.6, 0.5));
    for (let i = 0; i < 5; i++) cyl(fuseBox, 0.025, 0.1, plain(0xe0d8c0, 0.4), -0.2 + i * 0.1, 0.15, 0.07, 0, Math.PI / 2);
    this.fuse = cyl(fuseBox, 0.03, 0.14, plain(0xe8e0cc, 0.4), 0, -0.1, 0.08, 0, Math.PI / 2);
    this.fuseLed = box(fuseBox, 0.03, 0.03, 0.02, led(false, 0x30ff60), 0.22, 0.3, 0.07);
    const lbl = box(fuseBox, 0.2, 0.05, 0.005, new THREE.MeshStandardMaterial({ map: textTexture(['SECURITY'], { w: 128, h: 32, bg: '#d8d0b0', fg: '#300', font: 'bold 20px monospace' }) }), 0, -0.22, 0.065);
    void lbl;
    this.obj.add(fuseBox);

    // --- generator
    const gp = at('generator');
    const gen = new THREE.Group();
    gen.position.set(gp.pos[0], -4, gp.pos[2] - 1.05);
    this.genBody = new THREE.Group();
    box(this.genBody, 1.6, 0.9, 1.0, plain(0x2a3a2a, 0.6, 0.5), 0, 0.6, 0);
    cyl(this.genBody, 0.3, 0.8, rust, 0.1, 1.2, 0, 0, Math.PI / 2);
    box(this.genBody, 1.8, 0.15, 1.2, iron, 0, 0.08, 0);
    cyl(this.genBody, 0.06, 1.2, rust, -0.6, 1.5, -0.3);
    this.flywheel = cyl(this.genBody, 0.35, 0.08, iron, 0.85, 0.65, 0, 0, Math.PI / 2);
    box(this.flywheel, 0.08, 0.6, 0.06, plain(0x6a1a12, 0.6, 0.4), 0, 0, 0);
    gen.add(this.genBody);
    this.obj.add(gen);

    // --- garage shutter bolts control
    const sh = at('shutter');
    const sc = new THREE.Group();
    sc.position.set(sh.pos[0], sh.pos[1], sh.pos[2] - 0.08);
    box(sc, 0.35, 0.5, 0.1, plain(0x4a4a3a, 0.7, 0.4));
    for (const [x, y] of [
      [-0.1, 0.12],
      [0.1, 0.12],
      [-0.1, -0.12],
      [0.1, -0.12],
    ]) {
      const b = cyl(sc, 0.03, 0.06, rust, x, y, -0.07, Math.PI / 2);
      this.boltsHead.push(b);
    }
    this.obj.add(sc);

    // --- sewer pump panel
    const pp = at('pump_panel');
    const pump = new THREE.Group();
    pump.position.set(pp.pos[0] + 0.05, pp.pos[1], pp.pos[2]);
    pump.rotation.y = -Math.PI / 2;
    box(pump, 0.7, 0.9, 0.14, plain(0x2e3e3a, 0.6, 0.5));
    this.pumpLed = box(pump, 0.04, 0.04, 0.02, led(false, 0x30ff60), 0.25, 0.35, 0.08);
    this.pumpLever = new THREE.Group();
    box(this.pumpLever, 0.04, 0.3, 0.04, plain(0x8a1a12, 0.5, 0.4), 0, 0.15, 0);
    this.pumpLever.position.set(-0.15, -0.1, 0.1);
    pump.add(this.pumpLever);
    // big pump housing on the floor next to it
    const housing = new THREE.Group();
    housing.position.set(pp.pos[0] - 1.6, -8, pp.pos[2] + 1.6);
    cyl(housing, 0.55, 1.2, rust, 0, 0.6, 0);
    cyl(housing, 0.15, 3, getMat('metal'), 0.5, 1.5, -0.6, Math.PI / 2);
    this.obj.add(pump, housing);

    // --- valve manifold: pipe with three valves and a gauge socket
    const v1 = at('valve_1');
    const pipe = cyl(this.obj, 0.09, 7.5, rust, 32.5, v1.pos[1] + 0.15, 39.95 + 0.25, 0, Math.PI / 2);
    void pipe;
    for (let i = 0; i < 3; i++) {
      const vs = at(`valve_${i + 1}`);
      const g = new THREE.Group();
      g.position.set(vs.pos[0], vs.pos[1], vs.pos[2] + 0.1);
      cyl(g, 0.06, 0.25, rust, 0, 0.1, 0);
      const wheel = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.016, 6, 18), plain(0x8b2b1f, 0.6, 0.6));
      wheel.add(ring);
      for (let k = 0; k < 2; k++) box(wheel, 0.26, 0.02, 0.02, plain(0x8b2b1f, 0.6, 0.6)).rotation.z = (k * Math.PI) / 2;
      wheel.position.set(0, 0, 0.08);
      g.add(wheel);
      this.valveHandles.push(wheel);
      this.valveWheels.push(g);
      // tag with the line pressure
      box(g, 0.14, 0.09, 0.005, new THREE.MeshStandardMaterial({ map: textTexture([['I', 'II', 'III'][i], `${valveWeights[i]} BAR`], { w: 128, h: 96, bg: '#b8a878', fg: '#201000', font: 'bold 26px monospace' }) }), 0, -0.25, 0.1);
      this.obj.add(g);
    }
    const mf = at('manifold');
    const gaugeG = new THREE.Group();
    gaugeG.position.set(mf.pos[0], mf.pos[1], mf.pos[2] + 0.1);
    box(gaugeG, 0.18, 0.18, 0.06, rust);
    this.gauge = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 20), new THREE.MeshStandardMaterial({ map: gaugeFace(this.valveTarget) }));
    face.rotation.x = Math.PI / 2;
    face.rotation.y = Math.PI;
    this.gauge.add(face);
    this.needle = new THREE.Group();
    box(this.needle, 0.008, 0.09, 0.004, plain(0x101010, 0.5), 0, 0.04, 0);
    this.needle.position.z = 0.018;
    this.gauge.add(this.needle);
    this.gauge.position.z = 0.06;
    gaugeG.add(this.gauge);
    this.obj.add(gaugeG);

    // --- floodgate control box
    const fg = at('floodgate_box');
    const fbx = new THREE.Group();
    fbx.position.set(fg.pos[0], fg.pos[1], fg.pos[2] - 0.04);
    box(fbx, 0.4, 0.55, 0.12, plain(0x3a3a30, 0.6, 0.5));
    this.floodKey = box(fbx, 0.03, 0.12, 0.03, plain(0x2f5f8f, 0.5, 0.8), 0, 0.05, 0.09);
    this.floodLed = box(fbx, 0.03, 0.03, 0.02, led(false, 0x30ff60), 0.13, 0.2, 0.07);
    this.obj.add(fbx);

    // --- outfall grate wheel hub
    const fw = at('final_wheel');
    const hub = new THREE.Group();
    hub.position.set(fw.pos[0], fw.pos[1], fw.pos[2] - 0.05);
    cyl(hub, 0.06, 0.2, iron, 0, 0, 0, Math.PI / 2);
    this.wheel = new THREE.Group();
    this.wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.026, 6, 22), plain(0x4a4a4a, 0.6, 0.7)));
    for (let k = 0; k < 4; k++) box(this.wheel, 0.44, 0.02, 0.025, plain(0x4a4a4a, 0.6, 0.7)).rotation.z = (k * Math.PI) / 4;
    this.wheel.position.z = 0.12;
    hub.add(this.wheel);
    this.obj.add(hub);
  }

  set(s: MechStates) {
    this.s = s;
    const f = s.front;
    this.front.keyLock.visible = !f.keyLock;
    this.front.padlock.visible = !f.padlock;
    ((this.front.magLed as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.set(f.maglock ? 0x000000 : s.fuse ? 0xff2010 : 0x200000);
    this.front.mag.position.y = f.maglock ? 0.15 : 0;
    this.front.bar.rotation.z = f.bar ? -1.25 : 0;
    this.front.bar.position.x = f.bar ? -0.9 : 0;
    this.front.bar.position.y = f.bar ? 1.6 : 1.15;
    this.winchHandle.visible = f.handle;
    const pl = this.panelLed.material as THREE.MeshStandardMaterial;
    pl.emissive.set(f.maglock ? 0x30ff60 : s.fuse ? 0xffa020 : 0x000000);
    (this.panelScreen.material as THREE.MeshStandardMaterial).emissive.set(s.fuse && !f.maglock ? 0x0a3a14 : 0x000000);
    (this.panelScreen.material as THREE.MeshStandardMaterial).emissiveMap = (this.panelScreen.material as THREE.MeshStandardMaterial).map;
    (this.panelScreen.material as THREE.MeshStandardMaterial).needsUpdate = true;
    this.fuse.visible = s.fuse;
    (this.fuseLed.material as THREE.MeshStandardMaterial).emissive.set(s.fuse ? 0x30ff60 : 0x000000);
    this.boltsHead.forEach((b) => (b.position.z = s.shutter.bolts ? -0.14 : -0.07));
    (this.pumpLed.material as THREE.MeshStandardMaterial).emissive.set(s.pump.running ? 0xffa020 : s.pump.drained ? 0x30ff60 : s.pump.fuse ? 0x302000 : 0x000000);
    this.pumpLever.rotation.z = s.pump.running || s.pump.drained ? -1.0 : 0.3;
    this.valveHandles.forEach((h, i) => {
      h.visible = s.manifold.handle;
      h.rotation.z = s.manifold.valves[i] ? Math.PI / 2 : 0;
    });
    this.gauge.visible = s.manifold.gauge;
    this.floodKey.visible = s.floodgate.key;
    (this.floodLed.material as THREE.MeshStandardMaterial).emissive.set(s.floodgate.open ? 0x30ff60 : s.manifold.equalized ? 0xffa020 : 0x000000);
    this.wheel.visible = s.finalGrate.wheel;
  }

  update(dt: number) {
    this.t += dt;
    const s = this.s;
    if (!s) return;
    if (s.generator.running) {
      this.flywheel.rotation.x += dt * 25;
      this.genBody.position.x = Math.sin(this.t * 60) * 0.008;
    }
    if (s.manifold.gauge) {
      const p = s.manifold.valves.reduce((a, on, i) => a + (on ? this.valveWeights[i] : 0), 0);
      const max = this.valveWeights.reduce((a, b) => a + b, 0);
      const target = -2.2 + (p / Math.max(1, max)) * 4.4 + Math.sin(this.t * 7) * 0.02;
      this.needle.rotation.z += (-target - this.needle.rotation.z) * Math.min(1, dt * 3);
    }
    if (this.wheelSpin > 0) {
      this.wheel.rotation.z += dt * 2.5;
      this.wheelSpin -= dt;
    }
    if (this.winchSpin > 0) {
      this.winchHandle.rotation.z += dt * 4;
      this.winchDrum.rotation.x += dt * 4;
      this.winchSpin -= dt;
    }
  }
}

function gaugeFace(target: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d8d0b0';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#201a10';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    const a = -2.2 + (i / 10) * 4.4 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46);
    ctx.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56);
    ctx.stroke();
  }
  ctx.fillStyle = '#8a1010';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${target} BAR`, 64, 96);
  ctx.fillStyle = '#201a10';
  ctx.font = '12px monospace';
  ctx.fillText('PRESSURE', 64, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
