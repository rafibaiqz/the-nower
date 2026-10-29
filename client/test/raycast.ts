/** Ray casting against raw triangles with a uniform grid (test-only geometry validation). */
import * as THREE from 'three';

const MIN = new THREE.Vector3(-3, -9.5, -3);
const MAX = new THREE.Vector3(99, 23, 91);
const CELL = 1;

export class TriGrid {
  tris: Float32Array;
  nx: number;
  ny: number;
  nz: number;
  cells: Map<number, number[]> = new Map();
  constructor(tris: number[]) {
    this.tris = new Float32Array(tris);
    this.nx = Math.ceil((MAX.x - MIN.x) / CELL);
    this.ny = Math.ceil((MAX.y - MIN.y) / CELL);
    this.nz = Math.ceil((MAX.z - MIN.z) / CELL);
    const n = this.tris.length / 9;
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let v = 0; v < 3; v++) {
        const x = this.tris[o + v * 3];
        const y = this.tris[o + v * 3 + 1];
        const z = this.tris[o + v * 3 + 2];
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
      }
      const e = 1e-4;
      const cx0 = this.ix(x0 - e), cx1 = this.ix(x1 + e);
      const cy0 = this.iy(y0 - e), cy1 = this.iy(y1 + e);
      const cz0 = this.iz(z0 - e), cz1 = this.iz(z1 + e);
      for (let cz = cz0; cz <= cz1; cz++)
        for (let cy = cy0; cy <= cy1; cy++)
          for (let cx = cx0; cx <= cx1; cx++) {
            const key = (cz * this.ny + cy) * this.nx + cx;
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push(t);
          }
    }
  }
  ix(x: number) { return Math.max(0, Math.min(this.nx - 1, Math.floor((x - MIN.x) / CELL))); }
  iy(y: number) { return Math.max(0, Math.min(this.ny - 1, Math.floor((y - MIN.y) / CELL))); }
  iz(z: number) { return Math.max(0, Math.min(this.nz - 1, Math.floor((z - MIN.z) / CELL))); }

  /** Distance to the first front-facing triangle along the ray, or Infinity if it escapes. */
  cast(o: THREE.Vector3, d: THREE.Vector3, twoSided = false): number {
    let cx = Math.floor((o.x - MIN.x) / CELL), cy = Math.floor((o.y - MIN.y) / CELL), cz = Math.floor((o.z - MIN.z) / CELL);
    const step = [Math.sign(d.x), Math.sign(d.y), Math.sign(d.z)];
    const next = (c: number, s: number, p: number, mn: number, dd: number) => (dd === 0 ? Infinity : ((mn + (c + (s > 0 ? 1 : 0)) * CELL - p) / dd));
    let tMaxX = next(cx, step[0], o.x, MIN.x, d.x), tMaxY = next(cy, step[1], o.y, MIN.y, d.y), tMaxZ = next(cz, step[2], o.z, MIN.z, d.z);
    const tdx = d.x === 0 ? Infinity : CELL / Math.abs(d.x), tdy = d.y === 0 ? Infinity : CELL / Math.abs(d.y), tdz = d.z === 0 ? Infinity : CELL / Math.abs(d.z);
    const seen = new Set<number>();
    let best = Infinity;
    let tEnter = 0;
    while (cx >= 0 && cy >= 0 && cz >= 0 && cx < this.nx && cy < this.ny && cz < this.nz) {
      const list = this.cells.get((cz * this.ny + cy) * this.nx + cx);
      if (list)
        for (const t of list) {
          if (seen.has(t)) continue;
          seen.add(t);
          const hit = this.hit(t, o, d, twoSided);
          if (hit < best) best = hit;
        }
      const tExit = Math.min(tMaxX, tMaxY, tMaxZ);
      if (best <= tExit + 1e-6) return best;
      tEnter = tExit;
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { cx += step[0]; tMaxX += tdx; }
      else if (tMaxY <= tMaxZ) { cy += step[1]; tMaxY += tdy; }
      else { cz += step[2]; tMaxZ += tdz; }
    }
    void tEnter;
    return best;
  }

  /** Möller–Trumbore, front faces only (counter-clockwise = front, as in three.js). */
  hit(t: number, o: THREE.Vector3, d: THREE.Vector3, twoSided = false): number {
    const a = this.tris;
    const i = t * 9;
    const e1x = a[i + 3] - a[i], e1y = a[i + 4] - a[i + 1], e1z = a[i + 5] - a[i + 2];
    const e2x = a[i + 6] - a[i], e2y = a[i + 7] - a[i + 1], e2z = a[i + 8] - a[i + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (!twoSided && nx * d.x + ny * d.y + nz * d.z >= 0) return Infinity; // back face: invisible from here
    const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return Infinity;
    const inv = 1 / det;
    const tx = o.x - a[i], ty = o.y - a[i + 1], tz = o.z - a[i + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-6 || u > 1 + 1e-6) return Infinity;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < -1e-6 || u + v > 1 + 1e-6) return Infinity;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return dist > 1e-4 ? dist : Infinity;
  }
}

export function collect(root: THREE.Object3D, out: number[]) {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
}

