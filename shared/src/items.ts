/** Item catalogue. Critical items are unique; tools may have several copies. */
import type { SpawnCat, Zone } from './level/types';

export type ItemRoute = 'front' | 'garage' | 'sewer' | 'key' | 'tool';
export type ItemMaterial = 'metal' | 'glass' | 'wood' | 'plastic' | 'paper' | 'heavy';

export interface ItemDef {
  type: string;
  name: string;
  description: string;
  route: ItemRoute;
  cat: SpawnCat;
  material: ItemMaterial;
  heavy?: boolean;
  count: number;
  /** F-key action while held. */
  use?: 'throw' | 'decoy' | 'flash';
  /** Picked up straight into the flashlight instead of the hand. */
  battery?: boolean;
  /** Zones where this item may spawn. */
  zones: Zone[];
  color: number;
}

const HOUSE: Zone[] = ['mansion', 'basement', 'attic', 'garage', 'garden'];
const ANY: Zone[] = ['mansion', 'basement', 'attic', 'garage', 'garden', 'sewer'];

export const ITEMS: ItemDef[] = [
  // Route A — main entrance
  { type: 'entrance_key', name: 'Rusted Entrance Key', description: 'A heavy iron key, flaking with rust. Its bow is shaped like a clock face.', route: 'front', cat: 'small', material: 'metal', count: 1, zones: HOUSE, color: 0x8a5a33 },
  { type: 'lock_pick', name: 'Brass Lock Pick', description: 'A set of brass picks in a leather roll. Good enough for an old padlock.', route: 'front', cat: 'small', material: 'metal', count: 1, zones: HOUSE, color: 0xc9a24a },
  { type: 'fuse_module', name: 'Ceramic Fuse Module', description: 'A heavy ceramic fuse marked SECURITY. It belongs in a fuse board.', route: 'front', cat: 'small', material: 'plastic', count: 1, zones: HOUSE, color: 0xe8e0cc },
  { type: 'cipher_plate', name: 'Engraved Cipher Plate', description: 'A brass plate engraved with strange symbols, each paired with a digit.', route: 'front', cat: 'small', material: 'metal', count: 1, zones: HOUSE, color: 0xb08d3c },
  { type: 'gear_handle', name: 'Mechanical Gear Handle', description: 'A cranked handle ending in a toothed gear. It fits a winch.', route: 'front', cat: 'medium', material: 'metal', count: 1, zones: HOUSE, color: 0x6c6f73 },
  // Keys to locked rooms
  { type: 'library_key', name: 'Library Key', description: 'A slender key with a tag reading "LIBRARY — DO NOT".', route: 'key', cat: 'small', material: 'metal', count: 1, zones: HOUSE, color: 0xb59a5a },
  { type: 'storage_key', name: 'Storage Room Key', description: 'A plain key on a loop of twine. "STORE" is scratched into it.', route: 'key', cat: 'small', material: 'metal', count: 1, zones: HOUSE, color: 0x9a9a8a },
  { type: 'clock_key', name: 'Clock Room Key', description: 'A tiny ornate key that ticks faintly when you hold it to your ear.', route: 'key', cat: 'small', material: 'metal', count: 1, zones: HOUSE, color: 0xd4b06a },
  // Route B — garage car
  { type: 'garage_key', name: 'Garage Access Key', description: 'A heavy steel key with a stamped tag: GARAGE.', route: 'garage', cat: 'small', material: 'metal', count: 1, zones: HOUSE, color: 0x7f8c8d },
  { type: 'car_battery', name: 'Vehicle Battery', description: 'A 12-volt lead battery. Heavy, and it still holds a charge.', route: 'garage', cat: 'heavy', material: 'heavy', heavy: true, count: 1, zones: HOUSE, color: 0x222222 },
  { type: 'ignition_coil', name: 'Ignition Coil', description: 'A cylindrical coil with cracked insulation. Should still spark.', route: 'garage', cat: 'small', material: 'metal', count: 1, zones: HOUSE, color: 0x2e4a2e },
  { type: 'starter_relay', name: 'Starter Relay', description: 'A small square relay. Without it the engine will not turn over.', route: 'garage', cat: 'small', material: 'plastic', count: 1, zones: HOUSE, color: 0x3a3a6a },
  { type: 'fuel_canister', name: 'Fuel Canister', description: 'A dented red canister. It sloshes — there is fuel inside.', route: 'garage', cat: 'heavy', material: 'heavy', heavy: true, count: 1, zones: HOUSE, color: 0xa01a12 },
  { type: 'wrench', name: 'Rust-Eaten Wrench', description: 'A big adjustable wrench. Strong enough for seized bolts.', route: 'garage', cat: 'medium', material: 'metal', count: 1, zones: HOUSE, color: 0x707070 },
  { type: 'car_key', name: 'Ignition Key', description: 'A car key on a ring with a tiny brass bell — muffled with tape.', route: 'garage', cat: 'small', material: 'metal', count: 1, zones: HOUSE, color: 0x444444 },
  // Route C — sewer
  { type: 'maintenance_key', name: 'Maintenance Key', description: 'A long key stamped MUNICIPAL DRAINAGE.', route: 'sewer', cat: 'small', material: 'metal', count: 1, zones: HOUSE, color: 0x5f7f6f },
  { type: 'pump_fuse', name: 'Pump Fuse', description: 'A cartridge fuse labelled PUMP. Green with corrosion.', route: 'sewer', cat: 'small', material: 'plastic', count: 1, zones: ANY, color: 0x3f7f3f },
  { type: 'valve_handle', name: 'Drainage Valve Handle', description: 'A detachable valve wheel handle with a square socket.', route: 'sewer', cat: 'medium', material: 'metal', count: 1, zones: ANY, color: 0x8b2b1f },
  { type: 'pressure_gauge', name: 'Pressure Gauge', description: 'A round brass gauge with a cracked glass face.', route: 'sewer', cat: 'small', material: 'glass', count: 1, zones: ANY, color: 0xb8913a },
  { type: 'floodgate_key', name: 'Floodgate Control Key', description: 'A T-shaped control key for a floodgate box.', route: 'sewer', cat: 'small', material: 'metal', count: 1, zones: ANY, color: 0x2f5f8f },
  { type: 'access_wheel', name: 'Sewer Access Wheel', description: 'A big iron wheel with a square hub. It turns grates.', route: 'sewer', cat: 'medium', material: 'metal', count: 1, zones: ANY, color: 0x4a4a4a },
  { type: 'hydraulic_tool', name: 'Hydraulic Spreader', description: 'A hand-pumped spreader. It can force a rusted grate open.', route: 'sewer', cat: 'medium', material: 'metal', count: 1, zones: HOUSE, color: 0xc28b1f },
  // Tools
  { type: 'bottle', name: 'Glass Bottle', description: 'Empty. Throw it (F) and it will shatter loudly where it lands.', route: 'tool', cat: 'small', material: 'glass', use: 'throw', count: 3, zones: HOUSE, color: 0x2f6f4f },
  { type: 'decoy', name: 'Clockwork Decoy', description: 'A wind-up tin drummer. Set it down (F) and it rattles after a moment.', route: 'tool', cat: 'small', material: 'metal', use: 'decoy', count: 2, zones: ANY, color: 0x9a3a2a },
  { type: 'flash_camera', name: 'Old Flash Camera', description: 'A bellows camera with a working flash. Blinds him for a few seconds (F). Two bulbs left.', route: 'tool', cat: 'small', material: 'metal', use: 'flash', count: 1, zones: HOUSE, color: 0x1a1a1a },
  { type: 'battery_cell', name: 'Flashlight Battery', description: 'Recharges your flashlight.', route: 'tool', cat: 'small', material: 'metal', battery: true, count: 5, zones: ANY, color: 0xd8b02a },
];

export const ITEM_BY_TYPE = new Map(ITEMS.map((d) => [d.type, d]));

export function itemDef(type: string): ItemDef {
  const d = ITEM_BY_TYPE.get(type);
  if (!d) throw new Error(`unknown item ${type}`);
  return d;
}

/** Noise produced when an item hits the ground. */
export function dropNoise(material: ItemMaterial): number {
  switch (material) {
    case 'metal':
      return 22;
    case 'glass':
      return 26;
    case 'heavy':
      return 28;
    case 'wood':
      return 12;
    default:
      return 9;
  }
}

/** Required items per escape route (used by objectives and placement validation). */
export const ROUTE_ITEMS: Record<'front' | 'garage' | 'sewer', string[]> = {
  front: ['entrance_key', 'lock_pick', 'fuse_module', 'cipher_plate', 'gear_handle'],
  garage: ['garage_key', 'car_battery', 'ignition_coil', 'starter_relay', 'fuel_canister', 'wrench', 'car_key'],
  sewer: ['maintenance_key', 'pump_fuse', 'valve_handle', 'pressure_gauge', 'floodgate_key', 'access_wheel'],
};

/** Every item instance id spawned in a match. Unique items use their type as id. */
export function allItemIds(): { id: string; type: string }[] {
  const out: { id: string; type: string }[] = [];
  for (const d of ITEMS) {
    if (d.count === 1) out.push({ id: d.type, type: d.type });
    else for (let i = 0; i < d.count; i++) out.push({ id: `${d.type}#${i + 1}`, type: d.type });
  }
  return out;
}
