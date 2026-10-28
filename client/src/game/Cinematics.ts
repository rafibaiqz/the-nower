/** In-engine camera sequences: the skippable opening and the personal endings. */
import * as THREE from 'three';
import type { EscapeRoute } from '@nower/shared';

export interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fade: number; // 0 clear .. 1 black
  flash: number;
  title: string | null;
  subtitle: string | null;
  cue?: 'metal' | 'thunder' | 'distant' | 'wake';
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ease = (t: number) => t * t * (3 - 2 * t);

export class Cinematic {
  t = 0;
  private fired = new Set<string>();
  constructor(
    readonly kind: 'intro' | EscapeRoute | 'captured' | 'eliminated',
    private start: THREE.Vector3,
    private startYaw: number,
  ) {}

  get duration() {
    return this.kind === 'intro' ? 13 : this.kind === 'captured' ? 3.2 : 9;
  }

  get done() {
    return this.t >= this.duration;
  }

  private once(id: string, cond: boolean) {
    if (cond && !this.fired.has(id)) {
      this.fired.add(id);
      return true;
    }
    return false;
  }

  update(dt: number): Shot {
    this.t += dt;
    const t = this.t;
    const s: Shot = { pos: v(0, 0, 0), look: v(0, 0, 0), fade: 0, flash: 0, title: null, subtitle: null };
    switch (this.kind) {
      case 'intro': {
        if (this.once('metal', t > 0.4)) s.cue = 'metal';
        if (t < 6.5) {
          const k = ease(Math.min(1, Math.max(0, (t - 1) / 5.5)));
          s.pos = v(46 + k * 4, 1.6 + k * 0.6, 95 - k * 10);
          s.look = v(48.5, 7 - k, 40);
          s.fade = t < 1.5 ? 1 - (t - 0.5) : t > 5.8 ? (t - 5.8) / 0.7 : 0;
          if (t > 3.4 && t < 3.6) s.flash = 0.9;
          if (t > 3.75 && t < 3.85) s.flash = 0.5;
          if (this.once('thunder', t > 3.5)) s.cue = 'thunder';
          if (t > 2 && t < 5.8) {
            s.title = 'THE NOWER';
            s.subtitle = 'ESCAPE BEFORE HE FINDS YOU';
          }
        } else if (t < 8) {
          s.pos = this.start.clone().setY(this.start.y + 0.35);
          s.look = this.start.clone().add(v(0, 3, 0));
          s.fade = 1;
          s.title = '3:17 A.M.';
        } else {
          // waking up: lying down, blinking, then sitting up
          const k = ease(Math.min(1, (t - 8) / 4));
          const fwd = v(-Math.sin(this.startYaw), 0, -Math.cos(this.startYaw));
          s.pos = this.start.clone().setY(this.start.y + 0.35 + k * 1.25);
          s.look = s.pos.clone().add(fwd.multiplyScalar(1 + k * 2)).add(v(0, 2.5 * (1 - k), 0));
          const blink = Math.max(0, Math.sin((t - 8) * 3.2));
          s.fade = t < 9.5 ? 1 - blink * 0.85 : t < 10.5 ? 0.3 * (1 - blink) : 0;
          if (this.once('wake', t > 8.2)) s.cue = 'wake';
          if (this.once('distant', t > 11.2)) s.cue = 'distant';
        }
        break;
      }
      case 'front': {
        const k = ease(Math.min(1, t / 9));
        s.pos = v(48.5 + Math.sin(t * 0.2) * 2, 1.8 + k * 3, 84 + k * 14);
        s.look = v(48.5, 4, 56);
        s.title = t > 1.5 ? 'YOU ESCAPED' : null;
        s.subtitle = t > 2.5 ? 'THROUGH THE MAIN ENTRANCE' : null;
        s.fade = t < 0.6 ? 1 - t / 0.6 : t > 8 ? t - 8 : 0;
        break;
      }
      case 'garage': {
        const k = ease(Math.min(1, t / 9));
        s.pos = v(84 - k * 40, 3 + k * 4, 92);
        s.look = v(84 - k * 60, 0.5, 84);
        s.title = t > 1.5 ? 'YOU ESCAPED' : null;
        s.subtitle = t > 2.5 ? 'IN THE NOWER’S OLD CAR' : null;
        s.fade = t < 0.6 ? 1 - t / 0.6 : t > 8 ? t - 8 : 0;
        break;
      }
      case 'sewer': {
        const k = ease(Math.min(1, t / 9));
        s.pos = v(11.5, -7.2 + k * 10, 2.5 - k * 6);
        s.look = v(11.5, 4 + k * 6, -30);
        s.title = t > 1.5 ? 'YOU ESCAPED' : null;
        s.subtitle = t > 2.5 ? 'THROUGH THE SEWERS' : null;
        s.fade = t < 0.6 ? 1 - t / 0.6 : t > 8 ? t - 8 : 0;
        break;
      }
      case 'captured':
      case 'eliminated': {
        s.pos = this.start.clone();
        s.look = this.start.clone().add(v(-Math.sin(this.startYaw), 0, -Math.cos(this.startYaw)));
        s.fade = t > 2.4 ? (t - 2.4) / 0.8 : 0;
        s.title = this.kind === 'eliminated' && t > 1.2 ? 'THE HOUSE KEEPS YOU' : null;
        break;
      }
    }
    return s;
  }
}
