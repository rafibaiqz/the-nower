/** Global gameplay constants shared by client and server. Units are metres and seconds. */
export const GAME_TITLE = 'THE NOWER';
export const DEV_CREDIT = 'Raff & Noer';

export const SERVER_TICK_HZ = 20;
export const SNAPSHOT_HZ = 20;
export const CLIENT_SEND_HZ = 20;
export const INTERP_DELAY_MS = 110;

export const FLOOR_HEIGHT = 4;
/** Floor index of the ground floor (0 = sewer, 1 = basement, 2 = ground, 3 = upper, 4 = attic). */
export const GROUND_FLOOR = 2;
export const FLOOR_COUNT = 5;
export const FLOOR_NAMES = ['Sewer', 'Basement', 'Ground Floor', 'Upper Floor', 'Attic'] as const;

export const PLAYER_RADIUS = 0.3;
export const PLAYER_EYE = 1.6;
export const PLAYER_EYE_CROUCH = 0.95;
export const ENEMY_RADIUS = 0.35;
export const ENEMY_EYE = 1.75;

export const STEP_UP = 0.65;
export const STEP_DOWN = 0.75;

export const WALK_SPEED = 3.0;
export const SPRINT_SPEED = 5.2;
export const CROUCH_SPEED = 1.5;
export const HEAVY_ITEM_SPEED_MULT = 0.78;
export const WATER_SPEED_MULT = 0.75;

export const STAMINA_MAX = 1;
export const STAMINA_DRAIN = 0.2; // per second sprinting
export const STAMINA_REGEN = 0.12;

export const FLASHLIGHT_DRAIN = 1 / 420; // full battery lasts 7 minutes of continuous use
export const BREATH_MAX = 8; // seconds a hidden player can hold their breath

export const INTERACT_RANGE = 2.4;
export const SERVER_INTERACT_SLACK = 0.9;

export const CAPTURE_RANGE = 1.05;
export const RESCUE_HOLD = 3;
export const RECONNECT_GRACE_MS = 90_000;

export const DEFAULT_MAX_PLAYERS = 4;
export const LOBBY_CODE_LENGTH = 5;
export const LOBBY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_NAME_LENGTH = 16;

export function floorBase(floor: number): number {
  return (floor - GROUND_FLOOR) * FLOOR_HEIGHT;
}

/** Which floor grid a body at height y belongs to. The switch happens half way up a staircase. */
export function floorOfY(y: number): number {
  const f = Math.round(y / FLOOR_HEIGHT) + GROUND_FLOOR;
  return f < 0 ? 0 : f >= FLOOR_COUNT ? FLOOR_COUNT - 1 : f;
}
