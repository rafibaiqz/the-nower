/** The abandoned saloon in the garage: repairable parts, opening hood, headlights, exhaust. */
import * as THREE from 'three';
import type { CarState } from '@nower/shared';
import { getMat, plain } from '../world/textures';

export class CarView {
  readonly obj = new THREE.Group();
  private hood = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private front: THREE.Object3D[] = [];
  private battery: THREE.Object3D;
  private coil: THREE.Object3D;
  private relay: THREE.Object3D;
  private lights: THREE.SpotLight[] = [];
  private lamps: THREE.MeshStandardMaterial;
  private smoke: THREE.Points;
  private smokePos: Float32Array;
  private smokeAge: Float32Array;
  private running = false;
  private steer = 0;

  constructor() {
    const paint = new THREE.MeshStandardMaterial({ color: 0x2a3a34, roughness: 0.55, metalness: 0.4 });
    const rust = getMat('rust');
    const chrome = plain(0x9a9a98, 0.25, 0.9);
    const glass = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.7 });
    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    const body = new THREE.Group();
    this.obj.add(body);
    // local frame: +z is the front of the car
    add(body, new THREE.BoxGeometry(1.85, 0.55, 4.5), paint, 0, 0.62, 0);
    add(body, new THREE.BoxGeometry(1.6, 0.55, 2.1), paint, 0, 1.15, -0.35);
    add(body, new THREE.BoxGeometry(1.58, 0.45, 0.05), glass, 0, 1.15, 0.72).rotation.x = -0.35;
    add(body, new THREE.BoxGeometry(1.58, 0.45, 0.05), glass, 0, 1.15, -1.42).rotation.x = 0.35;
    add(body, new THREE.BoxGeometry(0.05, 0.4, 1.9), glass, -0.81, 1.17, -0.35);
    add(body, new THREE.BoxGeometry(0.05, 0.4, 1.9), glass, 0.81, 1.17, -0.35);
    add(body, new THREE.BoxGeometry(1.9, 0.18, 0.2), chrome, 0, 0.42, 2.3);
    add(body, new THREE.BoxGeometry(1.9, 0.18, 0.2), chrome, 0, 0.42, -2.3);
    // rust patches
    add(body, new THREE.BoxGeometry(0.02, 0.3, 0.8), rust, -0.93, 0.6, 1.2);
    add(body, new THREE.BoxGeometry(0.6, 0.02, 0.5), rust, 0.4, 1.43, -0.6);
    // interior: seats and steering wheel
    add(body, new THREE.BoxGeometry(0.6, 0.5, 0.5), plain(0x3a2a20, 0.9), -0.4, 0.9, -0.3);
    add(body, new THREE.BoxGeometry(0.6, 0.5, 0.5), plain(0x3a2a20, 0.9), 0.4, 0.9, -0.3);
    const sw = add(body, new THREE.TorusGeometry(0.17, 0.02, 6, 16), plain(0x111111, 0.6), -0.4, 1.12, 0.35);
    sw.rotation.x = -0.6;
    // headlamps
    this.lamps = new THREE.MeshStandardMaterial({ color: 0xddd8c0, emissive: 0x000000, emissiveIntensity: 2 });
    for (const x of [-0.65, 0.65]) add(body, new THREE.CylinderGeometry(0.13, 0.13, 0.08, 14), this.lamps, x, 0.75, 2.26).rotation.x = Math.PI / 2;
    // wheels
    for (const [x, z] of [
      [-0.92, 1.45],
      [0.92, 1.45],
      [-0.92, -1.45],
      [0.92, -1.45],
    ]) {
      const w = new THREE.Group();
      w.position.set(x, 0.36, z);
      add(w, new THREE.CylinderGeometry(0.36, 0.36, 0.24, 16), plain(0x0d0d0d, 0.95), 0, 0, 0).rotation.z = Math.PI / 2;
      add(w, new THREE.CylinderGeometry(0.2, 0.2, 0.26, 10), chrome, 0, 0, 0).rotation.z = Math.PI / 2;
      body.add(w);
      this.wheels.push(w);
      if (z > 0) this.front.push(w);
    }
    // engine bay + hood
    add(body, new THREE.BoxGeometry(1.5, 0.3, 1.2), plain(0x111111, 0.8, 0.4), 0, 0.75, 1.6);
    this.battery = add(body, new THREE.BoxGeometry(0.3, 0.2, 0.18), plain(0x222222, 0.7), 0.5, 0.98, 1.8);
    this.coil = add(body, new THREE.CylinderGeometry(0.035, 0.035, 0.15, 10), plain(0x2e4a2e, 0.5, 0.3), -0.3, 0.95, 1.5);
    this.relay = add(body, new THREE.BoxGeometry(0.06, 0.05, 0.06), plain(0x3a3a6a, 0.5), -0.55, 0.95, 1.9);
    this.hood.position.set(0, 0.9, 0.95);
    add(this.hood, new THREE.BoxGeometry(1.8, 0.05, 1.35), paint, 0, 0, 0.68);
    body.add(this.hood);
    // headlight beams (only when running)
    for (const x of [-0.65, 0.65]) {
      const l = new THREE.SpotLight(0xfff0d0, 0, 28, 0.45, 0.6, 1.2);
      l.position.set(x, 0.75, 2.3);
      l.target.position.set(x, 0.2, 10);
      body.add(l, l.target);
      this.lights.push(l);
    }
    // exhaust smoke
    const n = 60;
    this.smokePos = new Float32Array(n * 3);
    this.smokeAge = new Float32Array(n).fill(99);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    this.smoke = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x6a6a6a, size: 0.5, transparent: true, opacity: 0.25, depthWrite: false }));
    this.smoke.frustumCulled = false;
  }

  attachSmoke(scene: THREE.Object3D) {
    scene.add(this.smoke);
  }

  set(s: CarState) {
    this.hood.rotation.x = s.hood ? -1.1 : 0;
    this.battery.visible = s.battery;
    this.coil.visible = s.coil;
    this.relay.visible = s.relay;
    this.running = s.running && !s.escaped;
    this.lamps.emissive.set(this.running ? 0xffe8b0 : 0x000000);
    for (const l of this.lights) l.intensity = this.running ? 220 : 0;
  }

  /** Pose from interpolated snapshot data. */
  pose(x: number, z: number, yaw: number, speed: number, steer: number, dt: number) {
    this.obj.position.set(x, 0, z);
    this.obj.rotation.y = yaw + Math.PI;
    this.steer = steer;
    for (const w of this.wheels) (w.children[0] as THREE.Object3D).rotation.x += (speed * dt) / 0.36;
    for (const w of this.front) w.rotation.y = -this.steer * 0.5;
    if (this.running) this.obj.position.y = Math.sin(performance.now() * 0.05) * 0.006;
    // smoke
    const back = new THREE.Vector3(0.6, 0.3, -2.4).applyMatrix4(this.obj.matrixWorld);
    for (let i = 0; i < this.smokeAge.length; i++) {
      this.smokeAge[i] += dt;
      if (this.smokeAge[i] > 2.5 && this.running && Math.random() < dt * 12) {
        this.smokeAge[i] = 0;
        this.smokePos.set([back.x, back.y, back.z], i * 3);
      }
      if (this.smokeAge[i] < 2.5) this.smokePos[i * 3 + 1] += dt * 0.5;
      else this.smokePos[i * 3 + 1] = -100;
    }
    (this.smoke.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
