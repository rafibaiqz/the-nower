/**
 * Accumulates static geometry into buckets keyed by (material, floor, 24m chunk) and merges
 * each bucket into a single mesh. This keeps the whole estate at a few hundred draw calls
 * while still allowing frustum culling per chunk.
 */
import * as THREE from 'three';
import { getMat, plain, tileSize } from './textures';

const CHUNK = 24;

interface Bucket {
  mat: string;
  pos: number[];
  nor: number[];
  uv: number[];
  idx: number[];
}

const special = new Map<string, THREE.Material>();

export function resolveMat(key: string): THREE.Material {
  const s = special.get(key);
  if (s) return s;
  if (key.startsWith('plain:')) {
    const [, hex, rough, metal, emi] = key.split(':');
    return plain(parseInt(hex, 16), Number(rough ?? 0.8), Number(metal ?? 0), Number(emi ?? 0));
  }
  return getMat(key);
}

export function registerMat(key: string, m: THREE.Material) {
  special.set(key, m);
}

export function pk(hex: number, rough = 0.8, metal = 0, emissive = 0) {
  return `plain:${hex.toString(16).padStart(6, '0')}:${rough}:${metal}:${emissive}`;
}

export class MeshBuilder {
  private buckets = new Map<string, Bucket>();
  castShadows = false;

  private bucket(mat: string, f: number, x: number, z: number): Bucket {
    const key = `${mat}|${f}|${Math.floor(x / CHUNK)}|${Math.floor(z / CHUNK)}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { mat, pos: [], nor: [], uv: [], idx: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Quad from four corners (counter-clockwise when seen from the front). */
  quad(mat: string, f: number, a: number[], b: number[], c: number[], d: number[], n: number[], uvs: number[][]) {
    const bk = this.bucket(mat, f, (a[0] + c[0]) / 2, (a[2] + c[2]) / 2);
    const base = bk.pos.length / 3;
    for (const p of [a, b, c, d]) bk.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) bk.nor.push(n[0], n[1], n[2]);
    for (const uv of uvs) bk.uv.push(uv[0], uv[1]);
    bk.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Horizontal quad (floor facing up, ceiling facing down). */
  hquad(mat: string, f: number, x0: number, z0: number, x1: number, z1: number, y: number, up: boolean) {
    const t = tileSize(mat.startsWith('plain:') ? 'x' : mat);
    const uv = [
      [x0 / t, z0 / t],
      [x1 / t, z0 / t],
      [x1 / t, z1 / t],
      [x0 / t, z1 / t],
    ];
    if (up)
      this.quad(mat, f, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [uv[3], uv[2], uv[1], uv[0]]);
    else this.quad(mat, f, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], uv);
  }

  /** Vertical wall quad on the plane x=const or z=const facing along normal n. */
  wall(mat: string, f: number, axis: 'x' | 'z', at: number, from: number, to: number, y0: number, y1: number, nSign: 1 | -1) {
    const t = tileSize(mat.startsWith('plain:') ? 'x' : mat);
    const u0 = from / t;
    const u1 = to / t;
    const v0 = y0 / t;
    const v1 = y1 / t;
    if (axis === 'x') {
      // plane x = at; spans z from..to
      if (nSign > 0) this.quad(mat, f, [at, y0, to], [at, y0, from], [at, y1, from], [at, y1, to], [1, 0, 0], [[-u1, v0], [-u0, v0], [-u0, v1], [-u1, v1]]);
      else this.quad(mat, f, [at, y0, from], [at, y0, to], [at, y1, to], [at, y1, from], [-1, 0, 0], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    } else {
      if (nSign > 0) this.quad(mat, f, [from, y0, at], [to, y0, at], [to, y1, at], [from, y1, at], [0, 0, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      else this.quad(mat, f, [to, y0, at], [from, y0, at], [from, y1, at], [to, y1, at], [0, 0, -1], [[-u1, v0], [-u0, v0], [-u0, v1], [-u1, v1]]);
    }
  }

  /** Axis-aligned (optionally Y-rotated) box with world-scaled UVs. */
  box(mat: string, f: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const t = tileSize(mat.startsWith('plain:') ? 'x' : mat);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const su = nx > 0.5 ? sz : sx;
      const sv = ny > 0.5 ? sz : sy;
      uv.setXY(i, (uv.getX(i) * su) / t, (uv.getY(i) * sv) / t);
    }
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(cx, cy, cz);
    this.geom(mat, f, g, m);
    g.dispose();
  }

  /** Box placed by an arbitrary matrix (used for rotated furniture parts). */
  boxM(mat: string, f: number, m: THREE.Matrix4, sx: number, sy: number, sz: number) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const t = tileSize(mat.startsWith('plain:') ? 'x' : mat);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const su = nx > 0.5 ? sz : sx;
      const sv = ny > 0.5 ? sz : sy;
      uv.setXY(i, (uv.getX(i) * su) / t, (uv.getY(i) * sv) / t);
    }
    this.geom(mat, f, g, m);
    g.dispose();
  }

  /** Appends an arbitrary geometry transformed by a matrix. */
  geom(mat: string, f: number, g: THREE.BufferGeometry, m: THREE.Matrix4) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    v.set(0, 0, 0).applyMatrix4(m);
    const bk = this.bucket(mat, f, v.x, v.z);
    const base = bk.pos.length / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      bk.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      bk.nor.push(v.x, v.y, v.z);
      if (uv) bk.uv.push(uv.getX(i), uv.getY(i));
      else bk.uv.push(0, 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) bk.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) bk.idx.push(base + i);
  }

  build(receiveShadow = true): THREE.Group {
    const group = new THREE.Group();
    for (const [key, b] of this.buckets) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, resolveMat(b.mat));
      mesh.userData.floor = Number(key.split('|')[1]);
      mesh.receiveShadow = receiveShadow;
      mesh.castShadow = this.castShadows;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}
