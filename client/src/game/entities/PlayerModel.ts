/** Teammate avatar: simple original survivor figure with a name tag and a visible torch beam. */
import * as THREE from 'three';
import { plain } from '../world/textures';

function nameSprite(name: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = '600 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#' + new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5).getHexString();
  ctx.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: true, fog: false, opacity: 0.85 }));
  s.scale.set(1.0, 0.25, 1);
  return s;
}

export class PlayerModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head: THREE.Mesh;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private legL: THREE.Group;
  private legR: THREE.Group;
  readonly beam: THREE.Mesh;
  readonly label: THREE.Sprite;
  private phase = 0;
  crouch = 0;

  constructor(name: string, color: number) {
    const jacket = plain(color, 0.85, 0);
    const pants = plain(0x1c1d22, 0.9);
    const skin = plain(0xb08870, 0.7);
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };
    this.root.add(this.body);
    mk(new THREE.BoxGeometry(0.42, 0.55, 0.25), jacket, this.body, 0, 1.2, 0);
    mk(new THREE.BoxGeometry(0.36, 0.2, 0.22), pants, this.body, 0, 0.88, 0);
    this.head = mk(new THREE.SphereGeometry(0.12, 12, 10), skin, this.body, 0, 1.62, 0);
    mk(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), plain(0x1a120c, 1), this.head, 0, 0.02, -0.01);
    const limb = (x: number, y: number, len: number, w: number, m: THREE.Material) => {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      mk(new THREE.BoxGeometry(w, len, w), m, g, 0, -len / 2, 0);
      this.body.add(g);
      return g;
    };
    this.armL = limb(-0.27, 1.45, 0.6, 0.1, jacket);
    this.armR = limb(0.27, 1.45, 0.6, 0.1, jacket);
    this.legL = limb(-0.1, 0.8, 0.8, 0.14, pants);
    this.legR = limb(0.1, 0.8, 0.8, 0.14, pants);
    // flashlight in the right hand + soft volumetric cone
    mk(new THREE.CylinderGeometry(0.025, 0.03, 0.16, 8), plain(0x222222, 0.4, 0.6), this.armR, 0, -0.62, 0.05).rotation.x = Math.PI / 2;
    const cone = new THREE.ConeGeometry(1.4, 7, 20, 8, true);
    cone.translate(0, -3.5, 0);
    cone.rotateX(-Math.PI / 2);
    // soft volumetric beam: fades with distance from the torch and towards the silhouette edges
    this.beam = new THREE.Mesh(
      cone,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { color: { value: new THREE.Color(0xfff0d0) } },
        vertexShader:
          'varying float vT; varying vec3 vN; varying vec3 vV; void main(){ vT = position.z / 7.0; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader:
          'uniform vec3 color; varying float vT; varying vec3 vN; varying vec3 vV; void main(){ float along = pow(clamp(1.0 - vT, 0.0, 1.0), 2.2); float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); gl_FragColor = vec4(color * along * edge * 0.022, 1.0); }',
      }),
    );
    this.beam.position.set(0, 1.35, 0.15);
    this.root.add(this.beam);
    this.label = nameSprite(name, color);
    this.label.position.y = 2.05;
    this.root.add(this.label);
  }

  update(dt: number, speed: number, crouch: boolean, pitch: number, flash: boolean) {
    this.crouch += ((crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
    this.phase += dt * speed * 3.2;
    const s = Math.sin(this.phase) * Math.min(1, speed / 2);
    this.legL.rotation.x = s * 0.6;
    this.legR.rotation.x = -s * 0.6;
    this.armL.rotation.x = -s * 0.5;
    this.armR.rotation.x = -0.9 - pitch * 0.6;
    this.body.position.y = -this.crouch * 0.45;
    this.body.rotation.x = this.crouch * 0.25;
    this.head.rotation.x = -pitch * 0.5;
    this.beam.visible = flash;
    this.beam.rotation.x = -pitch;
    this.beam.position.y = 1.35 - this.crouch * 0.45;
  }
}
