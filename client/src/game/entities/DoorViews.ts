/** Animated doors, gates, shutters, grates and secret panels. */
import * as THREE from 'three';
import type { Door, DoorState, Level } from '@nower/shared';
import { getMat, plain } from '../world/textures';

const BRASS = () => plain(0x8a6a2a, 0.35, 0.8);

export class DoorView {
  readonly obj = new THREE.Group();
  private leaves: { pivot: THREE.Group; sign: number }[] = [];
  private t = 0;
  private target = 0;
  private lock: THREE.Object3D | null = null;
  readonly kind: string;

  constructor(
    readonly door: Door,
    level: Level,
  ) {
    const spec = door.spec;
    this.kind = spec.kind;
    const base = level.floors[spec.f].base;
    const cells = spec.cells;
    const along = door.pass === 'z' ? 'x' : 'z';
    const minA = Math.min(...cells.map((c) => (along === 'x' ? c[0] : c[1])));
    const width = cells.length;
    const mid = door.pass === 'z' ? cells[0][1] + 0.5 : cells[0][0] + 0.5;
    this.obj.position.set(door.pass === 'z' ? minA : mid, base, door.pass === 'z' ? mid : minA);
    // local frame: leaf spans +x from 0..width
    if (door.pass === 'x') this.obj.rotation.y = -Math.PI / 2;
    const roomSide = door.rooms[0] >= 0 ? level.rooms[door.rooms[0]].spec.wall : 'plaster_dirty';

    const makeLeaf = (w: number, mat: THREE.Material, h = 2.2, thick = 0.06) => {
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, thick), mat);
      panel.position.set(w / 2, h / 2, 0);
      panel.castShadow = true;
      g.add(panel);
      return { g, panel };
    };

    switch (spec.kind) {
      case 'shutter': {
        const leaf = makeLeaf(width, getMat('rust'), 3.0, 0.08);
        for (let i = 0; i < 14; i++) {
          const rib = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, 0.1), getMat('metal'));
          rib.position.set(width / 2, 0.1 + i * 0.21, 0);
          leaf.g.add(rib);
        }
        this.obj.add(leaf.g);
        this.leaves.push({ pivot: leaf.g, sign: 0 });
        break;
      }
      case 'floodgate':
      case 'gate_chain':
      case 'grate': {
        const h = spec.kind === 'grate' ? 2.8 : spec.kind === 'floodgate' ? 2.9 : 2.4;
        const g = new THREE.Group();
        const iron = plain(0x24221f, 0.6, 0.7);
        const n = Math.round(width * 7);
        for (let i = 0; i < n; i++) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), spec.kind === 'floodgate' ? getMat('rust') : iron);
          bar.position.set((i + 0.5) / 7, h / 2, 0);
          g.add(bar);
        }
        for (const y of [0.2, h / 2, h - 0.15]) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.07), getMat('rust'));
          band.position.set(width / 2, y, 0);
          g.add(band);
        }
        if (spec.kind === 'floodgate') {
          const plate = new THREE.Mesh(new THREE.BoxGeometry(width, h * 0.6, 0.06), getMat('rust'));
          plate.position.set(width / 2, h * 0.3, 0.02);
          g.add(plate);
        }
        if (spec.kind === 'gate_chain') {
          const chain = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.03, 6, 12), plain(0x4a4a48, 0.5, 0.8));
          chain.position.set(width / 2, 1.1, 0.06);
          g.add(chain);
          const pad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.05), BRASS());
          pad.position.set(width / 2, 0.85, 0.08);
          g.add(pad);
          this.lock = g;
        }
        this.obj.add(g);
        this.leaves.push({ pivot: g, sign: spec.kind === 'gate_chain' ? 2 : 0 });
        break;
      }
      default: {
        const mats: Record<string, THREE.Material> = {
          wood: getMat('wood_dark'),
          double: getMat('wood_dark'),
          front: getMat('wood_dark'),
          wood_old: getMat('wood_rough'),
          iron: getMat('rust'),
          iron_gate: plain(0x262422, 0.6, 0.7),
          glass: new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 }),
          panel: getMat(roomSide),
          bookcase: getMat('trim'),
          brickwall: getMat('brick'),
          cage: plain(0x2a2826, 0.5, 0.8),
        };
        const mat = mats[spec.kind] ?? getMat('wood_dark');
        const nLeaves = spec.kind === 'double' || spec.kind === 'front' ? 2 : 1;
        const leafW = width / nLeaves;
        for (let i = 0; i < nLeaves; i++) {
          const thick = spec.kind === 'bookcase' || spec.kind === 'brickwall' || spec.kind === 'panel' ? 0.3 : spec.kind === 'front' ? 0.12 : 0.06;
          const h = spec.kind === 'cage' ? 2.6 : spec.kind === 'brickwall' || spec.kind === 'panel' || spec.kind === 'bookcase' ? 2.25 : 2.2;
          const leaf = makeLeaf(leafW, mat, h, thick);
          if (spec.kind === 'cage') {
            leaf.panel.visible = false;
            for (let b = 0; b < 7; b++) {
              const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.04), mat);
              bar.position.set((b + 0.5) / 7, h / 2, 0);
              leaf.g.add(bar);
            }
          } else if (spec.kind === 'bookcase') {
            for (let s = 0; s < 4; s++)
              for (let b = 0; b < 10; b++) {
                const book = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.2), plain([0x3a1010, 0x10203a, 0x1e3018, 0x3a2a10][(b + s) % 4], 0.9));
                book.position.set(0.1 + b * 0.085, 0.3 + s * 0.5, 0.12);
                leaf.g.add(book);
                const book2 = book.clone();
                book2.position.z = -0.12;
                leaf.g.add(book2);
              }
          } else if (spec.kind !== 'brickwall' && spec.kind !== 'panel' && spec.kind !== 'glass') {
            // raised panels and a handle
            for (const y of [0.6, 1.55]) {
              for (const z of [0.035, -0.035]) {
                const p = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.7, 0.7, 0.02), getMat('trim'));
                p.position.set(leafW / 2, y, z * (thick / 0.06));
                leaf.g.add(p);
              }
            }
            const handleX = i === 0 ? leafW - 0.1 : 0.1;
            for (const z of [0.06, -0.06]) {
              const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), BRASS());
              knob.position.set(handleX, 1.0, z * (thick / 0.06 + 0.5));
              leaf.g.add(knob);
            }
          }
          if (i === 1) {
            // right leaf hinges at the far edge
            const holder = new THREE.Group();
            holder.position.x = width;
            leaf.g.position.x = -leafW;
            const pivot = new THREE.Group();
            pivot.add(leaf.g);
            holder.add(pivot);
            this.obj.add(holder);
            this.leaves.push({ pivot, sign: 1 });
          } else {
            this.obj.add(leaf.g);
            this.leaves.push({ pivot: leaf.g, sign: -1 });
          }
        }
        if (spec.lock?.kind === 'item') {
          const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.09), BRASS());
          plate.position.set(width - 0.12, 1.0, 0);
          this.obj.children[0].add(plate);
          this.lock = plate;
        }
      }
    }
  }

  set(s: DoorState) {
    this.target = s.open ? 1 : 0;
    if (this.lock && this.kind !== 'gate_chain') this.lock.visible = s.locked;
    if (this.lock && this.kind === 'gate_chain' && s.open) {
      // smashed: leave the bent gate lying flat
      this.leaves[0].pivot.rotation.x = -1.45;
      this.leaves[0].pivot.position.z = 0.4;
      this.t = this.target = 1;
    }
  }

  get openAmount() {
    return this.t;
  }

  update(dt: number) {
    if (this.t === this.target) return;
    const speed = this.kind === 'shutter' || this.kind === 'floodgate' ? 0.5 : this.kind === 'brickwall' || this.kind === 'bookcase' ? 0.8 : 2.2;
    this.t += Math.sign(this.target - this.t) * Math.min(Math.abs(this.target - this.t), dt * speed);
    for (const l of this.leaves) {
      if (this.kind === 'shutter') l.pivot.position.y = this.t * 2.85;
      else if (this.kind === 'floodgate') l.pivot.position.y = this.t * 2.7;
      else if (this.kind === 'grate') l.pivot.rotation.x = -this.t * 1.5;
      else if (this.kind === 'gate_chain') continue;
      else l.pivot.rotation.y = l.sign * this.t * 1.7;
    }
  }
}
