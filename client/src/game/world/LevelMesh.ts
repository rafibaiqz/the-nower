/** Builds the static architecture of the estate from the shared cell grids. */
import * as THREE from 'three';
import { CT, F, FLOOR_COUNT, FLOOR_HEIGHT, SOLID_STYLES, stairHeight, type Level } from '@nower/shared';
import { MeshBuilder, pk, registerMat } from './MeshBuilder';
import { getTexture } from './textures';

const DOOR_H = 2.25;

const glass = new THREE.MeshStandardMaterial({ color: 0x0b1420, roughness: 0.08, metalness: 0.3, emissive: 0x1a2a40, emissiveIntensity: 0.55, transparent: true, opacity: 0.85 });
registerMat('glass_window', glass);
const glassDim = new THREE.MeshStandardMaterial({ color: 0x0a0f14, roughness: 0.1, metalness: 0.3, emissive: 0x0d1520, emissiveIntensity: 0.4 });
registerMat('glass_dim', glassDim);
const waterShallow = new THREE.MeshStandardMaterial({ color: 0x1b2418, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.7 });
registerMat('water_shallow', waterShallow);

const NOWAINSCOT = new Set(['tile_wall', 'plaster_dirty', 'wood_panel', 'brick', 'stone', 'sewer_brick', 'concrete', 'attic_boards', 'wood_planks', 'hedge']);

function exteriorMat(style: string): string {
  switch (style) {
    case 'garage_brick':
      return 'garage_brick';
    case 'hedge':
      return 'hedge';
    case 'fence':
      return 'fence';
    case 'shed':
      return 'shed';
    case 'rock':
      return 'rock';
    default:
      return 'facade';
  }
}

export function buildLevelMesh(level: Level): THREE.Group {
  const mb = new MeshBuilder();
  const W = level.W;
  const D = level.D;
  const rooms = level.rooms;
  const typeAt = (f: number, x: number, z: number) => (f < 0 || f >= FLOOR_COUNT || x < 0 || z < 0 || x >= W || z >= D ? CT.SOLID : level.floors[f].type[z * W + x]);
  const roomAt = (f: number, x: number, z: number) => (f < 0 || f >= FLOOR_COUNT || x < 0 || z < 0 || x >= W || z >= D ? -1 : level.floors[f].room[z * W + x]);
  /**
   * The slab between floor f and f+1 is open above a cell only for the stairwell of a staircase
   * that starts on floor f, or under the open part of a double-height room. Everywhere else the
   * slab is solid: the ceiling of f and the floor of f+1 are its two faces.
   */
  const openAbove = (f: number, k: number) => {
    if (f + 1 >= FLOOR_COUNT) return false;
    const up = level.floors[f + 1];
    const t = up.type[k];
    if (t === CT.STAIR) return level.stairs[up.ent[k]].spec.lower === f;
    return t === CT.VOID && up.room[k] >= 0;
  };
  const doorRoom = (f: number, x: number, z: number) => {
    const d = level.doors[level.floors[f].ent[z * W + x]];
    return d.rooms[0] >= 0 ? d.rooms[0] : d.rooms[1];
  };

  for (let f = 0; f < FLOOR_COUNT; f++) {
    const g = level.floors[f];
    const base = g.base;
    const ch = g.ceilH;
    const top = f === FLOOR_COUNT - 1;
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        const k = z * W + x;
        const t = g.type[k];
        const fl = g.flags[k];
        // ---------------------------------------------------------------- floors
        if (t === CT.FLOOR || t === CT.OUTDOOR || t === CT.DOOR || t === CT.RAIL || t === CT.WATER) {
          const ri = t === CT.DOOR ? doorRoom(f, x, z) : g.room[k];
          let mat = ri >= 0 ? rooms[ri].spec.floor : 'concrete';
          // balustrade cells over the open hall belong to the hall below: use the gallery boards
          if (t === CT.RAIL && ri >= 0 && rooms[ri].spec.f !== f) mat = 'wood_dark';
          if (fl & F.GRATE) mat = 'rust';
          mb.hquad(mat, f, x, z, x + 1, z + 1, base, true);
          if (fl & F.SHALLOW) mb.hquad('water_shallow', f, x, z, x + 1, z + 1, base + 0.05, true);
        }
        // grass under hedges and fences
        if (t === CT.SOLID && f === 2) {
          const st = SOLID_STYLES[g.style[k]];
          if (st === 'fence' || st === 'hedge') mb.hquad('grass', f, x, z, x + 1, z + 1, 0, true);
        }
        // ---------------------------------------------------------------- ceilings
        const indoor = t === CT.FLOOR || t === CT.DOOR || t === CT.RAIL || t === CT.WATER || t === CT.STAIR || (t === CT.VOID && g.room[k] >= 0);
        if (indoor) {
          const above = f + 1 < FLOOR_COUNT ? level.floors[f + 1] : null;
          const at = above ? above.type[k] : CT.VOID;
          if (!openAbove(f, k)) {
            const ri = g.room[k];
            const zone = ri >= 0 ? rooms[ri].spec.zone : 'basement';
            const cm = zone === 'attic' || zone === 'garden' ? 'ceiling_wood' : zone === 'basement' || zone === 'sewer' || zone === 'garage' ? 'concrete' : 'ceiling';
            mb.hquad(zone === 'sewer' ? 'sewer_brick' : cm, f, x, z, x + 1, z + 1, base + ch, false);
            // roof cap above single-storey buildings (garage, shed)
            if (!above || (at === CT.VOID && above.room[k] < 0)) mb.hquad('roof', f, x, z, x + 1, z + 1, base + FLOOR_HEIGHT - 0.02, true);
          }
        }
        // ---------------------------------------------------------------- walls
        if (t !== CT.SOLID) continue;
        const style = SOLID_STYLES[g.style[k]];
        const window = !!(fl & F.WINDOW);
        const sides: [number, number, 'x' | 'z', number, 1 | -1][] = [
          [x - 1, z, 'x', x, -1],
          [x + 1, z, 'x', x + 1, 1],
          [x, z - 1, 'z', z, -1],
          [x, z + 1, 'z', z + 1, 1],
        ];
        let capNeeded = false;
        for (const [nx, nz, axis, at, sign] of sides) {
          const nt = typeAt(f, nx, nz);
          if (nt === CT.SOLID) continue;
          const nr = roomAt(f, nx, nz);
          const from = axis === 'x' ? z : x;
          const to = from + 1;
          const exterior = nt === CT.OUTDOOR || (nt === CT.VOID && nr < 0);
          if (exterior) {
            const mat = exteriorMat(style);
            let h = mat === 'hedge' ? 2.6 : mat === 'fence' ? 2.2 : top ? ch : FLOOR_HEIGHT;
            let y0 = base;
            if (f < 2 && mat === 'rock') h = (2 - f) * FLOOR_HEIGHT; // pits up to ground level
            if (nt === CT.VOID && f > 2) y0 = base;
            if (window && mat === 'facade') windowFace(mb, f, axis, at, from, to, y0, y0 + h, sign, mat, true);
            else mb.wall(mat, f, axis, at, from, to, y0, y0 + h, sign);
            if (mat === 'hedge') capNeeded = true;
            continue;
          }
          if (nt === CT.DOOR) {
            mb.wall('trim', f, axis, at, from, to, base, base + DOOR_H, sign);
            mb.wall('plaster_dirty', f, axis, at, from, to, base + DOOR_H, base + ch, sign);
            continue;
          }
          const ri = nr >= 0 ? nr : -1;
          const spec = ri >= 0 ? rooms[ri].spec : null;
          const mat = spec ? spec.wall : 'stone';
          // extend over the floor slab where the space above is open (double-height hall, stairwells)
          const extend = openAbove(f, nz * W + nx);
          const y1 = base + (extend ? FLOOR_HEIGHT : ch);
          if (window) {
            windowFace(mb, f, axis, at, from, to, base, y1, sign, mat, false);
            continue;
          }
          if (spec?.zone === 'mansion' && !NOWAINSCOT.has(mat)) {
            mb.wall('trim', f, axis, at, from, to, base, base + 0.95, sign);
            mb.wall(mat, f, axis, at, from, to, base + 0.95, y1, sign);
            // chair rail
            const off = 0.03 * sign;
            if (axis === 'x') mb.box('trim', f, at + off, base + 0.97, (from + to) / 2, 0.06, 0.06, 1);
            else mb.box('trim', f, (from + to) / 2, base + 0.97, at + off, 1, 0.06, 0.06);
          } else mb.wall(mat, f, axis, at, from, to, base, y1, sign);
        }
        if (capNeeded) mb.hquad('hedge', f, x, z, x + 1, z + 1, base + 2.6, true);
      }

    // ---------------------------------------------------------------- lintels above doors
    for (const d of level.doors) {
      if (d.spec.f !== f) continue;
      for (const [x, z] of d.spec.cells) {
        const top = d.spec.kind === 'shutter' ? 3.0 : d.spec.kind === 'gate_chain' || d.spec.kind === 'grate' || d.spec.kind === 'floodgate' ? ch : DOOR_H;
        const aType = f + 1 < FLOOR_COUNT ? level.floors[f + 1].type[z * W + x] : CT.VOID;
        const outdoorish = typeAt(f, d.pass === 'z' ? x : x - 1, d.pass === 'z' ? z - 1 : z) === CT.OUTDOOR || typeAt(f, d.pass === 'z' ? x : x + 1, d.pass === 'z' ? z + 1 : z) === CT.OUTDOOR;
        const yTop = base + (outdoorish && aType !== CT.VOID ? FLOOR_HEIGHT : outdoorish ? (d.spec.kind === 'gate_chain' ? 2.6 : FLOOR_HEIGHT) : ch);
        if (d.spec.kind === 'gate_chain' || d.spec.kind === 'cage') continue;
        if (yTop - (base + top) > 0.01) mb.box(outdoorish ? 'facade' : 'plaster_dirty', f, x + 0.5, base + top + (yTop - base - top) / 2, z + 0.5, 1, yTop - base - top, 1);
        // door frame trim
        if (d.pass === 'z') {
          mb.box('trim', f, x + 0.5, base + top - 0.05, z + 0.5, 1, 0.1, 1.04);
        } else {
          mb.box('trim', f, x + 0.5, base + top - 0.05, z + 0.5, 1.04, 0.1, 1);
        }
      }
    }
  }

  // ---------------------------------------------------------------- slab edges
  // Where an open slab (stairwell, gallery void) meets a solid slab over a non-wall cell, close
  // the gap between this floor's ceiling and the next floor's floor with a vertical face.
  // Without it the space between storeys is visible (and with it the outside of the house).
  for (let f = 0; f < FLOOR_COUNT - 1; f++) {
    const g = level.floors[f];
    const y0 = g.base + g.ceilH;
    const y1 = g.base + FLOOR_HEIGHT;
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        const k = z * W + x;
        if (!openAbove(f, k)) continue;
        const sides: [number, number, 'x' | 'z', number, 1 | -1][] = [
          [x - 1, z, 'x', x, 1],
          [x + 1, z, 'x', x + 1, -1],
          [x, z - 1, 'z', z, 1],
          [x, z + 1, 'z', z + 1, -1],
        ];
        for (const [nx, nz, axis, at, sign] of sides) {
          if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
          const nk = nz * W + nx;
          if (g.type[nk] === CT.SOLID || openAbove(f, nk)) continue;
          const ri = g.room[nk] >= 0 ? g.room[nk] : g.room[k];
          const mat = ri >= 0 && rooms[ri].spec.zone === 'mansion' ? 'trim' : ri >= 0 ? rooms[ri].spec.wall : 'stone';
          const from = axis === 'x' ? z : x;
          mb.wall(mat, f, axis, at, from, from + 1, y0, y1, sign);
        }
      }
  }

  // ---------------------------------------------------------------- stairs
  for (const st of level.stairs) {
    const [x0, z0, x1, z1] = st.spec.rect;
    const lower = level.floors[st.spec.lower];
    const zone = rooms[lower.room[z0 * W + x0]]?.spec.zone ?? 'basement';
    const mat = zone === 'mansion' ? 'wood_dark' : zone === 'attic' ? 'attic_boards' : zone === 'garage' ? 'concrete' : 'stone';
    const alongZ = st.spec.dir === '-z' || st.spec.dir === '+z';
    const len = alongZ ? z1 - z0 + 1 : x1 - x0 + 1;
    const width = alongZ ? x1 - x0 + 1 : z1 - z0 + 1;
    const steps = len * 3;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const h = lower.base + t1 * FLOOR_HEIGHT;
      const depth = len / steps;
      let cx: number;
      let cz: number;
      switch (st.spec.dir) {
        case '-z':
          cz = z1 + 1 - (t0 + t1) * 0.5 * len;
          cx = (x0 + x1 + 1) / 2;
          break;
        case '+z':
          cz = z0 + (t0 + t1) * 0.5 * len;
          cx = (x0 + x1 + 1) / 2;
          break;
        case '-x':
          cx = x1 + 1 - (t0 + t1) * 0.5 * len;
          cz = (z0 + z1 + 1) / 2;
          break;
        default:
          cx = x0 + (t0 + t1) * 0.5 * len;
          cz = (z0 + z1 + 1) / 2;
      }
      const hh = h - lower.base;
      mb.box(mat, st.spec.lower, cx, lower.base + hh / 2, cz, alongZ ? width : depth, hh, alongZ ? depth : width);
      // step nosing
      mb.box('trim', st.spec.lower, cx, h + 0.01, cz, alongZ ? width : depth + 0.02, 0.03, alongZ ? depth + 0.02 : width);
    }
    // banisters along both sides
    const sides = alongZ ? [x0 + 0.05, x1 + 0.95] : [z0 + 0.05, z1 + 0.95];
    for (const s of sides) {
      for (let i = 0; i <= len * 2; i++) {
        const t = i / (len * 2);
        let px: number;
        let pz: number;
        switch (st.spec.dir) {
          case '-z':
            pz = z1 + 1 - t * len;
            px = s;
            break;
          case '+z':
            pz = z0 + t * len;
            px = s;
            break;
          case '-x':
            px = x1 + 1 - t * len;
            pz = s;
            break;
          default:
            px = x0 + t * len;
            pz = s;
        }
        const gy = stairHeight(st, Math.min(x1 + 0.99, Math.max(x0, px)), Math.min(z1 + 0.99, Math.max(z0, pz)));
        mb.box('trim', st.spec.lower, px, gy + 0.5, pz, 0.05, 1.0, 0.05);
      }
      // hand rail as a sloped thin box
      const rail = new THREE.BoxGeometry(0.08, 0.06, Math.hypot(len, FLOOR_HEIGHT));
      const ang = Math.atan2(FLOOR_HEIGHT, len);
      const mid = new THREE.Vector3();
      const m = new THREE.Matrix4();
      switch (st.spec.dir) {
        case '-z':
          mid.set(s, lower.base + FLOOR_HEIGHT / 2 + 1.0, z1 + 1 - len / 2);
          m.makeRotationX(-ang);
          break;
        case '+z':
          mid.set(s, lower.base + FLOOR_HEIGHT / 2 + 1.0, z0 + len / 2);
          m.makeRotationX(ang);
          break;
        case '-x':
          mid.set(x1 + 1 - len / 2, lower.base + FLOOR_HEIGHT / 2 + 1.0, s);
          m.makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeRotationX(-ang));
          break;
        default:
          mid.set(x0 + len / 2, lower.base + FLOOR_HEIGHT / 2 + 1.0, s);
          m.makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeRotationX(ang));
      }
      m.setPosition(mid);
      mb.geom('trim', st.spec.lower, rail, m);
      rail.dispose();
    }
  }

  // ---------------------------------------------------------------- rails & cage bars
  for (let f = 0; f < FLOOR_COUNT; f++) {
    const g = level.floors[f];
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        const k = z * W + x;
        if (g.type[k] !== CT.RAIL) continue;
        const bars = SOLID_STYLES[g.style[k]] === 'bars';
        const nx = typeAt(f, x - 1, z) === CT.RAIL || typeAt(f, x + 1, z) === CT.RAIL;
        const nz = typeAt(f, x, z - 1) === CT.RAIL || typeAt(f, x, z + 1) === CT.RAIL;
        const alongX = nx || !nz;
        if (bars) {
          const h = 2.6;
          for (let i = 0; i < 8; i++) {
            const o = (i + 0.5) / 8;
            mb.box('bars', f, alongX ? x + o : x + 0.5, g.base + h / 2, alongX ? z + 0.5 : z + o, 0.04, h, 0.04);
          }
          for (const y of [0.15, 1.3, 2.55]) mb.box('rust', f, x + 0.5, g.base + y, z + 0.5, alongX ? 1 : 0.08, 0.06, alongX ? 0.08 : 1);
          continue;
        }
        // The whole rail cell blocks movement, so stand the balustrade on the edge that faces the
        // walkable floor: players stop right at it instead of at an invisible wall in front of it.
        const walk = (t: number) => t === CT.FLOOR || t === CT.DOOR;
        let ox = 0.5;
        let oz = 0.5;
        if (alongX) {
          if (walk(typeAt(f, x, z - 1))) oz = 0.08;
          else if (walk(typeAt(f, x, z + 1))) oz = 0.92;
        } else if (walk(typeAt(f, x - 1, z))) ox = 0.08;
        else if (walk(typeAt(f, x + 1, z))) ox = 0.92;
        mb.box('trim', f, x + ox, g.base + 1.0, z + oz, alongX ? 1.02 : 0.12, 0.08, alongX ? 0.12 : 1.02);
        mb.box('trim', f, x + ox, g.base + 0.08, z + oz, alongX ? 1.02 : 0.14, 0.16, alongX ? 0.14 : 1.02);
        for (let i = 0; i < 4; i++) {
          const o = (i + 0.5) / 4;
          mb.box('trim', f, alongX ? x + o : x + ox, g.base + 0.55, alongX ? z + oz : z + o, 0.05, 0.9, 0.05);
        }
      }
  }

  return mb.build();
}

/** A wall face with a window opening (sill, lintel, glass, frame). */
function windowFace(mb: MeshBuilder, f: number, axis: 'x' | 'z', at: number, from: number, to: number, y0: number, y1: number, sign: 1 | -1, mat: string, exterior: boolean) {
  const sill = y0 + 0.9;
  const head = Math.min(y1 - 0.3, y0 + 2.5);
  mb.wall(mat, f, axis, at, from, to, y0, sill, sign);
  mb.wall(mat, f, axis, at, from, to, head, y1, sign);
  // narrow wall strips beside the glass
  mb.wall(mat, f, axis, at, from, from + 0.15, sill, head, sign);
  mb.wall(mat, f, axis, at, to - 0.15, to, sill, head, sign);
  const recess = 0.12 * sign;
  mb.wall(exterior ? 'glass_dim' : 'glass_window', f, axis, at - recess, from + 0.15, to - 0.15, sill, head, sign);
  // reveal: the four faces of the recess between the wall face and the glass
  const d0 = Math.min(at, at - recess);
  const d1 = Math.max(at, at - recess);
  const u0 = from + 0.15;
  const u1 = to - 0.15;
  if (axis === 'x') {
    mb.wall(mat, f, 'z', u0, d0, d1, sill, head, 1);
    mb.wall(mat, f, 'z', u1, d0, d1, sill, head, -1);
    mb.hquad('trim', f, d0, u0, d1, u1, sill, true);
    mb.hquad(mat, f, d0, u0, d1, u1, head, false);
  } else {
    mb.wall(mat, f, 'x', u0, d0, d1, sill, head, 1);
    mb.wall(mat, f, 'x', u1, d0, d1, sill, head, -1);
    mb.hquad('trim', f, u0, d0, u1, d1, sill, true);
    mb.hquad(mat, f, u0, d0, u1, d1, head, false);
  }
  const mid = (from + to) / 2;
  const fy = (sill + head) / 2;
  const fh = head - sill;
  const frame = 'trim';
  if (axis === 'x') {
    mb.box(frame, f, at, sill - 0.03, mid, 0.3, 0.06, 0.8);
    mb.box(frame, f, at - recess, fy, mid, 0.04, fh, 0.05);
    mb.box(frame, f, at - recess, fy, mid, 0.04, 0.05, 0.7);
  } else {
    mb.box(frame, f, mid, sill - 0.03, at, 0.8, 0.06, 0.3);
    mb.box(frame, f, mid, fy, at - recess, 0.05, fh, 0.04);
    mb.box(frame, f, mid, fy, at - recess, 0.7, 0.05, 0.04);
  }
}

/** Hip roof over the mansion, chimneys, garage/shed eaves. */
export function buildRoof(): THREE.Group {
  const group = new THREE.Group();
  const x0 = 19.6;
  const x1 = 77.4;
  const z0 = 15.6;
  const z1 = 57.4;
  const eave = 7.98;
  const half = (z1 - z0) / 2;
  const ridge = eave + half * 0.45;
  const rx0 = x0 + half;
  const rx1 = x1 - half;
  const zc = (z0 + z1) / 2;
  const pos = [
    // front slope (+z)
    x0, eave, z1, x1, eave, z1, rx1, ridge, zc, rx0, ridge, zc,
    // back slope (-z)
    x1, eave, z0, x0, eave, z0, rx0, ridge, zc, rx1, ridge, zc,
    // west triangle
    x0, eave, z0, x0, eave, z1, rx0, ridge, zc, rx0, ridge, zc,
    // east triangle
    x1, eave, z1, x1, eave, z0, rx1, ridge, zc, rx1, ridge, zc,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uvs: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uvs.push(pos[i] / 3, (pos[i + 1] + pos[i + 2]) / 3);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 12, 13, 14]);
  g.computeVertexNormals();
  const roof = new THREE.Mesh(g, roofMaterial());
  roof.castShadow = false;
  group.add(roof);
  const mb = new MeshBuilder();
  // chimneys
  for (const [cx, cz] of [
    [30, 26],
    [64, 44],
    [48, 22],
  ]) {
    mb.box('brick', 3, cx, ridge - 1.5, cz, 1.4, 6, 1.4);
    mb.box('stone', 3, cx, ridge + 1.55, cz, 1.6, 0.2, 1.6);
  }
  // eave fascia
  mb.box('trim', 3, (x0 + x1) / 2, eave - 0.1, z1, x1 - x0, 0.25, 0.15);
  mb.box('trim', 3, (x0 + x1) / 2, eave - 0.1, z0, x1 - x0, 0.25, 0.15);
  mb.box('trim', 3, x0, eave - 0.1, (z0 + z1) / 2, 0.15, 0.25, z1 - z0);
  mb.box('trim', 3, x1, eave - 0.1, (z0 + z1) / 2, 0.15, 0.25, z1 - z0);
  // porch canopy over the main entrance
  mb.box('roof', 2, 48.9, 3.3, 57.4, 4.5, 0.2, 2.0);
  mb.box('stone', 2, 46.9, 1.6, 58.2, 0.35, 3.2, 0.35);
  mb.box('stone', 2, 50.9, 1.6, 58.2, 0.35, 3.2, 0.35);
  mb.box('stone', 2, 48.9, 0.06, 57.5, 5, 0.12, 2.2);
  group.add(mb.build());
  return group;
}

function roofMaterial() {
  const map = getTexture('roof');
  return new THREE.MeshStandardMaterial({ map, roughness: 0.85, side: THREE.DoubleSide, emissive: 0x0a0d14, emissiveMap: map, emissiveIntensity: 1.6 });
}

export { pk };
