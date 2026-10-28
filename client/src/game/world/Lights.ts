/**
 * Dynamic light pool. The estate has ~100 fixtures; only the N nearest working ones get a real
 * PointLight (re-assigned a few times per second). Flicker, brief failures and the generator
 * powering the basement are handled here.
 */
import * as THREE from 'three';
import type { Level, LightDef } from '@nower/shared';

export class LightPool {
  private pool: THREE.PointLight[] = [];
  private assigned: (LightDef | null)[] = [];
  private acc = 0;
  private t = 0;
  private failUntil = 0;
  private nextFail = 30 + Math.random() * 40;
  basementPowered = false;

  constructor(
    private level: Level,
    scene: THREE.Scene,
    count: number,
  ) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffb070, 0, 10, 2);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
      this.assigned.push(null);
    }
  }

  private isOn(l: LightDef) {
    if (l.on) return true;
    if (this.basementPowered && this.level.rooms[l.room]?.spec.zone === 'basement') return true;
    return false;
  }

  update(dt: number, cam: THREE.Vector3, danger: number) {
    this.t += dt;
    this.acc += dt;
    // brief, random power dips; more likely when he is near
    this.nextFail -= dt * (1 + danger * 4);
    if (this.nextFail <= 0) {
      this.failUntil = this.t + 0.2 + Math.random() * (danger > 0.3 ? 1.6 : 0.6);
      this.nextFail = 25 + Math.random() * 50;
    }
    if (this.acc > 0.25) {
      this.acc = 0;
      const cands = this.level.lights
        .filter((l) => this.isOn(l))
        .map((l) => ({ l, d: (l.pos[0] - cam.x) ** 2 + ((l.pos[1] - cam.y) * 2) ** 2 + (l.pos[2] - cam.z) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.pool.length);
      this.pool.forEach((pl, i) => {
        const c = cands[i];
        this.assigned[i] = c ? c.l : null;
        if (c) {
          pl.position.set(c.l.pos[0], c.l.pos[1] - 0.15, c.l.pos[2]);
          pl.color.setHex(c.l.color);
          pl.distance = c.l.range;
        }
      });
    }
    const failing = this.t < this.failUntil;
    this.pool.forEach((pl, i) => {
      const l = this.assigned[i];
      if (!l) {
        pl.intensity = 0;
        return;
      }
      let k = 1;
      if (l.flicker > 0) {
        const n = Math.sin(this.t * 13.3 + i * 7) * Math.sin(this.t * 3.1 + i) + Math.sin(this.t * 37 + i * 3) * 0.3;
        if (n > 1 - l.flicker * 0.5) k = 0.05;
        else k = 0.85 + n * 0.1;
      }
      if (failing) k *= 0.05;
      const base = l.kind === 'chandelier' ? 55 : l.kind === 'fluoro' ? 40 : l.kind === 'sconces' ? 16 : l.kind === 'sewer' ? 18 : l.kind === 'lantern' ? 30 : 26;
      pl.intensity = base * l.intensity * k;
    });
  }
}
