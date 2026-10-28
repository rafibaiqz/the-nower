/**
 * Authoritative match simulation. The server owns every piece of game state: positions are
 * validated, items/doors/mechanisms change only through server-side rules, the enemy is
 * simulated here, and victory/defeat is decided here. Clients receive snapshots (20 Hz) and
 * batched discrete events.
 */
import {
  CAPTURE_RANGE,
  CROUCH_SPEED,
  DIFFICULTY,
  ENEMY_RADIUS,
  F,
  HEAVY_ITEM_SPEED_MULT,
  INTERACT_RANGE,
  ITEM_BY_TYPE,
  NOISE,
  PF,
  PLAYER_EYE,
  PLAYER_EYE_CROUCH,
  RECONNECT_GRACE_MS,
  RESCUE_HOLD,
  Rng,
  SERVER_INTERACT_SLACK,
  SPRINT_SPEED,
  ENEMY_ANIMS,
  ENEMY_STATES,
  allItemIds,
  castRay,
  cellFlags,
  computeAreas,
  dropNoise,
  floorOfY,
  forwardFromYaw,
  getLevel,
  itemDef,
  lineOfSight,
  makePuzzles,
  nearestStandable,
  placeItems,
  pressureOf,
  resolveInteraction,
  roomAt,
  segmentWalkable,
  surfaceOfFloorMat,
  targetPos,
  type CarInput,
  type CarState,
  type Difficulty,
  type DifficultyTuning,
  type DoorState,
  type DynWorld,
  type EscapeRoute,
  type GameEvent,
  type Interaction,
  type ItemState,
  type Level,
  type MatchAlert,
  type MatchInit,
  type MatchPhase,
  type MatchResult,
  type MechStates,
  type MoveMsg,
  type NavWorld,
  type PlayerPublic,
  type PuzzleSetup,
  type Snapshot,
  type SoundName,
  type TrapState,
  type WorldView,
} from '@nower/shared';
import { log } from '../log';
import { CAR_CIRCLES, CAR_RADIUS, stepCar } from './Car';
import { EnemyAI, type AIPlayer, type EnemyHost } from './EnemyAI';

export const TICK_MS = 50;
export const COUNTDOWN_MS = 4000;

export interface MatchPlayerInit {
  id: string;
  name: string;
  color: number;
}

export interface MatchSink {
  broadcast(event: string, data: unknown, volatile?: boolean): void;
  toPlayer(playerId: string, event: string, data: unknown): void;
  onEnded(result: MatchResult): void;
}

interface Hold {
  ref: string;
  action: string;
  start: number;
  dur: number;
  nextNoise: number;
}

interface MPlayer {
  pub: PlayerPublic;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  vx: number;
  vz: number;
  lastMoveAt: number;
  teleportSeq: number;
  stride: number;
  lastCell: number;
  lastSprintAt: number;
  hold: Hold | null;
  graceUntil: number;
  trappedUntil: number;
  trapIndex: number;
  captureEndsAt: number;
  climb: { until: number; to: [number, number, number] } | null;
  disconnectedAt: number | null;
  breath: number;
  holdingBreath: boolean;
  nextBreathNoise: number;
  carInput: CarInput;
  stumbleUntil: number;
}

const HOLD_NOISE: Record<string, [number, number]> = {
  front_pick: [NOISE.lockpick, 1.0],
  winch_crank: [NOISE.crank, 0.8],
  wheel_turn: [NOISE.crank, 0.8],
  shutter_bolts: [NOISE.crank, 0.9],
  shutter_raise: [NOISE.shutter * 0.6, 0.7],
  car_battery: [NOISE.carRepair, 1.1],
  car_coil: [NOISE.carRepair, 1.1],
  car_relay: [NOISE.carRepair * 0.6, 1.2],
  car_fuel: [8, 1.2],
  cage_rescue: [NOISE.cageRattle, 0.9],
  cage_latch: [NOISE.cageRattle, 1.0],
  grate_force: [18, 1.0],
  valve_turn: [10, 0.6],
  free_trap: [8, 0.7],
  fuse_install: [NOISE.install, 1.0],
  pump_fuse: [NOISE.install, 1.0],
  manifold_gauge: [NOISE.install, 1.0],
  manifold_handle: [NOISE.install, 1.0],
  wheel_fit: [NOISE.install, 1.0],
};

const HOLD_MULT: Record<Difficulty, number> = { easy: 0.85, normal: 1, hard: 1.12, extreme: 1.25 };

export class Match implements WorldView, EnemyHost {
  readonly level: Level = getLevel();
  readonly difficulty: Difficulty;
  readonly tuning: DifficultyTuning;
  readonly seed: number;
  readonly rng: Rng;
  now = Date.now();

  doors: DoorState[];
  items = new Map<string, ItemState>();
  containers: boolean[];
  hides: (string | null)[];
  ladders: boolean[];
  water: { drained: boolean; level: number }[];
  mechs: MechStates;
  car: CarState;
  traps: (TrapState & { rearmAt: number })[] = [];
  players = new Map<string, PlayerPublic>();
  valveWeights: number[];
  valveTarget: number;

  phase: MatchPhase = 'COUNTDOWN';
  phaseEndsAt: number;
  alert: MatchAlert = 'NONE';
  result: MatchResult | null = null;
  journal: string[] = [];

  readonly enemy: EnemyAI;
  readonly dyn: DynWorld;
  readonly nav: NavWorld;
  private mp = new Map<string, MPlayer>();
  private puzzles: PuzzleSetup;
  private events: GameEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();
  private decoys: { id: string; x: number; y: number; z: number; start: number; end: number; next: number }[] = [];
  private noiseLog: { f: number; x: number; z: number; t: number; w: number }[] = [];
  private nextGenNoise = 0;
  private nextPumpNoise = 0;
  private nextEngineNoise = 0;
  private carSentAt = 0;
  private ended = false;
  private endedAt = 0;

  constructor(
    players: MatchPlayerInit[],
    difficulty: Difficulty,
    private sink: MatchSink,
    seed = (Math.random() * 0xffffffff) >>> 0,
  ) {
    this.difficulty = difficulty;
    this.tuning = DIFFICULTY[difficulty];
    this.seed = seed;
    this.rng = new Rng(seed ^ 0x13371337);
    const L = this.level;
    const now = Date.now();
    this.now = now;
    this.phaseEndsAt = now + COUNTDOWN_MS;

    this.dyn = { doorOpen: (i) => this.doors[i].open, waterDrained: (i) => this.water[i].drained };
    this.nav = {
      doorOpen: (i) => this.doors[i].open,
      doorPassable: (i) => L.doors[i].spec.enemyPassable || !this.doors[i].locked,
      waterDrained: (i) => this.water[i].drained,
      ladderOpen: (i) => this.ladders[i],
    };

    this.doors = L.doors.map((d) => {
      const lock = d.spec.lock;
      const locked = !!lock && lock.kind !== 'cage';
      return { open: !locked && !!d.spec.startsOpen, locked };
    });
    this.containers = L.containers.map(() => false);
    this.hides = L.hides.map(() => null);
    this.ladders = L.ladders.map((l) => !l.spec.lockMech);
    this.water = L.water.map(() => ({ drained: false, level: 1 }));

    this.puzzles = makePuzzles(seed);
    this.valveWeights = this.puzzles.valveWeights;
    this.valveTarget = this.puzzles.valveTarget;
    this.mechs = {
      front: { keyLock: false, padlock: false, maglock: false, handle: false, bar: false, open: false, attempts: 0, lockedUntil: 0 },
      fuse: false,
      generator: { running: false, until: 0 },
      shutter: { bolts: false, open: false },
      pump: { fuse: false, running: false, drained: false, progress: 0 },
      manifold: { gauge: false, handle: false, valves: [...this.puzzles.valveStart], equalized: false },
      floodgate: { key: false, open: false },
      finalGrate: { wheel: false, open: false },
      gardenGrate: false,
      driveGate: false,
    };
    this.car = {
      x: L.carStart.x,
      z: L.carStart.z,
      yaw: L.carStart.yaw,
      speed: 0,
      steer: 0,
      hood: false,
      battery: false,
      coil: false,
      relay: false,
      fuel: 0,
      key: false,
      running: false,
      driver: null,
      passenger: null,
      escaped: false,
    };

    // dependency-validated, seeded item placement
    const areas = computeAreas(L);
    const placement = placeItems(L, areas, seed);
    for (const { id, type } of allItemIds()) {
      const si = placement.spawnOf.get(id);
      if (si === undefined) continue;
      const sp = L.spawns[si];
      const def = itemDef(type);
      this.items.set(id, { id, type, place: 'world', holder: null, pos: [...sp.pos], container: sp.container, charges: def.use === 'flash' ? 2 : 1 });
    }
    log.info('match created', { seed, difficulty, placementAttempts: placement.attempts, fallback: placement.fallback });

    // traps
    const cands = this.rng.shuffle([...L.trapCandidates]);
    const start = L.playerStarts[0];
    for (const c of cands) {
      if (this.traps.length >= this.tuning.trapCount) break;
      if (c.f === 3 && Math.hypot(c.x - start[0], c.z - start[2]) < 10) continue;
      if (this.traps.some((t) => t.f === c.f && Math.hypot(t.x - c.x, t.z - c.z) < 6)) continue;
      const r = this.rng.next();
      this.traps.push({ kind: r < 0.5 ? 'snare' : r < 0.8 ? 'cans' : 'bell', f: c.f, x: c.x, z: c.z, armed: true, victim: null, rearmAt: 0 });
    }

    players.forEach((pi, i) => {
      const s = L.playerStarts[i % L.playerStarts.length];
      const pub: PlayerPublic = {
        id: pi.id,
        name: pi.name,
        color: pi.color,
        status: 'free',
        connected: true,
        captures: 0,
        held: null,
        hide: -1,
        escapedVia: null,
        cagedAt: 0,
        battery: 1,
      };
      this.players.set(pi.id, pub);
      this.mp.set(pi.id, {
        pub,
        x: s[0],
        y: s[1],
        z: s[2],
        yaw: Math.PI * 0.75,
        pitch: 0,
        flags: 0,
        vx: 0,
        vz: 0,
        lastMoveAt: now,
        teleportSeq: 0,
        stride: 0,
        lastCell: -1,
        lastSprintAt: 0,
        hold: null,
        graceUntil: 0,
        trappedUntil: 0,
        trapIndex: -1,
        captureEndsAt: 0,
        climb: null,
        disconnectedAt: null,
        breath: 8,
        holdingBreath: false,
        nextBreathNoise: 0,
        carInput: { throttle: 0, steer: 0 },
        stumbleUntil: 0,
      });
    });

    const activeAt = now + COUNTDOWN_MS + this.tuning.graceSeconds * 1000;
    this.enemy = new EnemyAI(this, L.enemyStart, activeAt);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start() {
    this.lastTick = Date.now();
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        log.error('match tick failed', { err: String((err as Error)?.stack ?? err) });
      }
    }, TICK_MS);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get isEnded() {
    return this.ended;
  }

  /** Tests drive time manually; production uses the wall clock. */
  manualClock = false;

  private stamp() {
    if (!this.manualClock) this.now = Date.now();
  }

  /** Advances the simulation (exposed for tests). */
  tick(dtOverride?: number) {
    const now = this.manualClock ? this.now + (dtOverride ?? TICK_MS / 1000) * 1000 : Date.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastTick) / 1000));
    this.lastTick = now;
    this.now = now;

    if (this.phase === 'COUNTDOWN' && now >= this.phaseEndsAt) {
      this.phase = 'PLAYING';
      this.phaseEndsAt = 0;
      this.emitPhase();
    }
    if (this.phase === 'PLAYING') {
      this.tickPlayers(dt);
      this.tickMechs(dt);
      this.tickCar(dt);
      this.enemy.update(dt, now);
      this.tickTraps();
      this.checkEscapes();
      this.checkEnd();
    }
    this.flush();
  }

  private flush() {
    if (this.events.length) {
      this.sink.broadcast('g:ev', this.events);
      this.events = [];
    }
    this.sink.broadcast('g:snap', this.snapshot(), true);
  }

  private ev(e: GameEvent) {
    this.events.push(e);
  }

  private emitPhase() {
    this.ev({ k: 'phase', phase: this.phase, alert: this.alert, result: this.result, endsAt: this.phaseEndsAt });
  }

  private pubChanged(p: MPlayer) {
    this.ev({ k: 'player', s: { ...p.pub } });
  }

  private sound(s: SoundName, pos: [number, number, number], v = 1, by?: string) {
    this.ev({ k: 'sound', s, pos, v, by });
  }

  private notify(text: string, tone: 'info' | 'good' | 'bad' | 'warn' = 'info', to?: string) {
    this.ev({ k: 'notify', text, tone, to });
  }

  /** Every gameplay noise goes through here and is offered to the Nower's hearing. */
  noise(f: number, x: number, y: number, z: number, intensity: number, source: string | null, hiddenSource = false) {
    if (intensity <= 0) return;
    this.enemy.hear(f, x, y, z, intensity, source, hiddenSource);
    if (intensity >= 10) this.noiseLog.push({ f, x, z, t: this.now, w: Math.min(4, intensity / 10) });
  }

  // ---------------------------------------------------------------------------
  // Snapshots / init
  // ---------------------------------------------------------------------------

  snapshot(): Snapshot {
    const p: Snapshot['p'] = [];
    for (const m of this.mp.values()) {
      if (m.pub.status === 'escaped' || m.pub.status === 'eliminated') continue;
      p.push([m.pub.id, r2(m.x), r2(m.y), r2(m.z), r2(m.yaw), r2(m.pitch), m.flags]);
    }
    const e = this.enemy;
    return {
      t: this.now,
      p,
      e: [r2(e.x), r2(e.y), r2(e.z), r2(e.yaw), ENEMY_STATES.indexOf(e.state), ENEMY_ANIMS.indexOf(e.anim), r2(e.speed), e.target ?? ''],
      c: [r2(this.car.x), r2(this.car.z), r2(this.car.yaw), r2(this.car.speed), r2(this.car.steer)],
    };
  }

  initFor(playerId: string): MatchInit {
    const m = this.mp.get(playerId);
    return {
      you: playerId,
      seed: this.seed,
      difficulty: this.difficulty,
      serverTime: Date.now(),
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      alert: this.alert,
      result: this.result,
      players: [...this.players.values()].map((p) => ({ ...p })),
      doors: this.doors.map((d) => ({ ...d })),
      items: [...this.items.values()].map((i) => ({ ...i, pos: [...i.pos] as [number, number, number] })),
      containers: [...this.containers],
      hides: [...this.hides],
      ladders: [...this.ladders],
      water: this.water.map((w) => ({ ...w })),
      mechs: structuredClone(this.mechs),
      car: { ...this.car },
      traps: this.traps.map(({ rearmAt: _r, ...t }) => ({ ...t })),
      journal: [...this.journal],
      panelSymbols: this.puzzles.panelSymbols,
      valveWeights: this.valveWeights,
      valveTarget: this.valveTarget,
      snapshot: this.snapshot(),
      teleportSeq: m?.teleportSeq ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // EnemyHost
  // ---------------------------------------------------------------------------

  aiPlayers(): AIPlayer[] {
    const out: AIPlayer[] = [];
    for (const m of this.mp.values()) {
      if (m.disconnectedAt !== null && m.pub.status === 'free') continue;
      const inCar = m.pub.status === 'driving' || m.pub.status === 'passenger';
      out.push({
        id: m.pub.id,
        x: m.x,
        y: m.y,
        z: m.z,
        vx: m.vx,
        vz: m.vz,
        status: m.pub.status,
        crouch: !!(m.flags & PF.CROUCH),
        flash: !!(m.flags & PF.FLASH) && m.pub.battery > 0,
        hide: m.pub.hide,
        graceUntil: m.graceUntil,
        inCar,
        carSpeed: Math.abs(this.car.speed),
      });
    }
    return out;
  }

  hideOccupant(hide: number) {
    return this.hides[hide] ?? null;
  }

  isDoorOpen(door: number) {
    return this.doors[door].open;
  }

  isDoorLocked(door: number) {
    return this.doors[door].locked;
  }

  enemyOpenDoor(door: number) {
    const d = this.doors[door];
    if (d.open) return;
    d.open = true;
    this.ev({ k: 'door', i: door, open: true, locked: d.locked });
    const c = this.level.doors[door].center;
    this.sound('enemy_open_door', [c[0], c[1] + 1, c[2]]);
  }

  enemyCloseDoor(door: number) {
    const d = this.doors[door];
    if (!d.open || this.bodyInDoor(door)) return;
    d.open = false;
    this.ev({ k: 'door', i: door, open: false, locked: d.locked });
    const c = this.level.doors[door].center;
    this.sound('door_close', [c[0], c[1] + 1, c[2]], 0.7);
  }

  cue(cue: 'heard' | 'spotted' | 'lost' | 'search' | 'capture' | 'stunned' | 'chase_end', target?: string, pos?: [number, number, number]) {
    this.ev({ k: 'cue', cue, target, pos });
  }

  carObstacle() {
    if (this.car.escaped) return null;
    return { x: this.car.x, z: this.car.z, r: 2.1, f: 2 };
  }

  roomBright(f: number, x: number, z: number) {
    const ri = roomAt(this.level, f, x, z);
    if (ri < 0) return 0.6;
    const room = this.level.rooms[ri];
    if (this.mechs.generator.running && room.spec.zone === 'basement') return 1;
    return room.bright;
  }

  patrolInterest() {
    const out: { f: number; x: number; z: number; w: number }[] = [];
    const now = this.now;
    this.noiseLog = this.noiseLog.filter((n) => now - n.t < 60000);
    for (const n of this.noiseLog) out.push({ f: n.f, x: n.x, z: n.z, w: n.w * (1 - (now - n.t) / 60000) });
    const ea = this.tuning.escapeAwareness * 10;
    const fr = this.mechs.front;
    const frontProgress = (Number(fr.keyLock) + Number(fr.padlock) + Number(fr.maglock) + Number(fr.bar)) / 4;
    if (frontProgress > 0) out.push({ f: 2, x: 48, z: 52, w: ea * frontProgress });
    const c = this.car;
    const carProgress = (Number(c.battery) + Number(c.coil) + Number(c.relay) + Number(c.fuel >= 1) + Number(c.key) + Number(this.mechs.shutter.bolts)) / 6;
    if (carProgress > 0) out.push({ f: 2, x: 83, z: 40, w: ea * carProgress });
    const pm = this.mechs;
    const sewerProgress = (Number(pm.pump.drained) + Number(pm.manifold.equalized) + Number(pm.floodgate.open)) / 3;
    if (sewerProgress > 0) out.push({ f: 0, x: 30, z: 58, w: ea * sewerProgress });
    if ([...this.mp.values()].some((m) => m.pub.status === 'caged')) out.push({ f: 1, x: 40, z: 31, w: 2.5 });
    return out;
  }

  capture(playerId: string) {
    const m = this.mp.get(playerId);
    if (!m) return;
    const st = m.pub.status;
    if (st === 'captured' || st === 'caged' || st === 'escaped' || st === 'eliminated') return;
    if (st === 'hidden') this.leaveHide(m, false);
    if (st === 'driving' || st === 'passenger') this.leaveCar(m);
    this.cancelHold(m);
    if (m.pub.held) this.dropHeld(m, false);
    if (m.trapIndex >= 0) this.releaseTrap(m);
    m.climb = null;
    m.pub.status = 'captured';
    m.pub.captures++;
    m.captureEndsAt = this.now + 2300;
    this.alert = 'PLAYER_CAPTURED';
    this.pubChanged(m);
    this.cue('capture', playerId, [m.x, m.y, m.z]);
    this.notify(`${m.pub.name.toUpperCase()} WAS CAUGHT`, 'bad');
    this.emitPhase();
    this.enemy.forget(playerId);
  }

  // ---------------------------------------------------------------------------
  // Player input
  // ---------------------------------------------------------------------------

  private roomOf(m: MPlayer) {
    return roomAt(this.level, floorOfY(m.y), m.x, m.z);
  }

  handleMove(playerId: string, msg: MoveMsg) {
    const m = this.mp.get(playerId);
    if (!m || this.phase === 'ENDED') return;
    this.stamp();
    if (msg.seq < m.teleportSeq) return;
    const st = m.pub.status;
    m.yaw = msg.yaw;
    m.pitch = msg.pitch;
    if (st === 'hidden' || st === 'driving' || st === 'passenger' || st === 'captured' || st === 'trapped' || st === 'climbing') {
      m.flags = (msg.flags & (PF.FLASH | PF.HOLDING_BREATH)) | (st === 'hidden' ? 0 : m.flags & PF.CROUCH);
      m.holdingBreath = st === 'hidden' && !!(msg.flags & PF.HOLDING_BREATH) && m.breath > 0;
      m.lastMoveAt = this.now;
      return;
    }
    if (st !== 'free' && st !== 'caged') return;
    if (this.phase === 'COUNTDOWN') {
      m.lastMoveAt = this.now;
      m.flags = msg.flags & PF.FLASH;
      return;
    }
    const dt = Math.min(1, Math.max(0.016, (this.now - m.lastMoveAt) / 1000));
    const dx = msg.x - m.x;
    const dz = msg.z - m.z;
    const dist = Math.hypot(dx, dz);
    const heavy = m.pub.held && itemDef(this.items.get(m.pub.held)!.type).heavy;
    const maxSpeed = SPRINT_SPEED * (heavy ? HEAVY_ITEM_SPEED_MULT : 1) * 1.3;
    const allowed = maxSpeed * dt + 0.45;
    if (dist > allowed) {
      this.correct(m);
      return;
    }
    if (dist > 0.001) {
      const seg = segmentWalkable(this.level, this.dyn, m.x, m.y, m.z, msg.x, msg.z);
      if (!seg.ok) {
        this.correct(m);
        return;
      }
      const speed = dist / dt;
      m.vx = m.vx * 0.5 + (dx / dt) * 0.5;
      m.vz = m.vz * 0.5 + (dz / dt) * 0.5;
      m.x = msg.x;
      m.z = msg.z;
      m.y = seg.y;
      this.movementNoise(m, dist, speed, msg.flags);
    } else {
      m.vx *= 0.5;
      m.vz *= 0.5;
    }
    m.flags = msg.flags;
    m.lastMoveAt = this.now;
    this.checkTrapStep(m);
  }

  private correct(m: MPlayer) {
    this.teleport(m, [m.x, m.y, m.z], m.yaw);
  }

  private teleport(m: MPlayer, pos: [number, number, number], yaw: number) {
    m.x = pos[0];
    m.y = pos[1];
    m.z = pos[2];
    m.yaw = yaw;
    m.vx = 0;
    m.vz = 0;
    m.teleportSeq++;
    m.lastMoveAt = this.now;
    this.ev({ k: 'teleport', player: m.pub.id, pos, yaw, seq: m.teleportSeq });
  }

  /** Footsteps, creaky boards, water splashes — derived from validated movement, not client claims. */
  private movementNoise(m: MPlayer, dist: number, speed: number, flags: number) {
    const L = this.level;
    const f = floorOfY(m.y);
    const crouch = !!(flags & PF.CROUCH) && speed < CROUCH_SPEED * 1.5;
    const sprint = speed > 4.1;
    if (sprint) m.lastSprintAt = this.now;
    const fl = cellFlags(L, f, Math.floor(m.x), Math.floor(m.z));
    const ri = roomAt(L, f, m.x, m.z);
    const surface = fl & F.SHALLOW ? 'water' : fl & F.GRATE ? 'metal' : ri >= 0 ? surfaceOfFloorMat(L.rooms[ri].spec.floor) : 'stone';
    const surf: Record<string, number> = { carpet: 0.6, wood: 1, tile: 1.1, stone: 1, concrete: 1, metal: 1.6, grass: 0.7, gravel: 1.25, water: 1.45, dirt: 0.8 };
    const cell = f * 100000 + Math.floor(m.z) * L.W + Math.floor(m.x);
    if (cell !== m.lastCell) {
      m.lastCell = cell;
      if (fl & F.WEAK && sprint) {
        this.noise(f, m.x, m.y, m.z, NOISE.weakBoard, m.pub.id);
        this.sound('weak_board', [m.x, m.y, m.z], 1, m.pub.id);
        m.stumbleUntil = this.now + 1200;
        this.ev({ k: 'stumble', player: m.pub.id });
      } else if (fl & F.CREAKY) {
        this.noise(f, m.x, m.y, m.z, crouch ? NOISE.creakCrouch : NOISE.creak, m.pub.id);
      }
      if (fl & F.SLIPPERY && sprint && this.rng.chance(0.35)) {
        this.noise(f, m.x, m.y, m.z, 11, m.pub.id);
        this.sound('splash', [m.x, m.y, m.z], 1, m.pub.id);
        m.stumbleUntil = this.now + 1000;
        this.ev({ k: 'stumble', player: m.pub.id });
      }
    }
    m.stride += dist;
    const strideLen = crouch ? 0.55 : sprint ? 1.05 : 0.75;
    if (m.stride >= strideLen) {
      m.stride = 0;
      const base = crouch ? NOISE.crouch : sprint ? NOISE.sprint : NOISE.walk;
      this.noise(f, m.x, m.y, m.z, base * (surf[surface] ?? 1), m.pub.id);
    }
  }

  handleBreath(playerId: string, holding: boolean) {
    const m = this.mp.get(playerId);
    if (!m) return;
    m.holdingBreath = holding && m.pub.status === 'hidden' && m.breath > 0;
  }

  handleCarInput(playerId: string, input: CarInput) {
    const m = this.mp.get(playerId);
    if (!m || m.pub.status !== 'driving') return;
    m.carInput = input;
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  private eye(m: MPlayer) {
    return m.y + (m.flags & PF.CROUCH ? PLAYER_EYE_CROUCH : PLAYER_EYE);
  }

  private refPos(ref: string): [number, number, number] | null {
    if (ref.startsWith('player:')) {
      const o = this.mp.get(ref.slice(7));
      return o ? [o.x, o.y + 0.8, o.z] : null;
    }
    return targetPos(this, ref);
  }

  /** Server-side reach test: distance and line of sight to (just in front of) the target. */
  private inReach(m: MPlayer, ref: string): boolean {
    const pos = this.refPos(ref);
    if (!pos) return false;
    const ey = this.eye(m);
    const dx = pos[0] - m.x;
    const dy = pos[1] - ey;
    const dz = pos[2] - m.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > INTERACT_RANGE + SERVER_INTERACT_SLACK) return false;
    const pull = Math.min(0.5, d * 0.5);
    const tx = pos[0] - (dx / d) * pull;
    const ty = pos[1] - (dy / d) * pull;
    const tz = pos[2] - (dz / d) * pull;
    const ignore = ref.startsWith('door:') ? Number(ref.split(':')[1]) : -1;
    return d < 0.6 || lineOfSight(this.level, this.dyn, m.x, ey, m.z, tx, ty, tz, ignore);
  }

  handleAct(playerId: string, ref: string): { ok: boolean; error?: string; data?: unknown } {
    const m = this.mp.get(playerId);
    this.stamp();
    if (!m || this.phase !== 'PLAYING') return { ok: false, error: 'Not now.' };
    if (m.hold) return { ok: false, error: 'Busy.' };
    const inter = resolveInteraction(this, playerId, ref, this.roomOf(m));
    if (!inter) return { ok: false, error: 'Nothing to do.' };
    if (!inter.enabled) return { ok: false, error: inter.label };
    const noRange = inter.action === 'unhide' || inter.action === 'car_exit';
    if (!noRange && !this.inReach(m, ref)) return { ok: false, error: 'Too far away.' };
    if (inter.hold > 0) {
      const dur = inter.hold * 1000 * HOLD_MULT[this.difficulty] * (inter.action === 'cage_rescue' ? RESCUE_HOLD / 3 : 1);
      m.hold = { ref, action: inter.action, start: this.now, dur, nextNoise: this.now + 300 };
      m.flags |= PF.INTERACTING;
      this.ev({ k: 'hold', player: playerId, target: ref, label: inter.label, dur });
      return { ok: true, data: { hold: dur } };
    }
    return this.execute(m, inter);
  }

  handleHoldStop(playerId: string) {
    const m = this.mp.get(playerId);
    if (m?.hold) this.cancelHold(m);
  }

  private cancelHold(m: MPlayer) {
    if (!m.hold) return;
    m.hold = null;
    m.flags &= ~PF.INTERACTING;
    this.ev({ k: 'holdEnd', player: m.pub.id, ok: false });
  }

  private consumeHeld(m: MPlayer) {
    const id = m.pub.held;
    if (!id) return;
    const it = this.items.get(id)!;
    it.place = 'used';
    it.holder = null;
    m.pub.held = null;
    this.ev({ k: 'item', s: { ...it } });
    this.pubChanged(m);
  }

  private mechChanged() {
    this.ev({ k: 'mechs', s: structuredClone(this.mechs) });
  }

  private setDoor(i: number, open: boolean, locked = this.doors[i].locked) {
    this.doors[i].open = open;
    this.doors[i].locked = locked;
    this.ev({ k: 'door', i, open, locked });
  }

  private doorIndex(id: string) {
    return this.level.doorById.get(id)!;
  }

  private bodyInDoor(door: number): boolean {
    const d = this.level.doors[door];
    const cells = d.spec.cells;
    const f = d.spec.f;
    const inCells = (x: number, y: number, z: number, r: number) =>
      floorOfY(y) === f && cells.some(([cx, cz]) => x + r > cx && x - r < cx + 1 && z + r > cz && z - r < cz + 1);
    for (const m of this.mp.values()) {
      if (m.pub.status === 'escaped' || m.pub.status === 'eliminated' || m.pub.status === 'hidden') continue;
      if (inCells(m.x, m.y, m.z, 0.3)) return true;
    }
    return inCells(this.enemy.x, this.enemy.y, this.enemy.z, ENEMY_RADIUS);
  }

  private execute(m: MPlayer, inter: Interaction): { ok: boolean; error?: string; data?: unknown } {
    const L = this.level;
    const id = m.pub.id;
    const ref = inter.target;
    const pos = this.refPos(ref) ?? [m.x, m.y + 1, m.z];
    const f = floorOfY(m.y);
    const nm = this.tuning.interactionNoiseMult;
    const [kind, a] = ref.split(':');
    const fr = this.mechs.front;

    switch (inter.action) {
      case 'door_toggle': {
        const i = Number(a);
        const d = this.doors[i];
        const spec = L.doors[i].spec;
        if (d.open && this.bodyInDoor(i)) return { ok: false, error: 'Something is in the way.' };
        const opening = !d.open;
        this.setDoor(i, opening);
        const rusty = spec.kind === 'wood_old' || spec.kind === 'iron' || spec.kind === 'cage' || spec.secret;
        const slam = !opening && !!(m.flags & PF.SPRINT);
        const n = slam ? NOISE.doorSlam : rusty ? NOISE.doorRusty : NOISE.doorOpen;
        this.noise(f, pos[0], pos[1], pos[2], n * nm, id);
        this.sound(slam ? 'door_slam' : opening ? 'door_open' : 'door_close', pos, 1, id);
        return { ok: true };
      }
      case 'door_unlock': {
        const i = Number(a);
        const item = m.pub.held ? this.items.get(m.pub.held)!.type : '';
        this.consumeHeld(m);
        this.setDoor(i, true, false);
        this.noise(f, pos[0], pos[1], pos[2], 8 * nm, id);
        this.sound('door_unlock', pos, 1, id);
        const rooms = L.doors[i].rooms.filter((r) => r >= 0).map((r) => L.rooms[r].spec.name);
        this.notify(`${itemDef(item).name.toUpperCase()} USED — ${rooms.join(' / ').toUpperCase()} UNLOCKED`, 'good');
        return { ok: true };
      }
      case 'door_unbolt': {
        const i = Number(a);
        this.setDoor(i, true, false);
        this.noise(f, pos[0], pos[1], pos[2], 10 * nm, id);
        this.sound('door_unlock', pos, 1, id);
        this.notify(L.doors[i].spec.kind === 'bookcase' ? 'A HIDDEN PASSAGE GRINDS OPEN' : 'THE BOLT SLIDES BACK', 'good');
        return { ok: true };
      }
      case 'cage_rescue':
      case 'cage_latch': {
        this.openCage(m);
        return { ok: true };
      }
      case 'pickup': {
        const it = this.items.get(a);
        if (!it || it.place !== 'world') return { ok: false, error: 'Gone.' };
        const def = itemDef(it.type);
        if (def.battery) {
          it.place = 'used';
          it.holder = null;
          m.pub.battery = 1;
          this.ev({ k: 'item', s: { ...it } });
          this.pubChanged(m);
          this.sound('pickup', it.pos, 0.6, id);
          this.notify('FLASHLIGHT RECHARGED', 'good', id);
          return { ok: true };
        }
        if (m.pub.held) {
          // swap: put the carried item where the new one was
          const old = this.items.get(m.pub.held)!;
          old.place = 'world';
          old.holder = null;
          old.pos = [...it.pos];
          old.container = it.container;
          this.ev({ k: 'item', s: { ...old } });
        }
        it.place = 'held';
        it.holder = id;
        it.container = -1;
        m.pub.held = it.id;
        this.ev({ k: 'item', s: { ...it } });
        this.pubChanged(m);
        this.noise(f, it.pos[0], it.pos[1], it.pos[2], 2, id);
        this.sound('pickup', it.pos, 1, id);
        return { ok: true };
      }
      case 'cont_toggle': {
        const i = Number(a);
        this.containers[i] = !this.containers[i];
        this.ev({ k: 'container', i, open: this.containers[i] });
        this.noise(f, pos[0], pos[1], pos[2], NOISE.drawer * nm, id);
        this.sound(this.containers[i] ? 'drawer_open' : 'drawer_close', pos, 1, id);
        return { ok: true };
      }
      case 'hide': {
        const i = Number(a);
        if (this.hides[i]) return { ok: false, error: 'Occupied.' };
        const h = L.hides[i];
        this.hides[i] = id;
        m.pub.status = 'hidden';
        m.pub.hide = i;
        m.breath = Math.max(m.breath, 3);
        this.teleport(m, [h.inside[0], h.inside[1], h.inside[2]], h.yaw);
        this.ev({ k: 'hide', i, occupant: id });
        this.pubChanged(m);
        this.sound('hide_in', [h.inside[0], h.inside[1] + 1, h.inside[2]], 0.8, id);
        this.noise(h.f, h.inside[0], h.inside[1], h.inside[2], 3, id);
        this.enemy.observeHide(id, i);
        return { ok: true };
      }
      case 'unhide': {
        this.leaveHide(m, true);
        return { ok: true };
      }
      case 'climb': {
        const [, li, end] = ref.split(':');
        const l = L.ladders[Number(li)];
        const to = end === 'b' ? l.pa : l.pb;
        m.pub.status = 'climbing';
        m.climb = { until: this.now + 1400, to: [to[0], to[1], to[2]] };
        this.pubChanged(m);
        this.sound('ladder', pos, 1, id);
        this.noise(f, m.x, m.y, m.z, NOISE.ladder * nm, id);
        return { ok: true };
      }
      case 'grate_force': {
        const li = Number(a);
        this.ladders[li] = true;
        this.mechs.gardenGrate = true;
        this.ev({ k: 'ladder', i: li, open: true });
        this.mechChanged();
        this.noise(f, pos[0], pos[1], pos[2], NOISE.grate * nm, id);
        this.sound('grate_open', pos, 1, id);
        this.notify('THE DRAINAGE GRATE IS FORCED OPEN — A SHORTCUT BETWEEN GARDEN AND SEWER', 'good');
        return { ok: true };
      }
      case 'read': {
        const n = L.notes[Number(a)];
        if (!this.journal.includes(n.spec.id)) {
          this.journal.push(n.spec.id);
          this.ev({ k: 'journal', note: n.spec.id, by: id });
        }
        return { ok: true, data: { note: n.spec.id } };
      }
      // ----- Route A: main entrance -----
      case 'front_key':
        this.consumeHeld(m);
        fr.keyLock = true;
        this.mechChanged();
        this.sound('door_unlock', pos, 1, id);
        this.noise(f, pos[0], pos[1], pos[2], 8 * nm, id);
        this.notify('MAIN ENTRANCE: THE OLD KEY LOCK TURNS (1/4)', 'good');
        this.frontProgress();
        return { ok: true };
      case 'front_pick':
        this.consumeHeld(m);
        fr.padlock = true;
        this.mechChanged();
        this.sound('lockpick', pos, 1, id);
        this.notify('MAIN ENTRANCE: THE PADLOCK FALLS AWAY', 'good');
        this.frontProgress();
        return { ok: true };
      case 'front_open': {
        fr.open = true;
        this.mechChanged();
        this.setDoor(this.doorIndex('front_door'), true, false);
        this.sound('front_open', pos, 1, id);
        this.noise(f, pos[0], pos[1], pos[2], 30, id);
        this.alert = 'ESCAPE_IN_PROGRESS';
        this.emitPhase();
        this.ev({ k: 'cue', cue: 'escape_alert', pos });
        this.notify('THE MAIN ENTRANCE IS OPEN — RUN FOR THE GATE', 'good');
        return { ok: true };
      }
      case 'panel':
        return { ok: true, data: { panel: true, symbols: this.puzzles.panelSymbols } };
      case 'winch_fit':
        this.consumeHeld(m);
        fr.handle = true;
        this.mechChanged();
        this.sound('install', pos, 1, id);
        this.noise(f, pos[0], pos[1], pos[2], NOISE.install * nm, id);
        return { ok: true };
      case 'winch_crank':
        fr.bar = true;
        this.mechChanged();
        this.sound('bar_lift', pos, 1, id);
        this.noise(f, pos[0], pos[1], pos[2], NOISE.crank * nm, id);
        this.notify('MAIN ENTRANCE: THE IRON BAR SWINGS UP', 'good');
        this.frontProgress();
        return { ok: true };
      case 'fuse_install':
        this.consumeHeld(m);
        this.mechs.fuse = true;
        this.mechChanged();
        this.sound('fuse', pos, 1, id);
        this.noise(f, pos[0], pos[1], pos[2], NOISE.machine * nm, id);
        this.notify('SECURITY CIRCUIT LIVE — THE PANEL BY THE FRONT DOOR HAS POWER', 'good');
        return { ok: true };
      case 'gen_start':
        this.mechs.generator = { running: true, until: this.now + 90_000 };
        this.mechChanged();
        this.sound('generator', pos, 1, id);
        this.noise(f, pos[0], pos[1], pos[2], NOISE.generator, id);
        this.nextGenNoise = this.now + 4000;
        this.notify('THE GENERATOR COUGHS INTO LIFE — THE BASEMENT LIGHTS FLICKER ON', 'warn');
        return { ok: true };
      // ----- Route B: garage -----
      case 'shutter_bolts':
        this.mechs.shutter.bolts = true;
        this.mechChanged();
        this.sound('crank', pos, 1, id);
        this.notify('SHUTTER BOLTS LOOSENED', 'good');
        return { ok: true };
      case 'shutter_raise':
        this.mechs.shutter.open = true;
        this.mechChanged();
        this.setDoor(this.doorIndex('garage_shutter'), true, false);
        this.sound('shutter', [83, 2, 48], 1, id);
        this.noise(2, 83, 1, 47.5, NOISE.shutter, id);
        this.notify('THE GARAGE SHUTTER RATTLES OPEN', 'good');
        return { ok: true };
      case 'car_hood':
        this.car.hood = !this.car.hood;
        this.carChanged();
        this.sound('drawer_open', pos, 1, id);
        this.noise(f, pos[0], pos[1], pos[2], 6 * nm, id);
        return { ok: true };
      case 'car_battery':
      case 'car_coil':
      case 'car_relay': {
        this.consumeHeld(m);
        if (inter.action === 'car_battery') this.car.battery = true;
        if (inter.action === 'car_coil') this.car.coil = true;
        if (inter.action === 'car_relay') this.car.relay = true;
        this.carChanged();
        this.sound('install', pos, 1, id);
        this.noise(f, pos[0], pos[1], pos[2], NOISE.carRepair * nm, id);
        this.notify(`CAR: ${inter.action === 'car_battery' ? 'BATTERY' : inter.action === 'car_coil' ? 'IGNITION COIL' : 'STARTER RELAY'} INSTALLED`, 'good');
        return { ok: true };
      }
      case 'car_fuel':
        this.consumeHeld(m);
        this.car.fuel = 1;
        this.carChanged();
        this.notify('CAR: TANK FILLED', 'good');
        return { ok: true };
      case 'car_key':
        this.consumeHeld(m);
        this.car.key = true;
        this.carChanged();
        this.sound('install', pos, 0.6, id);
        this.notify('CAR: KEY IN THE IGNITION', 'good');
        return { ok: true };
      case 'car_driver':
      case 'car_passenger': {
        const seat = inter.action === 'car_driver' ? 'driver' : 'passenger';
        if (this.car[seat]) return { ok: false, error: 'Taken.' };
        if (m.pub.held && itemDef(this.items.get(m.pub.held)!.type).heavy) return { ok: false, error: 'Drop it first.' };
        this.car[seat] = id;
        m.pub.status = seat === 'driver' ? 'driving' : 'passenger';
        m.carInput = { throttle: 0, steer: 0 };
        this.syncCarOccupant(m);
        this.carChanged();
        this.pubChanged(m);
        this.sound('door_close', pos, 0.8, id);
        this.noise(f, pos[0], pos[1], pos[2], 7 * nm, id);
        return { ok: true };
      }
      case 'car_exit':
        this.leaveCar(m);
        return { ok: true };
      case 'free_trap': {
        const other = this.mp.get(a);
        if (other) this.releaseTrap(other);
        return { ok: true };
      }
      // ----- Route C: sewer -----
      case 'pump_fuse':
        this.consumeHeld(m);
        this.mechs.pump.fuse = true;
        this.mechChanged();
        this.sound('fuse', pos, 1, id);
        return { ok: true };
      case 'pump_start':
        this.mechs.pump.running = true;
        this.mechs.pump.progress = 0;
        this.mechChanged();
        this.sound('pump', pos, 1, id);
        this.noise(f, pos[0], pos[1], pos[2], NOISE.pump, id);
        this.nextPumpNoise = this.now + 3000;
        this.notify('THE DRAINAGE PUMP SHUDDERS AWAKE — THE CISTERN IS DRAINING', 'good');
        return { ok: true };
      case 'valve_turn': {
        const v = Number(a.slice(-1)) - 1;
        const mf = this.mechs.manifold;
        mf.valves[v] = !mf.valves[v];
        mf.equalized = mf.gauge && pressureOf(this) === this.valveTarget;
        this.mechChanged();
        this.sound('valve', pos, 1, id);
        this.noise(f, pos[0], pos[1], pos[2], 12 * nm, id);
        if (mf.equalized) this.notify('THE GAUGE NEEDLE SETTLES ON THE RED MARK — PRESSURE EQUALISED', 'good');
        return { ok: true };
      }
      case 'manifold_gauge':
      case 'manifold_handle': {
        this.consumeHeld(m);
        const mf = this.mechs.manifold;
        if (inter.action === 'manifold_gauge') mf.gauge = true;
        else mf.handle = true;
        mf.equalized = mf.gauge && pressureOf(this) === this.valveTarget;
        this.mechChanged();
        this.sound('install', pos, 1, id);
        return { ok: true };
      }
      case 'flood_key':
        this.consumeHeld(m);
        this.mechs.floodgate.key = true;
        this.mechChanged();
        this.sound('install', pos, 1, id);
        return { ok: true };
      case 'flood_raise':
        this.mechs.floodgate.open = true;
        this.mechChanged();
        this.setDoor(this.doorIndex('floodgate'), true, false);
        this.sound('floodgate', [11.5, -7, 55.5], 1, id);
        this.noise(0, 11.5, -8, 55.5, NOISE.floodgate, id);
        this.notify('THE FLOODGATE GRINDS UPWARD — THE NORTH CONDUIT IS OPEN', 'good');
        return { ok: true };
      case 'wheel_fit':
        this.consumeHeld(m);
        this.mechs.finalGrate.wheel = true;
        this.mechChanged();
        this.sound('install', pos, 1, id);
        return { ok: true };
      case 'wheel_turn':
        this.mechs.finalGrate.open = true;
        this.mechChanged();
        this.setDoor(this.doorIndex('final_grate'), true, false);
        this.sound('grate_open', [11.5, -7, 5.5], 1, id);
        this.noise(0, 11.5, -8, 5.5, NOISE.grate, id);
        this.alert = 'ESCAPE_IN_PROGRESS';
        this.emitPhase();
        this.notify('THE OUTFALL GRATE SWINGS OPEN — FRESH AIR', 'good');
        return { ok: true };
    }
    void kind;
    return { ok: false, error: 'Nothing happens.' };
  }

  private frontProgress() {
    const fr = this.mechs.front;
    const n = Number(fr.keyLock) + Number(fr.padlock) + Number(fr.maglock) + Number(fr.bar);
    if (n === 4) this.notify('ALL FOUR LOCKS ARE OPEN — THE MAIN ENTRANCE CAN BE OPENED', 'good');
  }

  handleCode(playerId: string, code: string): { ok: boolean; error?: string } {
    const m = this.mp.get(playerId);
    this.stamp();
    if (!m || this.phase !== 'PLAYING') return { ok: false, error: 'Not now.' };
    const inter = resolveInteraction(this, playerId, 'mech:security_panel', this.roomOf(m));
    if (!inter || inter.action !== 'panel') return { ok: false, error: inter?.label ?? 'The panel does not respond.' };
    if (!this.inReach(m, 'mech:security_panel')) return { ok: false, error: 'Too far away.' };
    const fr = this.mechs.front;
    const pos = targetPos(this, 'mech:security_panel')!;
    if (code === this.puzzles.code) {
      fr.maglock = true;
      fr.attempts = 0;
      this.mechChanged();
      this.sound('keypad_ok', pos, 1, playerId);
      this.sound('maglock', [48.5, 1.5, 56], 1, playerId);
      this.noise(2, pos[0], pos[1], pos[2], 10, playerId);
      this.notify('MAIN ENTRANCE: THE ELECTRIC BOLT RELEASES WITH A CLUNK', 'good');
      this.frontProgress();
      return { ok: true };
    }
    fr.attempts++;
    this.sound('keypad_bad', pos, 1, playerId);
    if (fr.attempts >= 3) {
      fr.attempts = 0;
      fr.lockedUntil = this.now + 20_000;
      this.sound('alarm', pos, 1, playerId);
      this.noise(2, pos[0], pos[1], pos[2], NOISE.alarm, playerId);
      this.notify('THE ALARM SHRIEKS THROUGH THE HOUSE', 'bad');
    }
    this.mechChanged();
    return { ok: false, error: `WRONG CODE${fr.attempts ? ` (${3 - fr.attempts} LEFT BEFORE THE ALARM)` : ''}` };
  }

  handleInspect(playerId: string): { ok: boolean; data?: unknown } {
    const m = this.mp.get(playerId);
    if (!m || !m.pub.held) return { ok: false };
    const it = this.items.get(m.pub.held)!;
    if (it.type === 'cipher_plate') return { ok: true, data: { cipher: this.puzzles.cipher } };
    return { ok: true, data: {} };
  }

  handleDrop(playerId: string): { ok: boolean; error?: string } {
    const m = this.mp.get(playerId);
    this.stamp();
    if (!m || !m.pub.held || this.phase !== 'PLAYING') return { ok: false };
    if (m.pub.status !== 'free') return { ok: false, error: 'Not now.' };
    this.dropHeld(m, true);
    return { ok: true };
  }

  /** Drops the held item in front of the player (or at their feet) at a reachable spot. */
  private dropHeld(m: MPlayer, makeNoise: boolean) {
    const id = m.pub.held;
    if (!id) return;
    const it = this.items.get(id)!;
    const def = itemDef(it.type);
    const fw = forwardFromYaw(m.yaw);
    let p = { x: m.x + fw.x * 0.6, y: m.y, z: m.z + fw.z * 0.6 };
    const stand = nearestStandable(this.level, this.dyn, p.x, m.y, p.z);
    const okFront =
      Math.abs(stand.y - m.y) < 0.7 &&
      Math.hypot(stand.x - m.x, stand.z - m.z) < 1.6 &&
      lineOfSight(this.level, this.dyn, m.x, m.y + 0.5, m.z, stand.x, stand.y + 0.3, stand.z);
    p = okFront ? stand : nearestStandable(this.level, this.dyn, m.x, m.y, m.z);
    it.place = 'world';
    it.holder = null;
    it.container = -1;
    it.pos = [p.x, p.y, p.z];
    m.pub.held = null;
    this.ev({ k: 'item', s: { ...it } });
    this.pubChanged(m);
    if (makeNoise) {
      const n = dropNoise(def.material) * this.tuning.interactionNoiseMult;
      this.noise(floorOfY(p.y), p.x, p.y, p.z, n, m.pub.id);
      this.sound('drop', it.pos, n / 20, m.pub.id);
    }
  }

  handleUse(playerId: string, yaw: number, pitch: number): { ok: boolean; error?: string } {
    const m = this.mp.get(playerId);
    this.stamp();
    if (!m || this.phase !== 'PLAYING') return { ok: false };
    if (m.pub.status === 'driving') return this.startCar(m);
    if (m.pub.status !== 'free' || !m.pub.held) return { ok: false };
    const it = this.items.get(m.pub.held)!;
    const def = itemDef(it.type);
    const ey = this.eye(m);
    const fw = forwardFromYaw(yaw);
    const cp = Math.cos(pitch);
    switch (def.use) {
      case 'throw': {
        const hit = castRay(this.level, this.dyn, m.x, ey, m.z, fw.x * cp, Math.sin(pitch) + 0.08, fw.z * cp, 14);
        this.consumeHeld(m);
        const to: [number, number, number] = [hit.x, hit.y, hit.z];
        this.ev({ k: 'throw', from: [m.x, ey, m.z], to, item: it.id });
        this.sound('glass_break', to, 1, playerId);
        this.noise(floorOfY(hit.y + 0.2), hit.x, hit.y, hit.z, NOISE.glassBreak, null);
        return { ok: true };
      }
      case 'decoy': {
        const p = nearestStandable(this.level, this.dyn, m.x + fw.x * 0.6, m.y, m.z + fw.z * 0.6);
        it.place = 'world';
        it.holder = null;
        it.container = -1;
        it.pos = [p.x, p.y, p.z];
        m.pub.held = null;
        this.ev({ k: 'item', s: { ...it } });
        this.pubChanged(m);
        this.decoys.push({ id: it.id, x: p.x, y: p.y, z: p.z, start: this.now + 2000, end: this.now + 9000, next: this.now + 2000 });
        this.notify('THE DECOY IS WOUND — IT WILL START RATTLING', 'info', playerId);
        return { ok: true };
      }
      case 'flash': {
        if (it.charges <= 0) return { ok: false, error: 'No flash bulbs left.' };
        it.charges--;
        this.ev({ k: 'flash', pos: [m.x, ey, m.z], by: playerId });
        this.ev({ k: 'item', s: { ...it } });
        this.noise(floorOfY(m.y), m.x, m.y, m.z, 6, playerId);
        const e = this.enemy;
        const dx = e.x - m.x;
        const dz = e.z - m.z;
        const d = Math.hypot(dx, dz);
        const toE = Math.atan2(-dx, -dz);
        let ang = Math.abs(toE - yaw) % (Math.PI * 2);
        if (ang > Math.PI) ang = Math.PI * 2 - ang;
        const facing = forwardFromYaw(e.yaw);
        const facesPlayer = (facing.x * -dx + facing.z * -dz) / Math.max(d, 0.01) > 0.1;
        if (d < 9 && ang < 0.55 && facesPlayer && lineOfSight(this.level, this.dyn, m.x, ey, m.z, e.x, e.y + 1.6, e.z)) {
          e.stun(5.5);
          this.notify('HE REELS FROM THE FLASH — GO!', 'good');
        }
        if (it.charges <= 0) {
          this.consumeHeld(m);
          this.notify('THE LAST BULB IS SPENT', 'warn', playerId);
        }
        return { ok: true };
      }
    }
    return { ok: false };
  }

  private startCar(m: MPlayer): { ok: boolean; error?: string } {
    const c = this.car;
    if (c.running) return { ok: false };
    const pos: [number, number, number] = [c.x, 1, c.z];
    const missing = [!c.battery && 'BATTERY', !c.coil && 'IGNITION COIL', !c.relay && 'STARTER RELAY', c.fuel < 1 && 'FUEL', !c.key && 'IGNITION KEY'].filter(Boolean) as string[];
    if (missing.length) {
      this.sound('car_fail', pos, 1, m.pub.id);
      this.noise(2, c.x, 0.5, c.z, c.battery ? 22 : 5, m.pub.id);
      const hint = this.tuning.hintLevel >= 1 ? ` — MISSING: ${missing.join(', ')}` : '';
      this.notify(`THE ENGINE WON'T CATCH${hint}`, 'warn', m.pub.id);
      return { ok: false, error: 'It will not start.' };
    }
    c.running = true;
    this.carChanged();
    this.sound('car_start', pos, 1, m.pub.id);
    this.noise(2, c.x, 0.5, c.z, NOISE.carStart, m.pub.id);
    this.nextEngineNoise = this.now + 1500;
    this.alert = 'ESCAPE_IN_PROGRESS';
    this.emitPhase();
    this.ev({ k: 'cue', cue: 'escape_alert', pos });
    this.notify('THE ENGINE ROARS — HE HEARD THAT. DRIVE!', 'good');
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers for status changes
  // ---------------------------------------------------------------------------

  private leaveHide(m: MPlayer, sound: boolean) {
    const i = m.pub.hide;
    if (i < 0) return;
    const h = this.level.hides[i];
    this.hides[i] = null;
    m.pub.hide = -1;
    m.pub.status = 'free';
    m.holdingBreath = false;
    const exit = nearestStandable(this.level, this.dyn, h.exit[0], h.exit[1], h.exit[2]);
    this.teleport(m, [exit.x, exit.y, exit.z], h.yaw);
    this.ev({ k: 'hide', i, occupant: null });
    this.pubChanged(m);
    if (sound) {
      this.sound('hide_out', [h.inside[0], h.inside[1] + 1, h.inside[2]], 0.8, m.pub.id);
      this.noise(h.f, exit.x, exit.y, exit.z, 4, m.pub.id);
    }
  }

  private syncCarOccupant(m: MPlayer) {
    const c = this.car;
    const fw = forwardFromYaw(c.yaw);
    const side = m.pub.status === 'driving' ? -0.4 : 0.4;
    m.x = c.x + -fw.z * side;
    m.z = c.z + fw.x * side;
    m.y = 0;
  }

  private leaveCar(m: MPlayer) {
    const c = this.car;
    const seat = c.driver === m.pub.id ? 'driver' : c.passenger === m.pub.id ? 'passenger' : null;
    if (!seat) return;
    c[seat] = null;
    m.pub.status = 'free';
    m.carInput = { throttle: 0, steer: 0 };
    const fw = forwardFromYaw(c.yaw);
    const side = seat === 'driver' ? -1.7 : 1.7;
    const want = { x: c.x + -fw.z * side, z: c.z + fw.x * side };
    const p = nearestStandable(this.level, this.dyn, want.x, 0, want.z);
    this.teleport(m, [p.x, p.y, p.z], c.yaw);
    this.carChanged();
    this.pubChanged(m);
  }

  private carChanged() {
    this.ev({ k: 'car', s: { ...this.car } });
  }

  private openCage(by: MPlayer) {
    const ci = this.level.cageDoor;
    this.setDoor(ci, true, false);
    const c = this.level.doors[ci].center;
    this.sound('cage_open', [c[0], c[1] + 1, c[2]], 1, by.pub.id);
    this.noise(1, c[0], c[1], c[2], NOISE.cageRattle * 1.5, by.pub.id);
    for (const m of this.mp.values()) {
      if (m.pub.status !== 'caged') continue;
      m.pub.status = 'free';
      m.graceUntil = this.now + 4000;
      this.pubChanged(m);
      this.notify(by === m ? `${m.pub.name.toUpperCase()} WORKED THE LATCH LOOSE` : `${m.pub.name.toUpperCase()} WAS RESCUED BY ${by.pub.name.toUpperCase()}`, 'good');
    }
    if (![...this.mp.values()].some((m) => m.pub.status === 'captured')) {
      this.alert = this.mechs.front.open || this.car.running || this.mechs.finalGrate.open ? 'ESCAPE_IN_PROGRESS' : 'NONE';
      this.emitPhase();
    }
  }

  private releaseTrap(m: MPlayer) {
    const ti = m.trapIndex;
    if (ti >= 0) {
      const t = this.traps[ti];
      t.victim = null;
      this.ev({ k: 'trap', i: ti, s: this.trapPub(ti) });
    }
    m.trapIndex = -1;
    m.trappedUntil = 0;
    if (m.pub.status === 'trapped') {
      m.pub.status = 'free';
      this.pubChanged(m);
    }
  }

  private trapPub(i: number): TrapState {
    const { rearmAt: _r, ...t } = this.traps[i];
    return { ...t };
  }

  private checkTrapStep(m: MPlayer) {
    const f = floorOfY(m.y);
    const cx = Math.floor(m.x);
    const cz = Math.floor(m.z);
    for (let i = 0; i < this.traps.length; i++) {
      const t = this.traps[i];
      if (!t.armed || t.f !== f || t.x !== cx || t.z !== cz) continue;
      // traps are visible; a crouched, careful player steps over cans and bells
      if (t.kind !== 'snare' && m.flags & PF.CROUCH && Math.hypot(m.vx, m.vz) < 1.8) continue;
      t.armed = false;
      t.rearmAt = this.now + 45_000;
      const pos: [number, number, number] = [m.x, m.y + 0.2, m.z];
      if (t.kind === 'snare') {
        t.victim = m.pub.id;
        m.pub.status = 'trapped';
        m.trapIndex = i;
        m.trappedUntil = this.now + this.tuning.trapHoldSeconds * 1000;
        this.cancelHold(m);
        this.pubChanged(m);
        this.sound('trap_snare', pos, 1, m.pub.id);
        this.noise(f, m.x, m.y, m.z, NOISE.trapSnare, m.pub.id);
        this.notify(`${m.pub.name.toUpperCase()} IS CAUGHT IN A SNARE`, 'bad');
      } else {
        this.sound(t.kind === 'cans' ? 'trap_cans' : 'trap_bell', pos, 1, m.pub.id);
        this.noise(f, m.x, m.y, m.z, t.kind === 'cans' ? NOISE.trapCans : NOISE.trapBell, m.pub.id);
      }
      this.ev({ k: 'trap', i, s: this.trapPub(i) });
    }
  }

  // ---------------------------------------------------------------------------
  // Per-tick systems
  // ---------------------------------------------------------------------------

  private tickPlayers(dt: number) {
    const now = this.now;
    for (const m of this.mp.values()) {
      const st = m.pub.status;
      // disconnect grace expiry
      if (m.disconnectedAt !== null && now - m.disconnectedAt > RECONNECT_GRACE_MS && st !== 'escaped' && st !== 'eliminated') {
        m.pub.status = 'eliminated';
        this.pubChanged(m);
        this.notify(`${m.pub.name.toUpperCase()} LOST CONNECTION`, 'warn');
        this.enemy.forget(m.pub.id);
        continue;
      }
      if (m.hold) {
        const h = m.hold;
        const inter = resolveInteraction(this, m.pub.id, h.ref, this.roomOf(m));
        if (!inter || inter.action !== h.action || !inter.enabled || !this.inReach(m, h.ref) || (m.pub.status !== 'free' && m.pub.status !== 'caged')) {
          this.cancelHold(m);
        } else if (now - h.start >= h.dur) {
          m.hold = null;
          m.flags &= ~PF.INTERACTING;
          const res = this.execute(m, inter);
          this.ev({ k: 'holdEnd', player: m.pub.id, ok: res.ok });
        } else if (now >= h.nextNoise) {
          const hn = HOLD_NOISE[h.action];
          if (hn) {
            const pos = this.refPos(h.ref) ?? [m.x, m.y, m.z];
            this.noise(floorOfY(m.y), pos[0], pos[1], pos[2], hn[0] * this.tuning.interactionNoiseMult, m.pub.id);
            h.nextNoise = now + hn[1] * 1000;
          } else h.nextNoise = now + 10_000;
        }
      }
      if (st === 'climbing' && m.climb && now >= m.climb.until) {
        const to = m.climb.to;
        m.climb = null;
        m.pub.status = 'free';
        this.teleport(m, to, m.yaw);
        this.pubChanged(m);
      }
      if (st === 'trapped' && now >= m.trappedUntil) this.releaseTrap(m);
      if (st === 'captured' && now >= m.captureEndsAt) {
        if (m.pub.captures >= this.tuning.captureLimit) {
          m.pub.status = 'eliminated';
          this.pubChanged(m);
          this.notify(`${m.pub.name.toUpperCase()} IS GONE. THE HOUSE KEEPS THEM.`, 'bad');
        } else {
          this.cagePlayer(m);
        }
        if (![...this.mp.values()].some((o) => o.pub.status === 'captured')) {
          this.alert = 'NONE';
          this.emitPhase();
        }
      }
      if (st === 'hidden') {
        if (m.holdingBreath) {
          m.breath -= dt;
          if (m.breath <= 0) {
            m.breath = 0;
            m.holdingBreath = false;
            this.sound('gasp', [m.x, m.y + 1, m.z], 1, m.pub.id);
            this.noise(floorOfY(m.y), m.x, m.y, m.z, NOISE.gasp, m.pub.id, true);
          }
        } else {
          m.breath = Math.min(8, m.breath + dt * 0.6);
          if (now >= m.nextBreathNoise) {
            m.nextBreathNoise = now + 1300;
            if (now - m.lastSprintAt < 8000) this.noise(floorOfY(m.y), m.x, m.y, m.z, NOISE.breathing, m.pub.id, true);
          }
        }
      }
      if (m.pub.battery > 0 && m.flags & PF.FLASH && st !== 'hidden') {
        const before = m.pub.battery;
        m.pub.battery = Math.max(0, m.pub.battery - dt / 420);
        // only publish battery in coarse steps
        if (Math.floor(before * 20) !== Math.floor(m.pub.battery * 20)) this.pubChanged(m);
      }
    }
  }

  private cagePlayer(m: MPlayer) {
    const cells = this.level.cageCells;
    const occupied = [...this.mp.values()].filter((o) => o !== m && o.pub.status === 'caged');
    const free = cells.find((c) => !occupied.some((o) => Math.floor(o.x) === c.x && Math.floor(o.z) === c.z)) ?? cells[0];
    const ci = this.level.cageDoor;
    this.setDoor(ci, false, true);
    m.pub.status = 'caged';
    m.pub.cagedAt = this.now;
    this.teleport(m, [free.x + 0.5, -4, free.z + 0.5], Math.PI / 2);
    this.pubChanged(m);
    const c = this.level.doors[ci].center;
    this.sound('cage_close', [c[0], c[1] + 1, c[2]], 1);
    const sr = this.tuning.selfReleaseSeconds;
    this.notify(
      sr === null
        ? `${m.pub.name.toUpperCase()} IS LOCKED IN THE BASEMENT CAGE — ONLY A TEAMMATE CAN OPEN IT`
        : `${m.pub.name.toUpperCase()} WAKES IN THE BASEMENT CAGE (${this.tuning.captureLimit - m.pub.captures} CHANCES LEFT)`,
      'warn',
    );
  }

  private tickMechs(dt: number) {
    const now = this.now;
    const g = this.mechs.generator;
    if (g.running) {
      if (now >= g.until) {
        g.running = false;
        this.mechChanged();
        this.notify('THE GENERATOR SPUTTERS OUT', 'info');
      } else if (now >= this.nextGenNoise) {
        this.nextGenNoise = now + 4000;
        const p = targetPos(this, 'mech:generator')!;
        this.noise(1, p[0], p[1], p[2], 30, null);
      }
    }
    const p = this.mechs.pump;
    if (p.running && !p.drained) {
      p.progress = Math.min(1, p.progress + dt / 25);
      this.water[0].level = 1 - p.progress;
      if (now >= this.nextPumpNoise) {
        this.nextPumpNoise = now + 3000;
        const pp = targetPos(this, 'mech:pump_panel')!;
        this.noise(0, pp[0], pp[1], pp[2], 24, null);
        this.ev({ k: 'water', i: 0, drained: false, level: this.water[0].level });
        this.mechChanged();
      }
      if (p.progress >= 1) {
        p.drained = true;
        p.running = false;
        this.water[0] = { drained: true, level: 0 };
        this.ev({ k: 'water', i: 0, drained: true, level: 0 });
        this.mechChanged();
        this.notify('THE CISTERN IS DRAINED — THE WAY WEST IS CLEAR', 'good');
      }
    }
    for (const d of this.decoys) {
      if (now >= d.next && now < d.end) {
        d.next = now + 700;
        this.noise(floorOfY(d.y), d.x, d.y, d.z, NOISE.decoy, null);
        this.sound('decoy', [d.x, d.y + 0.2, d.z], 1);
      }
    }
    const done = this.decoys.filter((d) => now >= d.end);
    for (const d of done) {
      const it = this.items.get(d.id);
      if (it && it.place === 'world') {
        it.place = 'used';
        this.ev({ k: 'item', s: { ...it } });
      }
    }
    this.decoys = this.decoys.filter((d) => now < d.end);
  }

  private tickCar(dt: number) {
    const c = this.car;
    if (c.escaped) return;
    const driver = c.driver ? this.mp.get(c.driver) : null;
    const e = this.enemy;
    const enemyCircle = Math.abs(e.y) < 1.5 ? { x: e.x, z: e.z, r: ENEMY_RADIUS + 0.1 } : null;
    const hit = stepCar(this.level, this.dyn, c, driver?.carInput ?? { throttle: 0, steer: 0 }, dt, enemyCircle);
    if (hit) {
      if (hit.kind === 'gate' && Math.abs(hit.speed) >= 3 && !this.mechs.driveGate) {
        this.mechs.driveGate = true;
        this.setDoor(this.doorIndex('drive_gate'), true, false);
        this.mechChanged();
        this.sound('gate_crash', [c.x, 1, c.z + 2], 1);
        this.noise(2, c.x, 0.5, c.z, 45, null);
        c.speed = hit.speed * 0.55;
        this.notify('THE CAR SMASHES THROUGH THE CHAINED GATE', 'good');
      } else if (hit.kind === 'enemy' && Math.abs(hit.speed) > 3.5) {
        const fw = forwardFromYaw(c.yaw);
        e.pushAway(fw.x * 1.2 + -fw.z * 0.8, fw.z * 1.2 + fw.x * 0.8);
        e.stun(4);
        this.notify('THE CAR SLAMS INTO HIM', 'good');
      } else if (Math.abs(hit.speed) > 4) {
        this.noise(2, c.x, 0.5, c.z, 26, null);
        this.sound('drop', [c.x, 0.8, c.z], 1.5);
      }
    }
    for (const id of [c.driver, c.passenger]) {
      const m = id ? this.mp.get(id) : null;
      if (m) this.syncCarOccupant(m);
    }
    if (c.running && this.now >= this.nextEngineNoise) {
      this.nextEngineNoise = this.now + 1500;
      this.noise(2, c.x, 0.5, c.z, NOISE.carEngine, null);
    }
    if (this.now - this.carSentAt > 1000 && (c.running || Math.abs(c.speed) > 0.01)) {
      this.carSentAt = this.now;
      this.carChanged();
    }
    if (c.z > 81.6) {
      c.escaped = true;
      c.speed = 0;
      this.carChanged();
      for (const id of [c.driver, c.passenger]) {
        const m = id ? this.mp.get(id) : null;
        if (m) this.escape(m, 'garage');
      }
    }
  }

  private tickTraps() {
    for (let i = 0; i < this.traps.length; i++) {
      const t = this.traps[i];
      if (t.armed || t.victim || this.now < t.rearmAt) continue;
      const occupied = [...this.mp.values()].some((m) => floorOfY(m.y) === t.f && Math.floor(m.x) === t.x && Math.floor(m.z) === t.z);
      if (occupied) continue;
      t.armed = true;
      this.ev({ k: 'trap', i, s: this.trapPub(i) });
    }
  }

  private escape(m: MPlayer, route: EscapeRoute) {
    if (m.pub.status === 'escaped') return;
    if (m.pub.status === 'hidden') this.leaveHide(m, false);
    this.cancelHold(m);
    if (m.pub.held) this.dropHeld(m, false);
    m.pub.status = 'escaped';
    m.pub.escapedVia = route;
    this.pubChanged(m);
    this.ev({ k: 'escape', player: m.pub.id, route });
    const how = route === 'front' ? 'THROUGH THE MAIN ENTRANCE' : route === 'garage' ? 'IN THE CAR' : 'THROUGH THE SEWERS';
    this.notify(`${m.pub.name.toUpperCase()} ESCAPED ${how}`, 'good');
    this.enemy.forget(m.pub.id);
  }

  private checkEscapes() {
    for (const m of this.mp.values()) {
      if (m.pub.status !== 'free') continue;
      const f = floorOfY(m.y);
      if (f === 2 && m.z > 80.6) this.escape(m, m.x < 70 ? 'front' : 'garage');
      else if (f === 0 && m.z < 3.6) this.escape(m, 'sewer');
    }
  }

  private checkEnd() {
    if (this.ended) return;
    const all = [...this.mp.values()];
    const escaped = all.filter((m) => m.pub.status === 'escaped');
    const active = all.filter((m) => m.pub.status !== 'escaped' && m.pub.status !== 'eliminated');
    const hopeless = active.length > 0 && active.every((m) => m.pub.status === 'caged' || m.pub.status === 'captured') && this.tuning.selfReleaseSeconds === null;
    const settled = active.every((m) => m.pub.status !== 'captured');
    if (active.length === 0 || (hopeless && settled)) {
      const result: MatchResult = escaped.length === 0 ? 'GAME_OVER' : escaped.length === all.filter((m) => m.disconnectedAt === null || m.pub.status === 'escaped').length ? 'TEAM_VICTORY' : 'PARTIAL_ESCAPE';
      this.end(result);
    }
  }

  private end(result: MatchResult) {
    if (this.ended) return;
    this.ended = true;
    this.endedAt = this.now;
    this.result = result;
    this.phase = 'ENDED';
    this.alert = 'NONE';
    this.emitPhase();
    log.info('match ended', { result, seed: this.seed });
    this.sink.onEnded(result);
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  handleDisconnect(playerId: string) {
    const m = this.mp.get(playerId);
    if (!m) return;
    this.stamp();
    m.disconnectedAt = this.now;
    m.pub.connected = false;
    this.cancelHold(m);
    // never let a disconnected player lock away a critical item
    if (m.pub.status === 'hidden') this.leaveHide(m, false);
    if (m.pub.status === 'driving' || m.pub.status === 'passenger') this.leaveCar(m);
    if (m.pub.status === 'climbing' && m.climb) {
      const to = m.climb.to;
      m.climb = null;
      m.pub.status = 'free';
      this.teleport(m, to, m.yaw);
    }
    if (m.pub.held) this.dropHeld(m, false);
    this.pubChanged(m);
    this.notify(`${m.pub.name.toUpperCase()} DISCONNECTED`, 'warn');
  }

  handleReconnect(playerId: string) {
    const m = this.mp.get(playerId);
    if (!m) return;
    m.disconnectedAt = null;
    m.pub.connected = true;
    m.lastMoveAt = Date.now();
    this.pubChanged(m);
    this.notify(`${m.pub.name.toUpperCase()} RECONNECTED`, 'info');
  }

  /** Player left the session for good (left the lobby mid-game). */
  removePlayer(playerId: string) {
    const m = this.mp.get(playerId);
    if (!m) return;
    this.handleDisconnect(playerId);
    if (m.pub.status !== 'escaped') m.pub.status = 'eliminated';
    this.pubChanged(m);
    this.enemy.forget(playerId);
  }

  hasPlayer(id: string) {
    return this.mp.has(id);
  }

  // ---------------------------------------------------------------------------
  // Test helpers (used by the automated route tests; never reachable from clients)
  // ---------------------------------------------------------------------------

  testPlace(playerId: string, x: number, y: number, z: number, yaw = 0) {
    const m = this.mp.get(playerId)!;
    m.x = x;
    m.y = y;
    m.z = z;
    m.yaw = yaw;
    m.pitch = 0;
    m.lastMoveAt = Date.now();
  }

  testGive(playerId: string, itemId: string) {
    const m = this.mp.get(playerId)!;
    const it = this.items.get(itemId)!;
    if (m.pub.held) this.consumeHeld(m);
    it.place = 'held';
    it.holder = playerId;
    it.container = -1;
    m.pub.held = itemId;
  }

  testPlayer(playerId: string) {
    return this.mp.get(playerId)!;
  }

  testPuzzles() {
    return this.puzzles;
  }

  testSetPhasePlaying() {
    this.phase = 'PLAYING';
    this.phaseEndsAt = 0;
    this.manualClock = true;
    this.lastTick = this.now;
  }

  testFreezeEnemy() {
    this.enemy.freeze();
  }

  testWakeEnemy(x: number, y: number, z: number) {
    this.enemy.wake(x, y, z);
  }

  /** Item lookup for tests and the drop-safety check. */
  itemDefOf(id: string) {
    return ITEM_BY_TYPE.get(this.items.get(id)!.type)!;
  }

  carCircles() {
    const fw = forwardFromYaw(this.car.yaw);
    return CAR_CIRCLES.map((o) => ({ x: this.car.x + fw.x * o, z: this.car.z + fw.z * o, r: CAR_RADIUS }));
  }

  get captureRange() {
    return CAPTURE_RANGE;
  }
}

function r2(v: number) {
  return Math.round(v * 100) / 100;
}
