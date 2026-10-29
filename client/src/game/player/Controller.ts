/** First-person controller: input, movement with shared grid collision, stamina, crouch, bob. */
import {
  CROUCH_SPEED,
  HEAVY_ITEM_SPEED_MULT,
  PLAYER_EYE,
  PLAYER_EYE_CROUCH,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  STAMINA_DRAIN,
  STAMINA_REGEN,
  WALK_SPEED,
  WATER_SPEED_MULT,
  F,
  cellFlags,
  floorOfY,
  moveBody,
  type CircleObstacle,
  type DynWorld,
  type Level,
} from '@nower/shared';

export type Action = 'unlocked' | 'interact' | 'interactUp' | 'drop' | 'use' | 'flashlight' | 'pause' | 'journal' | 'inspect' | 'skip' | 'breathOn' | 'breathOff' | 'spectateNext';

export class Input {
  keys = new Set<string>();
  dx = 0;
  dy = 0;
  locked = false;
  private handlers: ((a: Action) => void)[] = [];
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('mousemove', this.move);
    window.addEventListener('mousedown', this.mouse);
    document.addEventListener('pointerlockchange', this.lockChange);
    window.addEventListener('blur', this.blur);
  }

  on(h: (a: Action) => void) {
    this.handlers.push(h);
  }

  private emit(a: Action) {
    for (const h of this.handlers) h(a);
  }

  requestLock() {
    if (this.locked) return;
    try {
      const r = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* pointer lock unavailable (e.g. iframe, automation) */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private down = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (['Space', 'Tab', 'ControlLeft', 'KeyC', 'KeyE', 'KeyF', 'KeyG'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'KeyE':
        this.emit('interact');
        break;
      case 'KeyG':
        this.emit('drop');
        break;
      case 'KeyF':
        this.emit('use');
        break;
      case 'KeyL':
      case 'KeyT':
        this.emit('flashlight');
        break;
      case 'Escape':
      case 'KeyP':
        this.emit('pause');
        break;
      case 'Tab':
      case 'KeyJ':
        this.emit('journal');
        break;
      case 'KeyI':
        this.emit('inspect');
        break;
      case 'Space':
        this.emit('breathOn');
        this.emit('skip');
        break;
      case 'Enter':
        this.emit('skip');
        break;
    }
  };

  private up = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === 'KeyE') this.emit('interactUp');
    if (e.code === 'Space') this.emit('breathOff');
  };

  private move = (e: MouseEvent) => {
    if (!this.locked) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };

  private mouse = (e: MouseEvent) => {
    if (this.locked && e.button === 0) this.emit('spectateNext');
    if (this.locked && e.button === 2) this.emit('flashlight');
  };

  private lockChange = () => {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.el;
    if (was && !this.locked) this.emit('unlocked');
  };

  private blur = () => this.keys.clear();

  has(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  consumeMouse() {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return r;
  }

  dispose() {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('mousemove', this.move);
    window.removeEventListener('mousedown', this.mouse);
    document.removeEventListener('pointerlockchange', this.lockChange);
    window.removeEventListener('blur', this.blur);
  }
}

export class Controller {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  vx = 0;
  vz = 0;
  stamina = 1;
  crouch = false;
  sprinting = false;
  eye = PLAYER_EYE;
  bob = 0;
  bobAmount = 0;
  speed = 0;
  stumbleUntil = 0;
  exhausted = false;
  /** Distance walked since the last footstep (drives footstep sounds). */
  stride = 0;
  onStep: ((mode: 'crouch' | 'walk' | 'sprint') => void) | null = null;

  constructor(
    private level: Level,
    private dyn: DynWorld,
  ) {}

  place(x: number, y: number, z: number, yaw: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vz = 0;
  }

  look(dx: number, dy: number, sens: number, invert: boolean) {
    const k = 0.0022 * sens;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invert ? -1 : 1);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  update(dt: number, input: Input, opts: { canMove: boolean; heavy: boolean; obstacles: CircleObstacle[]; now: number; staminaDrain: number }) {
    const fwd = (input.has('KeyW', 'ArrowUp') ? 1 : 0) - (input.has('KeyS', 'ArrowDown') ? 1 : 0);
    const strafe = (input.has('KeyD', 'ArrowRight') ? 1 : 0) - (input.has('KeyA', 'ArrowLeft') ? 1 : 0);
    this.crouch = opts.canMove && input.has('ControlLeft', 'ControlRight', 'KeyC');
    const wantsSprint = input.has('ShiftLeft', 'ShiftRight') && fwd > 0 && !this.crouch;
    const moving = opts.canMove && (fwd !== 0 || strafe !== 0);
    if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
    this.sprinting = moving && wantsSprint && this.stamina > 0.02 && !this.exhausted;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * opts.staminaDrain * dt);
      if (this.stamina <= 0.01) this.exhausted = true;
    } else this.stamina = Math.min(1, this.stamina + STAMINA_REGEN * dt * (moving ? 0.7 : 1.2));

    const f = floorOfY(this.y);
    const water = cellFlags(this.level, f, Math.floor(this.x), Math.floor(this.z)) & F.SHALLOW;
    let max = this.crouch ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (opts.heavy) max *= HEAVY_ITEM_SPEED_MULT;
    if (water) max *= WATER_SPEED_MULT;
    if (opts.now < this.stumbleUntil) max *= 0.35;
    if (!opts.canMove) max = 0;

    let wx = 0;
    let wz = 0;
    if (moving) {
      const sy = Math.sin(this.yaw);
      const cy = Math.cos(this.yaw);
      // forward = (-sin, -cos); right = (cos, -sin)
      wx = -sy * fwd + cy * strafe;
      wz = -cy * fwd - sy * strafe;
      const l = Math.hypot(wx, wz) || 1;
      wx = (wx / l) * max;
      wz = (wz / l) * max;
    }
    const accel = moving ? 14 : 10;
    const k = Math.min(1, accel * dt);
    this.vx += (wx - this.vx) * k;
    this.vz += (wz - this.vz) * k;
    const bx = this.x;
    const bz = this.z;
    const body = { x: this.x, y: this.y, z: this.z };
    moveBody(this.level, this.dyn, body, this.vx * dt, this.vz * dt, PLAYER_RADIUS, opts.obstacles);
    this.x = body.x;
    this.y = body.y;
    this.z = body.z;
    const moved = Math.hypot(this.x - bx, this.z - bz);
    this.speed = moved / Math.max(dt, 1e-4);
    // eye height eases between standing and crouching
    const targetEye = this.crouch ? PLAYER_EYE_CROUCH : PLAYER_EYE;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);
    // head bob and footsteps
    this.bob += moved * (this.sprinting ? 1.9 : 2.4);
    this.bobAmount += ((this.speed > 0.4 ? 1 : 0) - this.bobAmount) * Math.min(1, dt * 6);
    this.stride += moved;
    const strideLen = this.crouch ? 0.55 : this.sprinting ? 1.05 : 0.75;
    if (this.stride >= strideLen) {
      this.stride = 0;
      this.onStep?.(this.crouch ? 'crouch' : this.sprinting ? 'sprint' : 'walk');
    }
  }
}
