/** Level data model. The world is a stack of 1m cell grids, one per floor. */

export const GRID_W = 96;
export const GRID_D = 88;

/** Cell types. */
export const CT = {
  SOLID: 0,
  FLOOR: 1,
  OUTDOOR: 2,
  DOOR: 3,
  STAIR: 4,
  VOID: 5,
  RAIL: 6,
  WATER: 7,
} as const;
export type CellType = (typeof CT)[keyof typeof CT];

/** Per-cell flag bits. */
export const F = {
  FURN: 1, // furniture blocks movement
  TALL: 2, // furniture blocks sight
  CREAKY: 4,
  SHALLOW: 8, // shallow water surface
  SLIPPERY: 16,
  GRATE: 32, // metal grating (loud)
  WEAK: 64, // weak attic boards
  WINDOW: 128, // on SOLID cells: window
} as const;

export type Rect = [x0: number, z0: number, x1: number, z1: number];
export type Zone = 'mansion' | 'basement' | 'attic' | 'garage' | 'garden' | 'yard' | 'sewer' | 'road';
export type Surface = 'wood' | 'carpet' | 'tile' | 'stone' | 'concrete' | 'metal' | 'grass' | 'gravel' | 'water' | 'dirt';
export type LightKind = 'chandelier' | 'lamp' | 'bulbs' | 'sconces' | 'fluoro' | 'sewer' | 'lantern' | 'none';
export type EscapeRoute = 'front' | 'garage' | 'sewer';
export type Dir = '+x' | '-x' | '+z' | '-z';

export interface RoomSpec {
  id: string;
  name: string;
  f: number;
  rects: Rect[];
  floor: string;
  wall: string;
  ceil?: string;
  zone: Zone;
  outdoor?: boolean;
  light?: LightKind;
  /** 0..1 probability that each fixture is working. */
  lightOn?: number;
  furnish?: string[];
  floorSpawns?: number;
  noSpawn?: boolean;
  noPatrol?: boolean;
  escape?: EscapeRoute;
  runner?: boolean;
}

export type DoorKind =
  | 'wood'
  | 'wood_old'
  | 'double'
  | 'front'
  | 'glass'
  | 'iron'
  | 'iron_gate'
  | 'shutter'
  | 'gate_chain'
  | 'bookcase'
  | 'panel'
  | 'brickwall'
  | 'cage'
  | 'floodgate'
  | 'grate';

export type DoorLock =
  | { kind: 'item'; item: string }
  | { kind: 'bolt'; room: string } // can only be opened from this room's side
  | { kind: 'mech'; mech: string } // opened by a mechanism
  | { kind: 'cage' };

export interface DoorSpec {
  id: string;
  f: number;
  cells: [number, number][];
  kind: DoorKind;
  lock?: DoorLock;
  /** Can the Nower path through this door while it is closed/locked? */
  enemyPassable: boolean;
  startsOpen?: boolean;
  secret?: boolean;
}

export interface StairSpec {
  id: string;
  lower: number;
  rect: Rect;
  dir: Dir; // direction of ascent
  name: string;
}

export interface LadderEnd {
  f: number;
  x: number;
  z: number;
}
export interface LadderSpec {
  id: string;
  a: LadderEnd;
  b: LadderEnd;
  lockMech?: string;
  name: string;
}

export interface PlaceSpec {
  t: string;
  f: number;
  x: number;
  z: number;
  rot: 0 | 1 | 2 | 3;
}

export interface WaterZoneSpec {
  id: string;
  f: number;
  rect: Rect;
}

export interface MechSpec {
  id: string;
  kind: string;
  f: number;
  /** Interaction point in world coordinates. */
  pos: [number, number, number];
  /** Cell that must stay clear so players can reach it. */
  access: [number, number];
  name: string;
  /** Optional facing (yaw radians) for the visual. */
  yaw?: number;
}

export interface NoteSpec {
  id: string;
  room: string;
  title: string;
  text: string;
  clue?: 'cipher' | 'valves' | 'car' | 'front' | 'sewer' | 'generator';
}

// ---------------------------------------------------------------------------
// Built (runtime) level structures
// ---------------------------------------------------------------------------

export interface FloorGrid {
  index: number;
  base: number;
  ceilH: number;
  type: Uint8Array;
  room: Int16Array;
  flags: Uint8Array;
  /** Door index, stair index or water zone index depending on type. */
  ent: Int16Array;
  /** Exterior style id for SOLID cells (index into SOLID_STYLES). */
  style: Uint8Array;
  /** Furniture index occupying the cell (-1 = none). */
  furn: Int16Array;
}

export interface Room {
  index: number;
  spec: RoomSpec;
  cells: number;
  center: [number, number, number];
  bright: number; // 0.45 (dark) .. 1 (lit)
}

export interface Door {
  index: number;
  spec: DoorSpec;
  /** Centre of the door opening in world coordinates (floor height). */
  center: [number, number, number];
  /** Axis along which one passes through the door. */
  pass: 'x' | 'z';
  rooms: [number, number];
  width: number;
}

export interface Stair {
  index: number;
  spec: StairSpec;
}

export interface Ladder {
  index: number;
  spec: LadderSpec;
  pa: [number, number, number];
  pb: [number, number, number];
}

export type HideKind = 'wardrobe' | 'bed' | 'locker' | 'niche';
export type ContainerKind = 'drawer' | 'cupboard' | 'fridge' | 'chest';

export interface Furniture {
  index: number;
  t: string;
  f: number;
  x: number; // min cell x
  z: number; // min cell z
  w: number; // cells along x after rotation
  d: number; // cells along z after rotation
  rot: 0 | 1 | 2 | 3;
  room: number;
  center: [number, number, number];
  front: [number, number]; // cell in front
  hide?: number;
  container?: number;
}

export interface HideSpot {
  index: number;
  kind: HideKind;
  furn: number;
  f: number;
  inside: [number, number, number];
  exit: [number, number, number];
  yaw: number; // look direction while hidden
  room: number;
}

export interface Container {
  index: number;
  kind: ContainerKind;
  furn: number;
  f: number;
  pos: [number, number, number];
  room: number;
}

export type SpawnCat = 'small' | 'medium' | 'heavy';
export interface SpawnPoint {
  index: number;
  f: number;
  pos: [number, number, number];
  room: number;
  cats: SpawnCat[];
  container: number; // -1 none
  /** Walkable cell a player stands on to reach this spawn. */
  access: [number, number];
}

export interface LightDef {
  f: number;
  pos: [number, number, number];
  kind: LightKind;
  color: number;
  intensity: number;
  range: number;
  on: boolean;
  flicker: number;
  room: number;
}

export interface NotePlaced {
  index: number;
  spec: NoteSpec;
  f: number;
  pos: [number, number, number];
  room: number;
}

export interface Mech {
  index: number;
  spec: MechSpec;
  room: number;
}

export interface WaterZone {
  index: number;
  spec: WaterZoneSpec;
}

export interface Level {
  W: number;
  D: number;
  floors: FloorGrid[];
  rooms: Room[];
  roomById: Map<string, number>;
  doors: Door[];
  doorById: Map<string, number>;
  stairs: Stair[];
  ladders: Ladder[];
  furniture: Furniture[];
  hides: HideSpot[];
  containers: Container[];
  spawns: SpawnPoint[];
  lights: LightDef[];
  notes: NotePlaced[];
  mechs: Mech[];
  mechById: Map<string, number>;
  water: WaterZone[];
  trapCandidates: { f: number; x: number; z: number }[];
  playerStarts: [number, number, number][];
  enemyStart: [number, number, number];
  patrolPoints: { f: number; x: number; z: number; room: number }[];
  cageCells: { f: number; x: number; z: number }[];
  cageDoor: number;
  carStart: { x: number; z: number; yaw: number };
}

export const SOLID_STYLES = ['default', 'facade', 'garage_brick', 'hedge', 'fence', 'shed', 'rock', 'bars'] as const;
export type SolidStyle = (typeof SOLID_STYLES)[number];

export function surfaceOfFloorMat(mat: string): Surface {
  if (mat.startsWith('carpet')) return 'carpet';
  if (mat.startsWith('tile') || mat === 'marble') return 'tile';
  if (mat.startsWith('wood') || mat === 'parquet' || mat === 'attic_boards') return 'wood';
  if (mat.startsWith('concrete') || mat === 'asphalt') return 'concrete';
  if (mat === 'grass') return 'grass';
  if (mat === 'gravel') return 'gravel';
  if (mat === 'dirt') return 'dirt';
  if (mat === 'metal') return 'metal';
  return 'stone';
}
