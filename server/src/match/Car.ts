/** Server-side car physics: a simple kinematic bicycle model with grid collision. */
import { CT, forwardFromYaw, groundAt, type CarState, type DynWorld, type Level } from '@nower/shared';

export const CAR_CIRCLES = [-1.45, 0, 1.45];
export const CAR_RADIUS = 0.95;
const WHEELBASE = 2.6;
const MAX_FWD = 10;
const MAX_REV = 3.5;

export interface CarHit {
  kind: 'wall' | 'gate' | 'enemy';
  door?: number;
  speed: number;
}

/** Returns cells under a circle that would block the car, plus any door index hit. */
function circleBlocked(level: Level, dyn: DynWorld, x: number, z: number, r: number): { blocked: boolean; door: number } {
  const f = 2;
  const g = level.floors[f];
  for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++)
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
      const qx = Math.max(cx, Math.min(x, cx + 1));
      const qz = Math.max(cz, Math.min(z, cz + 1));
      if ((qx - x) ** 2 + (qz - z) ** 2 >= r * r) continue;
      const h = groundAt(level, dyn, f, cx, cz, cx + 0.5, cz + 0.5);
      if (Number.isNaN(h) || Math.abs(h) > 0.3) {
        const k = cz * level.W + cx;
        const door = cx >= 0 && cz >= 0 && cx < level.W && cz < level.D && g.type[k] === CT.DOOR ? g.ent[k] : -1;
        return { blocked: true, door };
      }
    }
  return { blocked: false, door: -1 };
}

/**
 * Integrates the car for dt seconds. `enemy` is a circle obstacle; on impact the caller
 * decides what happens (knock him back if fast, otherwise the car is stopped).
 */
export function stepCar(
  level: Level,
  dyn: DynWorld,
  car: CarState,
  input: { throttle: number; steer: number },
  dt: number,
  enemy: { x: number; z: number; r: number } | null,
): CarHit | null {
  const running = car.running && !car.escaped;
  const th = running && car.driver ? input.throttle : 0;
  let accel: number;
  if (th > 0.05) accel = car.speed < -0.2 ? 9 : 4.2 * th;
  else if (th < -0.05) accel = car.speed > 0.2 ? -9 : -2.8 * -th;
  else accel = -Math.sign(car.speed) * Math.min(Math.abs(car.speed) / dt, 2.2);
  car.speed = Math.max(-MAX_REV, Math.min(MAX_FWD, car.speed + accel * dt));
  const targetSteer = running && car.driver ? input.steer : 0;
  car.steer += (targetSteer - car.steer) * Math.min(1, dt * 6);
  if (Math.abs(car.speed) < 0.01) return null;
  const yawRate = (car.speed * Math.tan(car.steer * 0.55)) / WHEELBASE;
  const nyaw = car.yaw - yawRate * dt;
  const f = forwardFromYaw(nyaw);
  const nx = car.x + f.x * car.speed * dt;
  const nz = car.z + f.z * car.speed * dt;
  for (const off of CAR_CIRCLES) {
    const cx = nx + f.x * off;
    const cz = nz + f.z * off;
    const b = circleBlocked(level, dyn, cx, cz, CAR_RADIUS);
    if (b.blocked) {
      const hit: CarHit = { kind: b.door >= 0 && level.doors[b.door].spec.id === 'drive_gate' ? 'gate' : 'wall', door: b.door, speed: car.speed };
      car.speed = -car.speed * 0.15;
      return hit;
    }
    if (enemy && Math.hypot(cx - enemy.x, cz - enemy.z) < CAR_RADIUS + enemy.r) {
      const hit: CarHit = { kind: 'enemy', speed: car.speed };
      car.speed *= 0.25;
      return hit;
    }
  }
  car.x = nx;
  car.z = nz;
  car.yaw = nyaw;
  return null;
}
