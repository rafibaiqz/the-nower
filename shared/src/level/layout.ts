/**
 * THE NOWER — authored layout of the Nower estate.
 *
 * Coordinates are integer cells (1 cell = 1 metre). Rect = [x0, z0, x1, z1] inclusive interior cells.
 * Rooms are carved out of solid rock / void; walls are the 1-cell gaps left between rooms.
 * +z points towards the front of the property (the road), -z towards the back garden.
 *
 * Floors: 0 sewer (y -8), 1 basement (y -4), 2 ground (y 0), 3 upper (y 4), 4 attic (y 8).
 */
import type { DoorSpec, LadderSpec, MechSpec, NoteSpec, PlaceSpec, Rect, RoomSpec, StairSpec, WaterZoneSpec } from './types';

export const S = 0;
export const B = 1;
export const G = 2;
export const U = 3;
export const A = 4;

export const CEIL_H = [3.0, 3.4, 3.6, 3.6, 2.6];

/** Default cell type each floor starts from before rooms are carved. */
export const FLOOR_DEFAULT: ('solid' | 'void')[] = ['solid', 'solid', 'solid', 'void', 'void'];

/** Solid footprints painted before rooms are carved (on void floors these become buildings). */
export const SOLID_RECTS: { f: number; rect: Rect; style: string }[] = [
  { f: G, rect: [20, 16, 76, 56], style: 'facade' },
  { f: G, rect: [76, 30, 90, 48], style: 'garage_brick' },
  { f: G, rect: [80, 5, 87, 11], style: 'shed' },
  { f: U, rect: [20, 16, 76, 56], style: 'facade' },
  { f: A, rect: [27, 22, 69, 50], style: 'facade' },
];

/** Exterior styles painted on solid cells (what you see from outside). */
export const STYLE_RECTS: { f: number; rect: Rect; style: string }[] = [
  { f: G, rect: [0, 0, 95, 3], style: 'fence' },
  { f: G, rect: [0, 0, 4, 87], style: 'fence' },
  { f: G, rect: [91, 0, 95, 87], style: 'fence' },
  { f: G, rect: [0, 87, 95, 87], style: 'fence' },
  { f: G, rect: [5, 56, 19, 80], style: 'hedge' },
  { f: G, rect: [77, 49, 77, 80], style: 'hedge' },
  { f: G, rect: [19, 80, 90, 80], style: 'fence' },
  { f: S, rect: [0, 0, 20, 5], style: 'rock' },
];

const runner = true;

export const ROOMS: RoomSpec[] = [
  // ======================= GROUND FLOOR — exterior =======================
  {
    id: 'garden', name: 'Overgrown Garden', f: G, rects: [[5, 4, 90, 15], [5, 16, 19, 55]], floor: 'grass', wall: 'hedge',
    zone: 'garden', outdoor: true, light: 'none', floorSpawns: 3,
    furnish: ['tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'deadbush', 'deadbush', 'deadbush', 'deadbush', 'deadbush', 'deadbush', 'grave', 'grave', 'grave', 'grave', 'grave', 'bench', 'fountain', 'crate', 'barrel'],
  },
  {
    id: 'courtyard', name: 'Rear Courtyard', f: G, rects: [[77, 16, 90, 29]], floor: 'gravel', wall: 'hedge', zone: 'garden',
    outdoor: true, light: 'lantern', lightOn: 1, floorSpawns: 1, furnish: ['watertank', 'barrel', 'barrel', 'crate', 'deadbush', 'tree'],
  },
  {
    id: 'frontyard', name: 'Front Yard', f: G, rects: [[20, 57, 76, 79]], floor: 'grass', wall: 'hedge', zone: 'yard', outdoor: true,
    light: 'none', noSpawn: true, noPatrol: true, furnish: ['tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'deadbush', 'deadbush', 'deadbush', 'deadbush', 'grave'],
  },
  {
    id: 'driveway', name: 'Driveway', f: G, rects: [[78, 49, 90, 79]], floor: 'gravel', wall: 'hedge', zone: 'yard', outdoor: true,
    light: 'none', noSpawn: true, noPatrol: true, furnish: ['tree', 'deadbush', 'barrel'],
  },
  {
    id: 'road', name: 'The Road', f: G, rects: [[5, 81, 90, 86], [47, 80, 49, 80]], floor: 'asphalt', wall: 'hedge', zone: 'road',
    outdoor: true, light: 'none', noSpawn: true, noPatrol: true, escape: 'front',
  },
  {
    id: 'shed', name: 'Garden Shed', f: G, rects: [[81, 6, 86, 10]], floor: 'wood_rough', wall: 'wood_planks', zone: 'garden',
    light: 'bulbs', lightOn: 0.5, floorSpawns: 2, furnish: ['workbench', 'shelf', 'barrel', 'crate'],
  },

  // ======================= GROUND FLOOR — mansion =======================
  {
    id: 'hall', name: 'Entrance Hall', f: G, rects: [[40, 41, 56, 55]], floor: 'marble', wall: 'damask_red', zone: 'mansion',
    light: 'chandelier', lightOn: 1, floorSpawns: 1, furnish: ['sidetable', 'sidetable', 'gclock', 'armchair', 'plant', 'plant', 'sheeted2', 'sidetable'],
  },
  {
    id: 'living', name: 'Living Room', f: G, rects: [[21, 41, 38, 55]], floor: 'parquet', wall: 'stripe_green', zone: 'mansion',
    light: 'chandelier', lightOn: 0.6, furnish: ['fireplace', 'sofa', 'armchair', 'armchair', 'table', 'piano', 'bookshelf', 'sidetable', 'cabinet', 'wardrobe', 'gclock'],
  },
  {
    id: 'dining', name: 'Dining Room', f: G, rects: [[58, 41, 75, 55]], floor: 'parquet', wall: 'damask_blue', zone: 'mansion',
    light: 'chandelier', lightOn: 0.5, furnish: ['bigtable', 'cabinet', 'cabinet', 'gclock', 'sidetable', 'chair', 'chair', 'chair', 'chair', 'locker', 'fireplace'],
  },
  {
    id: 'corridor', name: 'Main Corridor', f: G, rects: [[21, 37, 75, 39], [46, 40, 50, 40]], floor: 'wood_dark', wall: 'wainscot_brown', zone: 'mansion',
    light: 'sconces', lightOn: 0.55, runner, furnish: ['sidetable', 'sidetable', 'gclock', 'sidetable', 'plant', 'sidetable', 'gclock'],
  },
  {
    id: 'library', name: 'Library', f: G, rects: [[21, 17, 32, 28]], floor: 'wood_dark', wall: 'wood_panel', zone: 'mansion',
    light: 'lamp', lightOn: 1, furnish: ['bookshelf', 'bookshelf', 'bookshelf', 'bookshelf', 'bookshelf', 'bookshelf', 'desk', 'armchair', 'table', 'sidetable', 'gclock'],
  },
  {
    id: 'trophy', name: 'Trophy Room', f: G, rects: [[21, 30, 32, 35]], floor: 'wood_dark', wall: 'wood_panel', zone: 'mansion',
    light: 'lamp', lightOn: 0.4, furnish: ['trophycase', 'trophycase', 'sofa', 'sidetable', 'armchair'],
  },
  {
    id: 'study', name: 'Study', f: G, rects: [[34, 17, 43, 25]], floor: 'carpet_red', wall: 'damask_red', zone: 'mansion',
    light: 'lamp', lightOn: 0.8, furnish: ['desk', 'bookshelf', 'bookshelf', 'armchair', 'cabinet', 'sidetable', 'wardrobe'],
  },
  {
    id: 'guest', name: 'Guest Bedroom', f: G, rects: [[34, 27, 43, 35]], floor: 'wood', wall: 'floral_faded', zone: 'mansion',
    light: 'lamp', lightOn: 0.3, furnish: ['bed', 'wardrobe', 'nightstand', 'dresser', 'chair', 'vanity'],
  },
  {
    id: 'storage', name: 'Locked Storage Room', f: G, rects: [[45, 17, 50, 22]], floor: 'wood_rough', wall: 'plaster_dirty', zone: 'mansion',
    light: 'bulbs', lightOn: 0.4, floorSpawns: 2, furnish: ['shelf', 'shelf', 'crate', 'trunk', 'sheeted'],
  },
  {
    id: 'rearhall', name: 'Rear Hall', f: G, rects: [[45, 24, 50, 35]], floor: 'wood', wall: 'wainscot_brown', zone: 'mansion',
    light: 'sconces', lightOn: 0.5, furnish: ['sidetable', 'locker'],
  },
  {
    id: 'pantry', name: 'Pantry', f: G, rects: [[52, 17, 65, 21]], floor: 'tile_dirty', wall: 'plaster_dirty', zone: 'mansion',
    light: 'bulbs', lightOn: 0.5, floorSpawns: 1, furnish: ['pantryshelf', 'pantryshelf', 'pantryshelf', 'crate', 'barrel', 'crate'],
  },
  {
    id: 'kitchen', name: 'Kitchen', f: G, rects: [[52, 23, 65, 35]], floor: 'tile_checker', wall: 'tile_wall', zone: 'mansion',
    light: 'lamp', lightOn: 0.7, floorSpawns: 1, furnish: ['counter', 'counter', 'counter', 'stove', 'fridge', 'sink', 'bigtable', 'chair', 'chair', 'cabinet', 'locker'],
  },
  {
    id: 'conservatory', name: 'Conservatory', f: G, rects: [[67, 17, 75, 27]], floor: 'tile_terracotta', wall: 'plaster_dirty', zone: 'mansion',
    light: 'none', floorSpawns: 1, furnish: ['plant', 'plant', 'plant', 'plant', 'plant', 'bench', 'table', 'chair', 'sidetable'],
  },
  {
    id: 'utility', name: 'Utility Room', f: G, rects: [[67, 29, 75, 35]], floor: 'concrete', wall: 'plaster_dirty', zone: 'mansion',
    light: 'bulbs', lightOn: 0.6, floorSpawns: 1, furnish: ['shelf', 'locker', 'crate'],
  },
  {
    id: 'garage', name: 'Garage', f: G, rects: [[77, 31, 89, 47]], floor: 'concrete_oil', wall: 'brick', zone: 'garage',
    light: 'fluoro', lightOn: 0.7, floorSpawns: 3, furnish: ['workbench', 'workbench', 'shelf', 'shelf', 'toolchest', 'tirestack', 'tirestack', 'barrel', 'locker'],
  },

  // ======================= UPPER FLOOR =======================
  {
    id: 'gallery', name: 'Gallery Balcony', f: U, rects: [[40, 41, 56, 44], [46, 40, 50, 40]], floor: 'wood_dark', wall: 'damask_red', zone: 'mansion',
    light: 'sconces', lightOn: 0.6, furnish: ['sidetable', 'armchair', 'sidetable'],
  },
  {
    id: 'ucorridor', name: 'Upper Corridor', f: U, rects: [[21, 37, 75, 39]], floor: 'wood', wall: 'floral_faded', zone: 'mansion',
    light: 'sconces', lightOn: 0.45, runner, furnish: ['sidetable', 'sidetable', 'gclock', 'sidetable', 'plant', 'sidetable'],
  },
  {
    id: 'westbed', name: 'West Bedroom', f: U, rects: [[21, 17, 32, 28]], floor: 'wood', wall: 'floral_faded', zone: 'mansion',
    light: 'lamp', lightOn: 0, noPatrol: true, furnish: ['bed', 'wardrobe', 'nightstand', 'dresser', 'chair', 'rockinghorse'],
  },
  {
    id: 'sewing', name: 'Sewing Room', f: U, rects: [[21, 30, 32, 35]], floor: 'wood', wall: 'stripe_green', zone: 'mansion',
    light: 'lamp', lightOn: 0.5, furnish: ['table', 'sewingmachine', 'mannequin', 'mannequin', 'shelf', 'chair', 'trunk'],
  },
  {
    id: 'clockroom', name: 'Clock Room', f: U, rects: [[34, 17, 43, 25]], floor: 'wood_dark', wall: 'wood_panel', zone: 'mansion',
    light: 'lamp', lightOn: 1, furnish: ['gclock', 'gclock', 'gclock', 'gclock', 'workbench', 'workbench', 'shelf', 'desk'],
  },
  {
    id: 'guestsuite', name: 'Guest Suite', f: U, rects: [[34, 27, 43, 35]], floor: 'carpet_red', wall: 'damask_blue', zone: 'mansion',
    light: 'lamp', lightOn: 0.4, furnish: ['bed', 'wardrobe', 'nightstand', 'nightstand', 'dresser', 'armchair'],
  },
  {
    id: 'backlanding', name: 'Back Landing', f: U, rects: [[45, 17, 50, 35]], floor: 'wood', wall: 'wainscot_brown', zone: 'mansion',
    light: 'bulbs', lightOn: 0.4, furnish: ['locker', 'sheeted', 'crate'],
  },
  {
    id: 'hidden', name: 'Hidden Storage', f: U, rects: [[52, 17, 64, 22]], floor: 'wood_rough', wall: 'plaster_dirty', zone: 'mansion',
    light: 'none', floorSpawns: 1, furnish: ['shelf', 'trunk', 'crate', 'sheeted2', 'mannequin'],
  },
  {
    id: 'servants', name: "Servants' Quarters", f: U, rects: [[52, 24, 64, 35]], floor: 'wood_rough', wall: 'plaster_dirty', zone: 'mansion',
    light: 'bulbs', lightOn: 0.5, furnish: ['bed', 'bed', 'wardrobe', 'locker', 'table', 'chair', 'dresser'],
  },
  {
    id: 'eastlanding', name: 'Back Stair Landing', f: U, rects: [[66, 17, 75, 35]], floor: 'wood', wall: 'wainscot_brown', zone: 'mansion',
    light: 'bulbs', lightOn: 0.5, furnish: ['sheeted', 'sidetable', 'locker', 'trunk'],
  },
  {
    id: 'master', name: 'Master Bedroom', f: U, rects: [[26, 41, 38, 55]], floor: 'carpet_red', wall: 'damask_red', zone: 'mansion',
    light: 'chandelier', lightOn: 0.5, furnish: ['bed', 'wardrobe', 'wardrobe', 'dresser', 'nightstand', 'nightstand', 'vanity', 'armchair', 'fireplace', 'gclock'],
  },
  {
    id: 'dressing', name: 'Dressing Room', f: U, rects: [[21, 41, 24, 55]], floor: 'carpet_red', wall: 'damask_red', zone: 'mansion',
    light: 'none', furnish: ['wardrobe', 'wardrobe', 'mannequin', 'vanity', 'trunk'],
  },
  {
    id: 'children', name: "Children's Room", f: U, rects: [[58, 41, 68, 55]], floor: 'wood', wall: 'stripe_green', zone: 'mansion',
    light: 'lamp', lightOn: 0.3, furnish: ['crib', 'toychest', 'rockinghorse', 'bed', 'wardrobe', 'table', 'chair', 'shelf'],
  },
  {
    id: 'bathroom', name: 'Bathroom', f: U, rects: [[70, 41, 75, 47]], floor: 'tile_checker', wall: 'tile_wall', zone: 'mansion',
    light: 'lamp', lightOn: 0.6, furnish: ['bathtub', 'toilet', 'sink', 'cabinet'],
  },
  {
    id: 'linen', name: 'Linen Closet', f: U, rects: [[70, 49, 75, 55]], floor: 'wood', wall: 'plaster_dirty', zone: 'mansion',
    light: 'none', furnish: ['shelf', 'shelf', 'locker', 'trunk'],
  },

  // ======================= ATTIC =======================
  {
    id: 'alanding', name: 'Attic Landing', f: A, rects: [[42, 23, 51, 35]], floor: 'attic_boards', wall: 'attic_boards', zone: 'attic',
    light: 'bulbs', lightOn: 1, furnish: ['sheeted', 'trunk', 'crate'],
  },
  {
    id: 'dusty', name: 'Dusty Storage', f: A, rects: [[28, 23, 40, 49]], floor: 'attic_boards', wall: 'attic_boards', zone: 'attic',
    light: 'none',
    furnish: ['sheeted', 'sheeted', 'sheeted', 'sheeted', 'sheeted', 'sheeted2', 'sheeted2', 'sheeted2', 'trunk', 'trunk', 'mannequin', 'mannequin', 'crate', 'crate', 'crate', 'shelf', 'wardrobe', 'rockinghorse', 'gclock', 'sheeted2'],
  },
  {
    id: 'crawl', name: 'East Crawlspace', f: A, rects: [[53, 23, 68, 35]], floor: 'attic_boards', wall: 'attic_boards', zone: 'attic',
    light: 'none', furnish: ['crate', 'crate', 'trunk', 'sheeted', 'barrel'],
  },
  {
    id: 'trunkroom', name: 'Trunk Room', f: A, rects: [[42, 37, 68, 49]], floor: 'attic_boards', wall: 'attic_boards', zone: 'attic',
    light: 'bulbs', lightOn: 0.5, furnish: ['trunk', 'trunk', 'trunk', 'bed', 'crib', 'sheeted2', 'sheeted', 'mannequin', 'wardrobe', 'desk', 'bookshelf'],
  },

  // ======================= BASEMENT =======================
  {
    id: 'cellar', name: 'Cellar Hall', f: B, rects: [[44, 17, 56, 35]], floor: 'stone', wall: 'stone', zone: 'basement',
    light: 'bulbs', lightOn: 0.6, floorSpawns: 1, furnish: ['shelf', 'shelf', 'barrel', 'barrel', 'crate', 'crate', 'locker', 'workbench'],
  },
  {
    id: 'boiler', name: 'Boiler Room', f: B, rects: [[34, 17, 42, 26]], floor: 'concrete', wall: 'brick', zone: 'basement',
    light: 'bulbs', lightOn: 0.5, floorSpawns: 1, furnish: ['coalpile', 'barrel', 'shelf', 'locker'],
  },
  {
    id: 'holding', name: 'Holding Cells', f: B, rects: [[34, 28, 42, 35]], floor: 'stone', wall: 'stone', zone: 'basement',
    light: 'bulbs', lightOn: 1, noSpawn: true, furnish: ['table', 'chair'],
  },
  {
    id: 'archive', name: 'Hidden Archive', f: B, rects: [[24, 17, 32, 26]], floor: 'wood_dark', wall: 'wood_panel', zone: 'basement',
    light: 'lamp', lightOn: 1, furnish: ['bookshelf', 'bookshelf', 'bookshelf', 'desk', 'trunk', 'cabinet'],
  },
  {
    id: 'generator', name: 'Generator Room', f: B, rects: [[24, 28, 32, 35]], floor: 'concrete_oil', wall: 'brick', zone: 'basement',
    light: 'fluoro', lightOn: 0.3, floorSpawns: 1, furnish: ['barrel', 'barrel', 'shelf', 'crate'],
  },
  {
    id: 'electrical', name: 'Electrical Room', f: B, rects: [[58, 17, 66, 24]], floor: 'concrete', wall: 'concrete', zone: 'basement',
    light: 'fluoro', lightOn: 0.8, furnish: ['elcabinet', 'elcabinet', 'shelf', 'locker', 'workbench'],
  },
  {
    id: 'workshop', name: 'Workshop', f: B, rects: [[58, 26, 66, 35]], floor: 'concrete_oil', wall: 'brick', zone: 'basement',
    light: 'fluoro', lightOn: 0.6, floorSpawns: 2, furnish: ['workbench', 'workbench', 'workbench', 'shelf', 'toolchest', 'barrel', 'mechpress'],
  },
  {
    id: 'tools', name: 'Tool Storage', f: B, rects: [[68, 17, 75, 24]], floor: 'concrete', wall: 'brick', zone: 'basement',
    light: 'bulbs', lightOn: 0.5, floorSpawns: 2, furnish: ['shelf', 'shelf', 'toolchest', 'toolchest', 'locker', 'crate'],
  },
  {
    id: 'pumproom', name: 'Water Pump Room', f: B, rects: [[68, 26, 75, 35]], floor: 'stone', wall: 'stone', zone: 'basement',
    light: 'bulbs', lightOn: 0.6, floorSpawns: 1, furnish: ['barrel', 'shelf', 'crate'],
  },
  {
    id: 'tunnel', name: 'Tunnel Entrance', f: B, rects: [[68, 37, 75, 39]], floor: 'stone', wall: 'stone', zone: 'basement',
    light: 'sewer', lightOn: 1, noSpawn: true, furnish: [],
  },
  {
    id: 'mechroom', name: 'Mechanical Room', f: B, rects: [[77, 17, 89, 31]], floor: 'concrete_oil', wall: 'concrete', zone: 'basement',
    light: 'fluoro', lightOn: 0.5, floorSpawns: 2, furnish: ['mechpress', 'mechpress', 'workbench', 'shelf', 'barrel', 'crate', 'locker'],
  },

  // ======================= SEWER =======================
  {
    id: 'saccess', name: 'Sewer Access', f: S, rects: [[66, 48, 75, 54]], floor: 'sewer_stone', wall: 'sewer_brick', zone: 'sewer',
    light: 'sewer', lightOn: 1, floorSpawns: 1, furnish: ['crate', 'barrel', 'niche'],
  },
  {
    id: 'smaint', name: 'Pump Maintenance', f: S, rects: [[77, 48, 85, 56]], floor: 'concrete', wall: 'sewer_brick', zone: 'sewer',
    light: 'fluoro', lightOn: 0.8, floorSpawns: 2, furnish: ['workbench', 'shelf', 'toolchest', 'locker', 'barrel'],
  },
  {
    id: 'echannel', name: 'East Channel', f: S, rects: [[40, 56, 75, 60], [70, 55, 71, 55], [39, 57, 39, 59]], floor: 'sewer_stone', wall: 'sewer_brick',
    zone: 'sewer', light: 'sewer', lightOn: 0.6, floorSpawns: 2, furnish: ['niche', 'niche', 'barrel', 'crate'],
  },
  {
    id: 'cistern', name: 'Flooded Cistern', f: S, rects: [[26, 50, 38, 66]], floor: 'sewer_stone', wall: 'sewer_brick', zone: 'sewer',
    light: 'sewer', lightOn: 0.5, noSpawn: true, furnish: [],
  },
  {
    id: 'valves', name: 'Valve Chamber', f: S, rects: [[28, 40, 36, 48]], floor: 'sewer_stone', wall: 'sewer_brick', zone: 'sewer',
    light: 'sewer', lightOn: 1, floorSpawns: 1, furnish: ['shelf', 'crate', 'niche'],
  },
  {
    id: 'wchannel', name: 'West Channel', f: S, rects: [[8, 56, 24, 60], [25, 57, 25, 59]], floor: 'sewer_stone', wall: 'sewer_brick', zone: 'sewer',
    light: 'sewer', lightOn: 0.6, floorSpawns: 1, furnish: ['niche', 'barrel'],
  },
  {
    id: 'overflow', name: 'Overflow Drain', f: S, rects: [[16, 62, 22, 72], [19, 61, 19, 61]], floor: 'sewer_stone', wall: 'sewer_brick', zone: 'sewer',
    light: 'none', floorSpawns: 1, furnish: ['niche', 'crate'],
  },
  {
    id: 'collapsed', name: 'Collapsed Passage', f: S, rects: [[44, 62, 50, 76], [47, 61, 47, 61]], floor: 'sewer_stone', wall: 'sewer_brick', zone: 'sewer',
    light: 'none', floorSpawns: 2, furnish: ['crate', 'barrel', 'niche', 'rubble'],
  },
  {
    id: 'north', name: 'North Conduit', f: S, rects: [[8, 6, 14, 54]], floor: 'sewer_stone', wall: 'sewer_brick', zone: 'sewer',
    light: 'sewer', lightOn: 0.5, floorSpawns: 2, furnish: ['niche', 'niche', 'niche', 'barrel'],
  },
  {
    id: 'outfall', name: 'The Outfall', f: S, rects: [[6, 0, 16, 4]], floor: 'dirt', wall: 'rock', zone: 'road', outdoor: true,
    light: 'none', noSpawn: true, noPatrol: true, escape: 'sewer',
  },
];

export const DOORS: DoorSpec[] = [
  // Ground floor
  { id: 'front_door', f: G, cells: [[48, 56], [49, 56]], kind: 'front', lock: { kind: 'mech', mech: 'front_door' }, enemyPassable: false },
  { id: 'living_corridor', f: G, cells: [[30, 40]], kind: 'wood', enemyPassable: true },
  { id: 'living_hall', f: G, cells: [[39, 48]], kind: 'double', enemyPassable: true, startsOpen: true },
  { id: 'dining_corridor', f: G, cells: [[66, 40]], kind: 'wood', enemyPassable: true },
  { id: 'dining_hall', f: G, cells: [[57, 48]], kind: 'double', enemyPassable: true },
  { id: 'library_trophy', f: G, cells: [[27, 29]], kind: 'wood', lock: { kind: 'item', item: 'library_key' }, enemyPassable: true },
  { id: 'trophy_corridor', f: G, cells: [[27, 36]], kind: 'wood', enemyPassable: true },
  { id: 'library_study', f: G, cells: [[33, 19]], kind: 'bookcase', lock: { kind: 'bolt', room: 'library' }, enemyPassable: false, secret: true },
  { id: 'study_guest', f: G, cells: [[38, 26]], kind: 'wood', enemyPassable: true },
  { id: 'guest_corridor', f: G, cells: [[38, 36]], kind: 'wood', enemyPassable: true },
  { id: 'storage_rearhall', f: G, cells: [[47, 23]], kind: 'wood_old', lock: { kind: 'item', item: 'storage_key' }, enemyPassable: true },
  { id: 'rearhall_corridor', f: G, cells: [[47, 36]], kind: 'wood', enemyPassable: true, startsOpen: true },
  { id: 'rearhall_kitchen', f: G, cells: [[51, 34]], kind: 'wood', enemyPassable: true },
  { id: 'kitchen_corridor', f: G, cells: [[58, 36]], kind: 'wood', enemyPassable: true },
  { id: 'kitchen_pantry', f: G, cells: [[58, 22]], kind: 'wood_old', enemyPassable: true },
  { id: 'kitchen_utility', f: G, cells: [[66, 32]], kind: 'wood', enemyPassable: true },
  { id: 'kitchen_conservatory', f: G, cells: [[66, 25]], kind: 'glass', enemyPassable: true },
  { id: 'conservatory_utility', f: G, cells: [[75, 28]], kind: 'wood', enemyPassable: true },
  { id: 'conservatory_garden', f: G, cells: [[71, 16]], kind: 'glass', enemyPassable: true },
  { id: 'utility_corridor', f: G, cells: [[70, 36]], kind: 'wood', enemyPassable: true },
  { id: 'utility_garage', f: G, cells: [[76, 33]], kind: 'iron', lock: { kind: 'item', item: 'garage_key' }, enemyPassable: true },
  { id: 'garage_shutter', f: G, cells: [[81, 48], [82, 48], [83, 48], [84, 48]], kind: 'shutter', lock: { kind: 'mech', mech: 'shutter' }, enemyPassable: false },
  { id: 'drive_gate', f: G, cells: [[81, 80], [82, 80], [83, 80], [84, 80], [85, 80]], kind: 'gate_chain', lock: { kind: 'mech', mech: 'drive_gate' }, enemyPassable: false },
  { id: 'shed_door', f: G, cells: [[83, 11]], kind: 'wood_old', enemyPassable: true },

  // Upper floor
  { id: 'westbed_sewing', f: U, cells: [[27, 29]], kind: 'wood', enemyPassable: true },
  { id: 'sewing_corridor', f: U, cells: [[27, 36]], kind: 'wood', enemyPassable: true },
  { id: 'clock_guestsuite', f: U, cells: [[38, 26]], kind: 'wood', lock: { kind: 'item', item: 'clock_key' }, enemyPassable: true },
  { id: 'guestsuite_corridor', f: U, cells: [[38, 36]], kind: 'wood', enemyPassable: true },
  { id: 'backlanding_corridor', f: U, cells: [[47, 36]], kind: 'wood', enemyPassable: true, startsOpen: true },
  { id: 'hidden_servants', f: U, cells: [[58, 23]], kind: 'panel', enemyPassable: true, secret: true },
  { id: 'servants_corridor', f: U, cells: [[58, 36]], kind: 'wood', enemyPassable: true },
  { id: 'servants_eastlanding', f: U, cells: [[65, 26]], kind: 'wood_old', enemyPassable: true },
  { id: 'eastlanding_corridor', f: U, cells: [[70, 36]], kind: 'wood', enemyPassable: true },
  { id: 'master_corridor', f: U, cells: [[32, 40]], kind: 'double', enemyPassable: true },
  { id: 'master_gallery', f: U, cells: [[39, 43]], kind: 'wood', enemyPassable: true },
  { id: 'master_dressing', f: U, cells: [[25, 48]], kind: 'wood', enemyPassable: true },
  { id: 'children_corridor', f: U, cells: [[63, 40]], kind: 'wood', enemyPassable: true },
  { id: 'children_gallery', f: U, cells: [[57, 43]], kind: 'wood', enemyPassable: true },
  { id: 'bathroom_corridor', f: U, cells: [[72, 40]], kind: 'wood', enemyPassable: true },
  { id: 'bathroom_linen', f: U, cells: [[72, 48]], kind: 'wood_old', enemyPassable: true },

  // Attic
  { id: 'alanding_dusty', f: A, cells: [[41, 30]], kind: 'wood_old', enemyPassable: true },
  { id: 'alanding_crawl', f: A, cells: [[52, 28]], kind: 'wood_old', enemyPassable: true },
  { id: 'alanding_trunk', f: A, cells: [[47, 36]], kind: 'wood_old', enemyPassable: true },
  { id: 'dusty_trunk', f: A, cells: [[41, 44]], kind: 'wood_old', enemyPassable: true },
  { id: 'crawl_trunk', f: A, cells: [[60, 36]], kind: 'wood_old', enemyPassable: true },

  // Basement
  { id: 'cellar_boiler', f: B, cells: [[43, 21]], kind: 'iron', enemyPassable: true },
  { id: 'cellar_holding', f: B, cells: [[43, 31]], kind: 'iron', enemyPassable: true, startsOpen: true },
  { id: 'boiler_holding', f: B, cells: [[40, 27]], kind: 'iron', enemyPassable: true },
  { id: 'boiler_archive', f: B, cells: [[33, 21]], kind: 'brickwall', enemyPassable: true, secret: true },
  { id: 'archive_generator', f: B, cells: [[28, 27]], kind: 'wood_old', enemyPassable: true },
  { id: 'cellar_electrical', f: B, cells: [[57, 20]], kind: 'iron', enemyPassable: true },
  { id: 'cellar_workshop', f: B, cells: [[57, 30]], kind: 'wood_old', enemyPassable: true },
  { id: 'electrical_tools', f: B, cells: [[67, 20]], kind: 'iron', enemyPassable: true },
  { id: 'workshop_pumproom', f: B, cells: [[67, 30]], kind: 'iron', enemyPassable: true },
  { id: 'electrical_workshop', f: B, cells: [[62, 25]], kind: 'iron', enemyPassable: true },
  { id: 'tools_pumproom', f: B, cells: [[71, 25]], kind: 'wood_old', enemyPassable: true },
  { id: 'pump_tunnel', f: B, cells: [[71, 36]], kind: 'iron_gate', lock: { kind: 'item', item: 'maintenance_key' }, enemyPassable: false },
  { id: 'tools_mechroom', f: B, cells: [[76, 21]], kind: 'iron', lock: { kind: 'bolt', room: 'mechroom' }, enemyPassable: false },
  { id: 'cage_door', f: B, cells: [[38, 32]], kind: 'cage', lock: { kind: 'cage' }, enemyPassable: true },

  // Sewer
  { id: 'saccess_smaint', f: S, cells: [[76, 51]], kind: 'iron', enemyPassable: true },
  { id: 'valves_cistern', f: S, cells: [[32, 49]], kind: 'iron', enemyPassable: true, startsOpen: true },
  { id: 'floodgate', f: S, cells: [[10, 55], [11, 55], [12, 55]], kind: 'floodgate', lock: { kind: 'mech', mech: 'floodgate' }, enemyPassable: false },
  { id: 'final_grate', f: S, cells: [[10, 5], [11, 5], [12, 5]], kind: 'grate', lock: { kind: 'mech', mech: 'final_grate' }, enemyPassable: false },
];

export const STAIRS: StairSpec[] = [
  { id: 'grand', lower: G, rect: [47, 45, 49, 52], dir: '-z', name: 'Grand Staircase' },
  { id: 'back', lower: G, rect: [67, 29, 74, 30], dir: '-x', name: 'Servants’ Stair' },
  { id: 'cellar', lower: B, rect: [49, 25, 50, 32], dir: '+z', name: 'Cellar Stair' },
  { id: 'garage_cellar', lower: B, rect: [88, 32, 89, 39], dir: '+z', name: 'Garage Stair' },
  { id: 'attic', lower: U, rect: [46, 26, 47, 33], dir: '-z', name: 'Attic Stair' },
  { id: 'sewer', lower: S, rect: [70, 40, 71, 47], dir: '-z', name: 'Sewer Stair' },
];

export const LADDERS: LadderSpec[] = [
  { id: 'attic_hatch', a: { f: A, x: 56, z: 24 }, b: { f: U, x: 56, z: 21 }, name: 'Attic Hatch' },
  { id: 'garden_grate', a: { f: G, x: 11, z: 30 }, b: { f: S, x: 11, z: 30 }, lockMech: 'garden_grate', name: 'Drainage Grate' },
];

/** Cells where the upper floor is open to the hall below. */
export const VOID_RECTS: { f: number; rect: Rect; room: string }[] = [{ f: U, rect: [40, 45, 56, 55], room: 'hall' }];

/** Railings (balustrades). Stair railings are generated automatically. */
export const RAIL_RECTS: { f: number; rect: Rect; style?: string }[] = [
  { f: U, rect: [40, 45, 46, 45] },
  { f: U, rect: [50, 45, 56, 45] },
  // the holding cage bars
  { f: B, rect: [38, 29, 38, 35], style: 'bars' },
  { f: B, rect: [34, 29, 37, 29], style: 'bars' },
];

export const CAGE_RECT: Rect = [34, 30, 37, 35];

export const WATER_ZONES: WaterZoneSpec[] = [{ id: 'cistern', f: S, rect: [26, 50, 38, 66] }];

/** Shallow water channels, slippery walkways and metal grates in the sewer. */
export const SHALLOW_RECTS: { f: number; rect: Rect }[] = [
  { f: S, rect: [40, 58, 75, 58] },
  { f: S, rect: [8, 58, 24, 58] },
  { f: S, rect: [11, 6, 11, 54] },
  { f: S, rect: [18, 64, 20, 72] },
  { f: S, rect: [46, 66, 48, 76] },
];
export const SLIPPERY_RECTS: { f: number; rect: Rect }[] = [
  { f: S, rect: [50, 57, 62, 57] },
  { f: S, rect: [50, 59, 62, 59] },
  { f: S, rect: [10, 36, 12, 44] },
];
export const GRATE_RECTS: { f: number; rect: Rect }[] = [
  { f: S, rect: [42, 56, 47, 56] },
  { f: S, rect: [64, 60, 69, 60] },
  { f: S, rect: [8, 18, 14, 19] },
  { f: S, rect: [15, 56, 18, 60] },
  { f: G, rect: [81, 49, 84, 49] },
];
export const WEAK_RECTS: { f: number; rect: Rect }[] = [{ f: A, rect: [58, 27, 63, 32] }];

export const PLACES: PlaceSpec[] = [
  { t: 'boiler', f: B, x: 35, z: 17, rot: 0 },
  { t: 'generator', f: B, x: 27, z: 31, rot: 0 },
  { t: 'pump', f: B, x: 73, z: 27, rot: 0 },
  { t: 'well', f: G, x: 30, z: 7, rot: 0 },
  { t: 'fountain', f: G, x: 47, z: 66, rot: 0 },
  { t: 'rubble', f: S, x: 45, z: 74, rot: 0 },
];

/** Cells that must stay free of auto-placed furniture. */
export const RESERVED_RECTS: { f: number; rect: Rect }[] = [
  { f: G, rect: [80, 33, 86, 47] }, // car + shutter approach
  { f: G, rect: [80, 49, 86, 79] }, // drive path
  { f: G, rect: [45, 64, 51, 79] }, // front path to gate
  { f: G, rect: [46, 53, 50, 55] }, // front door approach
  { f: G, rect: [10, 29, 12, 31] }, // garden grate
  { f: U, rect: [22, 22, 27, 26] }, // player wake-up area
  { f: U, rect: [55, 20, 57, 22] }, // attic ladder foot
  { f: A, rect: [55, 23, 57, 25] }, // attic ladder top
  { f: B, rect: [34, 28, 37, 28] },
  { f: B, rect: [39, 31, 39, 33] }, // cage door approach
  { f: S, rect: [9, 6, 13, 8] }, // outfall wheel
  { f: S, rect: [9, 53, 13, 54] }, // floodgate
  { f: S, rect: [9, 56, 15, 57] },
  { f: S, rect: [28, 40, 36, 41] }, // valve manifold
];

export const MECHS: MechSpec[] = [
  { id: 'front_door', kind: 'front_door', f: G, pos: [49.0, 1.15, 55.85], access: [48, 55], name: 'Main Entrance' },
  { id: 'security_panel', kind: 'security_panel', f: G, pos: [45.5, 1.45, 55.92], access: [45, 55], name: 'Security Panel', yaw: 0 },
  { id: 'winch', kind: 'winch', f: G, pos: [52.5, 1.0, 55.85], access: [52, 55], name: 'Bar Winch', yaw: 0 },
  { id: 'fuse_box', kind: 'fuse_box', f: B, pos: [62.5, -2.55, 17.1], access: [62, 17], name: 'Security Fuse Board', yaw: Math.PI },
  { id: 'generator', kind: 'generator', f: B, pos: [28.0, -3.0, 33.05], access: [27, 33], name: 'Old Generator' },
  { id: 'shutter', kind: 'shutter', f: G, pos: [86.5, 1.25, 47.9], access: [86, 47], name: 'Garage Shutter Bolts', yaw: 0 },
  { id: 'pump_panel', kind: 'pump_panel', f: S, pos: [85.9, -6.7, 52.5], access: [85, 52], name: 'Drainage Pump', yaw: -Math.PI / 2 },
  { id: 'valve_1', kind: 'valve', f: S, pos: [29.5, -6.8, 40.15], access: [29, 40], name: 'Line I Valve', yaw: Math.PI },
  { id: 'valve_2', kind: 'valve', f: S, pos: [31.5, -6.8, 40.15], access: [31, 40], name: 'Line II Valve', yaw: Math.PI },
  { id: 'valve_3', kind: 'valve', f: S, pos: [33.5, -6.8, 40.15], access: [33, 40], name: 'Line III Valve', yaw: Math.PI },
  { id: 'manifold', kind: 'manifold', f: S, pos: [35.5, -6.6, 40.15], access: [35, 40], name: 'Pressure Manifold', yaw: Math.PI },
  { id: 'floodgate_box', kind: 'floodgate_box', f: S, pos: [14.5, -6.7, 56.1], access: [14, 56], name: 'Floodgate Control', yaw: Math.PI },
  { id: 'final_wheel', kind: 'final_wheel', f: S, pos: [13.5, -6.8, 6.1], access: [13, 6], name: 'Outfall Grate', yaw: Math.PI },
  { id: 'garden_grate', kind: 'garden_grate', f: G, pos: [11.5, 0.15, 30.5], access: [11, 31], name: 'Drainage Grate' },
];

export const PLAYER_STARTS: [number, number, number][] = [
  [23.5, 4, 23.5],
  [25.5, 4, 23.5],
  [23.5, 4, 25.5],
  [25.5, 4, 25.5],
];
export const ENEMY_START: [number, number, number] = [40.5, -4, 33.5];
export const CAR_START = { x: 83.0, z: 39.0, yaw: Math.PI };

export const NOTES: NoteSpec[] = [
  {
    id: 'wallpaper', room: 'westbed', title: 'Scratched into the wallpaper',
    text: 'If you can read this you are already his guest.\nHe hears the floorboards. Every board is his.\nWalk slow. Crouch when he is near. Hide where he did not see you go.\n— M.',
  },
  {
    id: 'ledger', room: 'corridor', title: 'Guest Ledger (torn page)',
    text: 'Halvorsen family — arrived 3:17. STAYED.\nThe Okafor boys — arrived 3:17. STAYED.\nMs. Petrakis — arrived 3:17. STAYED.\nNew guests — arrived 3:17. ______',
  },
  {
    id: 'locksmith', room: 'study', title: 'Letter to the locksmith', clue: 'front',
    text: 'The front door now carries four locks, as requested:\n1. The old iron key lock.\n2. A chained brass padlock — any decent pick will do.\n3. The electric bolt. It draws power from the security fuse board in the basement and answers only to the panel code.\n4. The iron cross-bar, lifted by the winch beside the door. The winch has no handle; you keep that elsewhere.',
  },
  {
    id: 'cipher_hint', room: 'library', title: 'On the panel', clue: 'cipher',
    text: 'The panel by the door shows symbols, not numbers. My engraved plate turns each symbol into a digit.\nRead the symbols left to right. Three wrong codes and the alarm will wake the whole house.',
  },
  {
    id: 'car_notes', room: 'utility', title: 'Repair notes — the old saloon', clue: 'car',
    text: 'Car will not run without: a battery, the ignition coil and the starter relay.\nTank is bone dry — red canister somewhere.\nThe shutter bolts rusted solid. Wrench.\nThe ignition key is never left in the car. He keeps it.\nStarting it will be LOUD.',
  },
  {
    id: 'drainage', room: 'pumproom', title: 'Municipal drainage notice', clue: 'sewer',
    text: 'Sewer access by MAINTENANCE KEY only.\nThe cistern floods whenever the drainage pump is down. The pump fuse is stored separately to deter vandals.\nFloodgate requires its control key AND equalised line pressure.\nOutfall grate is opened with the large access wheel.',
  },
  {
    id: 'valve_note', room: 'valves', title: 'Valve chamber instructions', clue: 'valves',
    text: 'To raise the floodgate the manifold must read the pressure marked in red.\nEach line adds the pressure stamped on its tag when its valve is OPEN.\nMount the gauge first. The valves will not turn without the valve handle.',
  },
  {
    id: 'drawing', room: 'children', title: "A child's drawing",
    text: 'GRANPA NOWER HAS LONG FINGERS.\nHE LISSENS AT THE DOORS.\nHE KNOWS WHEN YOU ARE NOW.',
  },
  {
    id: 'diary', room: 'master', title: 'Diary — October',
    text: 'Agathe left me. No. Agathe stayed. Everyone stays.\nThe clocks agree with me now. They all say 3:17.\nI only have to listen. The house tells me where they are.',
  },
  {
    id: 'clock_journal', room: 'clockroom', title: 'Workshop journal', clue: 'generator',
    text: 'Every clock in the house stopped at 3:17 — except the one inside me.\nThe old generator in the cellar still turns over. It will wake the whole house when it does. Useful, to bring them running. Or to bring ME running.',
  },
  {
    id: 'bars', room: 'holding', title: 'Scratched into the bars',
    text: 'IIII IIII IIII II\nTHE LATCH IS WEAK. KEEP WORKING IT.\nTHEY CAME BACK FOR ME. THEY ALWAYS COME BACK.',
  },
  {
    id: 'clipping', room: 'trunkroom', title: 'Newspaper clipping',
    text: 'FOURTH FAMILY MISSING NEAR NOWER ESTATE\nPolice say the reclusive clockmaker "was cooperative" and "could not have heard anything at that hour".',
  },
  {
    id: 'blueprint', room: 'archive', title: 'Blueprint fragment',
    text: 'Servants’ quarters — false panel on the north wall leads to the hidden storage.\nAttic hatch drops into the same room.\nCellar: boiler room wall is hollow behind the loose bricks.',
  },
  {
    id: 'warning', room: 'north', title: 'Sewer worker’s warning',
    text: 'If you hear him in the tunnels, get into a niche and hold your breath.\nThe grate up to the garden can be forced from either side with a hydraulic spreader. It is the only quick way back.',
  },
  {
    id: 'shopping', room: 'kitchen', title: 'Shopping list',
    text: 'Bread. Lamp oil. Rope (strong). Padlocks x4.\nMore chains.\nSomething soft for the children’s room.',
  },
];
