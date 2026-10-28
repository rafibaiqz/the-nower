/** Network protocol and replicated state shared by client and server. */
import type { Difficulty } from './difficulty';
import type { EscapeRoute } from './level/types';

export type PlayerStatus =
  | 'free'
  | 'hidden'
  | 'trapped'
  | 'climbing'
  | 'driving'
  | 'passenger'
  | 'captured'
  | 'caged'
  | 'escaped'
  | 'eliminated';

export type MatchPhase = 'COUNTDOWN' | 'PLAYING' | 'ENDED';
export type MatchAlert = 'NONE' | 'PLAYER_CAPTURED' | 'ESCAPE_IN_PROGRESS';
export type MatchResult = 'TEAM_VICTORY' | 'PARTIAL_ESCAPE' | 'GAME_OVER';

export const PLAYER_COLORS = [0xb03a2e, 0x2e6fb0, 0x3f8f3a, 0xc59a2b, 0x7b3fa0, 0x2fa0a0];

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
  color: number;
}

export interface LobbySettings {
  difficulty: Difficulty;
  maxPlayers: number;
}

export interface LobbyInfo {
  code: string;
  state: 'LOBBY' | 'IN_GAME';
  players: LobbyPlayer[];
  settings: LobbySettings;
  serverMaxPlayers: number;
  canStart: boolean;
  startBlocker: string | null;
}

export interface PlayerPublic {
  id: string;
  name: string;
  color: number;
  status: PlayerStatus;
  connected: boolean;
  captures: number;
  held: string | null;
  hide: number;
  escapedVia: EscapeRoute | null;
  cagedAt: number;
  battery: number;
}

export interface DoorState {
  open: boolean;
  locked: boolean;
}

export type ItemPlace = 'world' | 'held' | 'used';
export interface ItemState {
  id: string;
  type: string;
  place: ItemPlace;
  holder: string | null;
  pos: [number, number, number];
  container: number;
  charges: number;
}

export interface FrontState {
  keyLock: boolean;
  padlock: boolean;
  maglock: boolean;
  handle: boolean;
  bar: boolean;
  open: boolean;
  attempts: number;
  lockedUntil: number;
}

export interface MechStates {
  front: FrontState;
  fuse: boolean;
  generator: { running: boolean; until: number };
  shutter: { bolts: boolean; open: boolean };
  pump: { fuse: boolean; running: boolean; drained: boolean; progress: number };
  manifold: { gauge: boolean; handle: boolean; valves: boolean[]; equalized: boolean };
  floodgate: { key: boolean; open: boolean };
  finalGrate: { wheel: boolean; open: boolean };
  gardenGrate: boolean;
  driveGate: boolean;
}

export interface CarState {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  steer: number;
  hood: boolean;
  battery: boolean;
  coil: boolean;
  relay: boolean;
  fuel: number;
  key: boolean;
  running: boolean;
  driver: string | null;
  passenger: string | null;
  escaped: boolean;
}

export interface TrapState {
  kind: 'snare' | 'cans' | 'bell';
  f: number;
  x: number;
  z: number;
  armed: boolean;
  victim: string | null;
}

export type EnemyState =
  | 'DORMANT'
  | 'PATROL'
  | 'INVESTIGATE_SOUND'
  | 'INVESTIGATE_VISUAL'
  | 'SEARCH_AREA'
  | 'CHASE'
  | 'SEARCH_HIDING_SPOT'
  | 'ATTACK_OR_CAPTURE'
  | 'TEMPORARILY_DISABLED'
  | 'RETURN_TO_PATROL';

/** Animation the enemy model should play (finer-grained than the AI state). */
export type EnemyAnim =
  | 'idle'
  | 'walk'
  | 'investigate'
  | 'listen'
  | 'look'
  | 'door'
  | 'searchHide'
  | 'chase'
  | 'attack'
  | 'stunned'
  | 'react'
  | 'climb';

export const ENEMY_STATES: EnemyState[] = [
  'DORMANT',
  'PATROL',
  'INVESTIGATE_SOUND',
  'INVESTIGATE_VISUAL',
  'SEARCH_AREA',
  'CHASE',
  'SEARCH_HIDING_SPOT',
  'ATTACK_OR_CAPTURE',
  'TEMPORARILY_DISABLED',
  'RETURN_TO_PATROL',
];
export const ENEMY_ANIMS: EnemyAnim[] = ['idle', 'walk', 'investigate', 'listen', 'look', 'door', 'searchHide', 'chase', 'attack', 'stunned', 'react', 'climb'];

/** Player snapshot tuple: id, x, y, z, yaw, pitch, flags. */
export type PlayerSnap = [string, number, number, number, number, number, number];
/** Enemy snapshot tuple: x, y, z, yaw, stateIdx, animIdx, speed, targetId. */
export type EnemySnap = [number, number, number, number, number, number, number, string];
/** Car snapshot tuple: x, z, yaw, speed, steer. */
export type CarSnap = [number, number, number, number, number];

export interface Snapshot {
  t: number;
  p: PlayerSnap[];
  e: EnemySnap;
  c: CarSnap;
}

export const PF = {
  CROUCH: 1,
  SPRINT: 2,
  FLASH: 4,
  MOVING: 8,
  HOLDING_BREATH: 16,
  INTERACTING: 32,
} as const;

export interface MatchInit {
  you: string;
  seed: number;
  difficulty: Difficulty;
  serverTime: number;
  phase: MatchPhase;
  phaseEndsAt: number;
  alert: MatchAlert;
  result: MatchResult | null;
  players: PlayerPublic[];
  doors: DoorState[];
  items: ItemState[];
  containers: boolean[];
  hides: (string | null)[];
  ladders: boolean[];
  water: { drained: boolean; level: number }[];
  mechs: MechStates;
  car: CarState;
  traps: TrapState[];
  journal: string[];
  panelSymbols: string[];
  valveWeights: number[];
  valveTarget: number;
  snapshot: Snapshot;
  teleportSeq: number;
}

export type SoundName =
  | 'door_open'
  | 'door_close'
  | 'door_slam'
  | 'door_locked'
  | 'door_unlock'
  | 'drawer_open'
  | 'drawer_close'
  | 'pickup'
  | 'drop'
  | 'install'
  | 'glass_break'
  | 'trap_snare'
  | 'trap_cans'
  | 'trap_bell'
  | 'creak'
  | 'weak_board'
  | 'generator'
  | 'pump'
  | 'floodgate'
  | 'grate_open'
  | 'shutter'
  | 'car_start'
  | 'car_fail'
  | 'gate_crash'
  | 'alarm'
  | 'keypad_ok'
  | 'keypad_bad'
  | 'crank'
  | 'valve'
  | 'decoy'
  | 'flash'
  | 'cage_open'
  | 'cage_close'
  | 'ladder'
  | 'splash'
  | 'gasp'
  | 'hide_in'
  | 'hide_out'
  | 'enemy_open_door'
  | 'enemy_search_hide'
  | 'lockpick'
  | 'fuse'
  | 'maglock'
  | 'bar_lift'
  | 'front_open'
  | 'stumble';

export type NotifyTone = 'info' | 'good' | 'bad' | 'warn';

export type GameEvent =
  | { k: 'door'; i: number; open: boolean; locked: boolean }
  | { k: 'item'; s: ItemState }
  | { k: 'container'; i: number; open: boolean }
  | { k: 'hide'; i: number; occupant: string | null }
  | { k: 'ladder'; i: number; open: boolean }
  | { k: 'water'; i: number; drained: boolean; level: number }
  | { k: 'mechs'; s: MechStates }
  | { k: 'car'; s: CarState }
  | { k: 'trap'; i: number; s: TrapState }
  | { k: 'player'; s: PlayerPublic }
  | { k: 'sound'; s: SoundName; pos: [number, number, number]; v: number; by?: string }
  | { k: 'notify'; text: string; tone: NotifyTone; to?: string }
  | { k: 'cue'; cue: 'heard' | 'spotted' | 'lost' | 'search' | 'capture' | 'stunned' | 'chase_end' | 'escape_alert'; target?: string; pos?: [number, number, number] }
  | { k: 'journal'; note: string; by: string }
  | { k: 'phase'; phase: MatchPhase; alert: MatchAlert; result: MatchResult | null; endsAt: number }
  | { k: 'hold'; player: string; target: string; label: string; dur: number }
  | { k: 'holdEnd'; player: string; ok: boolean }
  | { k: 'throw'; from: [number, number, number]; to: [number, number, number]; item: string }
  | { k: 'flash'; pos: [number, number, number]; by: string }
  | { k: 'escape'; player: string; route: EscapeRoute }
  | { k: 'teleport'; player: string; pos: [number, number, number]; yaw: number; seq: number }
  | { k: 'stumble'; player: string };

export interface MoveMsg {
  seq: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
}

export interface CarInput {
  throttle: number;
  steer: number;
}

export interface Ack<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface JoinAck {
  lobby: LobbyInfo;
  playerId: string;
  token: string;
  match?: MatchInit;
}
