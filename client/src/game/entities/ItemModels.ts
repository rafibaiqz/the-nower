/** Procedural models for every item type (original designs built from primitives). */
import * as THREE from 'three';
import { itemDef } from '@nower/shared';
import { getMat, plain, textTexture } from '../world/textures';

const cache = new Map<string, THREE.Group>();

function m(color: number, rough = 0.6, metal = 0.5) {
  return plain(color, rough, metal);
}

function mesh(g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(g, mat);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.castShadow = true;
  return o;
}

function key(color: number, size = 1) {
  const g = new THREE.Group();
  const mat = m(color, 0.45, 0.8);
  g.add(mesh(new THREE.TorusGeometry(0.03 * size, 0.008 * size, 6, 16), mat, -0.07 * size, 0, 0, Math.PI / 2));
  g.add(mesh(new THREE.BoxGeometry(0.12 * size, 0.01 * size, 0.012 * size), mat, 0.02 * size, 0, 0));
  g.add(mesh(new THREE.BoxGeometry(0.012 * size, 0.01 * size, 0.03 * size), mat, 0.07 * size, 0, 0.015 * size));
  g.add(mesh(new THREE.BoxGeometry(0.012 * size, 0.01 * size, 0.02 * size), mat, 0.05 * size, 0, 0.01 * size));
  return g;
}

function build(type: string): THREE.Group {
  const d = itemDef(type);
  const c = d.color;
  const g = new THREE.Group();
  switch (type) {
    case 'entrance_key':
      g.add(key(c, 1.6));
      break;
    case 'library_key':
    case 'storage_key':
    case 'clock_key':
    case 'garage_key':
    case 'maintenance_key':
      g.add(key(c, type === 'maintenance_key' ? 1.4 : 1.1));
      if (type !== 'clock_key') g.add(mesh(new THREE.BoxGeometry(0.04, 0.003, 0.025), m(0xb8a888, 0.9, 0), -0.13, 0, 0.02, 0, 0.3, 0));
      break;
    case 'car_key':
      g.add(mesh(new THREE.BoxGeometry(0.035, 0.012, 0.05), m(0x111111, 0.6, 0.1), -0.03, 0, 0));
      g.add(mesh(new THREE.BoxGeometry(0.07, 0.006, 0.015), m(0x999999, 0.3, 0.9), 0.025, 0, 0));
      g.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), m(0xc0a040, 0.3, 0.9), -0.07, 0, 0));
      break;
    case 'lock_pick':
      g.add(mesh(new THREE.BoxGeometry(0.16, 0.012, 0.07), m(0x4a2a18, 0.8, 0)));
      for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(0.14, 0.004, 0.004), m(c, 0.3, 0.9), 0.02, 0.01, -0.025 + i * 0.016));
      break;
    case 'fuse_module':
      g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 12), m(c, 0.4, 0), 0, 0.025, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.02, 12), m(0xb08040, 0.3, 0.9), 0.06, 0.025, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.02, 12), m(0xb08040, 0.3, 0.9), -0.06, 0.025, 0, 0, 0, Math.PI / 2));
      break;
    case 'pump_fuse':
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.09, 10), m(c, 0.6, 0.2), 0, 0.02, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.015, 10), m(0x5a7a5a, 0.5, 0.7), 0.045, 0.02, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.015, 10), m(0x5a7a5a, 0.5, 0.7), -0.045, 0.02, 0, 0, 0, Math.PI / 2));
      break;
    case 'cipher_plate': {
      const tex = textTexture(['☽ ✶ ♄ ☿ ✠', '♆ ☉ ⚘ ◬ ⌘'], { w: 256, h: 128, bg: '#6a5426', fg: '#2a1c08', font: 'bold 34px serif' });
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.01, 0.12), new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.8 })));
      const top = mesh(new THREE.PlaneGeometry(0.19, 0.11), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.6 }), 0, 0.006, 0, -Math.PI / 2);
      g.add(top);
      break;
    }
    case 'gear_handle':
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12), m(c, 0.5, 0.8), 0, 0.015, 0));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.add(mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), m(c, 0.5, 0.8), Math.cos(a) * 0.065, 0.015, Math.sin(a) * 0.065, 0, -a, 0));
      }
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.02, 0.025), m(0x3a3a3a, 0.6, 0.7), 0.15, 0.035, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 8), m(0x3a2010, 0.8, 0), 0.3, 0.08, 0));
      break;
    case 'car_battery':
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.18), m(c, 0.7, 0.1), 0, 0.1, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.03, 8), m(0xa02020, 0.5, 0.6), 0.09, 0.21, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.03, 8), m(0x202020, 0.5, 0.6), -0.09, 0.21, 0));
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.02, 0.02), m(0x111111, 0.8, 0), 0, 0.23, 0.06));
      break;
    case 'ignition_coil':
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.15, 12), m(c, 0.5, 0.3), 0, 0.035, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8), m(0x111111, 0.6, 0.2), 0.09, 0.035, 0, 0, 0, Math.PI / 2));
      break;
    case 'starter_relay':
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.05, 0.06), m(c, 0.5, 0.2), 0, 0.025, 0));
      for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(0.005, 0.02, 0.01), m(0xc0a060, 0.3, 0.9), -0.015 + i * 0.015, -0.005, 0));
      break;
    case 'fuel_canister':
      g.add(mesh(new THREE.BoxGeometry(0.26, 0.34, 0.14), m(c, 0.6, 0.3), 0, 0.17, 0));
      g.add(mesh(new THREE.BoxGeometry(0.12, 0.04, 0.03), m(c, 0.6, 0.3), -0.04, 0.37, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 8), m(0x222222, 0.5, 0.6), 0.09, 0.37, 0));
      break;
    case 'wrench':
      g.add(mesh(new THREE.BoxGeometry(0.32, 0.015, 0.035), m(c, 0.5, 0.8), 0, 0.01, 0));
      g.add(mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 12, Math.PI * 1.4), m(c, 0.5, 0.8), 0.19, 0.01, 0, Math.PI / 2, 0, 0.9));
      break;
    case 'valve_handle':
    case 'access_wheel': {
      const r = type === 'access_wheel' ? 0.22 : 0.12;
      g.add(mesh(new THREE.TorusGeometry(r, r * 0.12, 6, 20), m(c, 0.6, 0.7), 0, r * 0.12, 0, Math.PI / 2));
      for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(r * 2, 0.015, 0.02), m(c, 0.6, 0.7), 0, r * 0.12, 0, 0, (i * Math.PI) / 4, 0));
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), m(0x222222, 0.6, 0.7), 0, r * 0.12, 0));
      break;
    }
    case 'pressure_gauge':
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16), m(c, 0.4, 0.8), 0, 0.015, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.005, 16), plain(0xd8d0b0, 0.4), 0, 0.032, 0));
      g.add(mesh(new THREE.BoxGeometry(0.04, 0.004, 0.004), plain(0x8a1010, 0.5), 0.012, 0.036, 0, 0, 0.6, 0));
      break;
    case 'floodgate_key':
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.02, 0.02), m(c, 0.5, 0.8), 0, 0.01, 0));
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.02, 0.12), m(c, 0.5, 0.8), 0.1, 0.01, 0));
      break;
    case 'hydraulic_tool':
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 10), m(c, 0.5, 0.5), 0, 0.04, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.BoxGeometry(0.12, 0.02, 0.05), m(0x333333, 0.6, 0.8), 0.2, 0.04, 0.02, 0, 0.3, 0));
      g.add(mesh(new THREE.BoxGeometry(0.12, 0.02, 0.05), m(0x333333, 0.6, 0.8), 0.2, 0.04, -0.02, 0, -0.3, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), m(0x222222, 0.6, 0.6), -0.12, 0.1, 0, 0, 0, 0.8));
      break;
    case 'bottle':
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), new THREE.MeshStandardMaterial({ color: c, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.75 }), 0, 0.1, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.08, 10), new THREE.MeshStandardMaterial({ color: c, roughness: 0.1, transparent: true, opacity: 0.75 }), 0, 0.24, 0));
      break;
    case 'decoy':
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.08, 12), m(c, 0.4, 0.6), 0, 0.04, 0));
      g.add(mesh(new THREE.SphereGeometry(0.03, 8, 6), plain(0xd8c8a0, 0.6), 0, 0.12, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), plain(0xe0d0b0, 0.5), 0, 0.09, 0));
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.01, 0.01), m(0xb08a3a, 0.3, 0.9), 0.05, 0.05, 0));
      break;
    case 'flash_camera':
      g.add(mesh(new THREE.BoxGeometry(0.14, 0.1, 0.08), m(c, 0.6, 0.2), 0, 0.05, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.06, 12), m(0x111111, 0.3, 0.5), 0, 0.05, 0.06, Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.04, 12), plain(0xdddddd, 0.2, 0.9), 0.07, 0.13, 0));
      break;
    case 'battery_cell':
      g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.06, 10), m(c, 0.4, 0.4), 0, 0.015, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 6), m(0xcccccc, 0.3, 0.9), 0.033, 0.015, 0, 0, 0, Math.PI / 2));
      break;
    default:
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), getMat('metal')));
  }
  // a very faint sheen so items can be spotted with the flashlight without glowing outlines
  g.traverse((o) => {
    const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (mm && 'emissive' in mm && !mm.transparent) {
      const cl = mm.clone();
      cl.emissive = new THREE.Color(c).multiplyScalar(0.12);
      (o as THREE.Mesh).material = cl;
    }
  });
  return g;
}

export function itemModel(type: string): THREE.Group {
  let base = cache.get(type);
  if (!base) {
    base = build(type);
    cache.set(type, base);
  }
  return base.clone();
}
