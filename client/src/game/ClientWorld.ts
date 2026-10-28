/**
 * Client mirror of the authoritative match state. Implements the shared WorldView so prompts
 * use the exact same rules as the server. Snapshots are buffered and interpolated ~110ms in
 * the past for smooth remote players, the enemy and the car.
 */
import {
  INTERP_DELAY_MS,
  getLevel,
  type CarState,
  type DoorState,
  type GameEvent,
  type ItemState,
  type Level,
  type MatchAlert,
  type MatchInit,
  type MatchPhase,
  type MatchResult,
  type MechStates,
  type PlayerPublic,
  type Snapshot,
  type TrapState,
  type WorldView,
} from '@nower/shared';

export interface Interp {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class ClientWorld implements WorldView {
  readonly level: Level = getLevel();
  difficulty: MatchInit['difficulty'];
  now = 0;
  doors: DoorState[];
  items = new Map<string, ItemState>();
  containers: boolean[];
  hides: (string | null)[];
  ladders: boolean[];
  water: { drained: boolean; level: number }[];
  mechs: MechStates;
  car: CarState;
  traps: TrapState[];
  players = new Map<string, PlayerPublic>();
  valveWeights: number[];
  valveTarget: number;
  panelSymbols: string[];
  journal: string[];
  phase: MatchPhase;
  phaseEndsAt: number;
  alert: MatchAlert;
  result: MatchResult | null;
  you: string;
  seed: number;
  /** server clock = client clock + offset */
  private offset: number;
  private snaps: Snapshot[] = [];
  readonly dyn = { doorOpen: (i: number) => this.doors[i].open, waterDrained: (i: number) => this.water[i].drained };

  constructor(init: MatchInit) {
    this.you = init.you;
    this.seed = init.seed;
    this.difficulty = init.difficulty;
    this.offset = init.serverTime - Date.now();
    this.doors = init.doors;
    for (const it of init.items) this.items.set(it.id, it);
    this.containers = init.containers;
    this.hides = init.hides;
    this.ladders = init.ladders;
    this.water = init.water;
    this.mechs = init.mechs;
    this.car = init.car;
    this.traps = init.traps;
    for (const p of init.players) this.players.set(p.id, p);
    this.valveWeights = init.valveWeights;
    this.valveTarget = init.valveTarget;
    this.panelSymbols = init.panelSymbols;
    this.journal = init.journal;
    this.phase = init.phase;
    this.phaseEndsAt = init.phaseEndsAt;
    this.alert = init.alert;
    this.result = init.result;
    this.snaps.push(init.snapshot);
    this.now = this.serverNow();
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  pushSnapshot(s: Snapshot) {
    // adapt clock offset slowly towards the freshest estimate (snapshots arrive with latency)
    const est = s.t - Date.now();
    this.offset = est > this.offset ? est : this.offset * 0.98 + est * 0.02;
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
  }

  get latest(): Snapshot {
    return this.snaps[this.snaps.length - 1];
  }

  /** Two snapshots around the render time and the blend factor. */
  private bracket(): [Snapshot, Snapshot, number] {
    const rt = this.serverNow() - INTERP_DELAY_MS;
    const s = this.snaps;
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= rt) {
        const a = s[i - 1];
        const b = s[i];
        const t = b.t === a.t ? 1 : Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t)));
        return [a, b, t];
      }
    }
    return [s[0], s[0], 0];
  }

  interpPlayer(id: string): Interp | null {
    const [a, b, t] = this.bracket();
    const pb = b.p.find((p) => p[0] === id);
    const pa = a.p.find((p) => p[0] === id) ?? pb;
    if (!pa || !pb) return null;
    const jump = Math.hypot(pb[1] - pa[1], pb[3] - pa[3]) > 3;
    const k = jump ? 1 : t;
    return {
      x: pa[1] + (pb[1] - pa[1]) * k,
      y: pa[2] + (pb[2] - pa[2]) * k,
      z: pa[3] + (pb[3] - pa[3]) * k,
      yaw: lerpAngle(pa[4], pb[4], k),
      pitch: pa[5] + (pb[5] - pa[5]) * k,
      flags: pb[6],
    };
  }

  interpEnemy() {
    const [a, b, t] = this.bracket();
    const ea = a.e;
    const eb = b.e;
    const jump = Math.hypot(eb[0] - ea[0], eb[2] - ea[2]) > 4;
    const k = jump ? 1 : t;
    return {
      x: ea[0] + (eb[0] - ea[0]) * k,
      y: ea[1] + (eb[1] - ea[1]) * k,
      z: ea[2] + (eb[2] - ea[2]) * k,
      yaw: lerpAngle(ea[3], eb[3], k),
      state: eb[4],
      anim: eb[5],
      speed: eb[6],
      target: eb[7],
    };
  }

  interpCar() {
    const [a, b, t] = this.bracket();
    const ca = a.c;
    const cb = b.c;
    return { x: ca[0] + (cb[0] - ca[0]) * t, z: ca[1] + (cb[1] - ca[1]) * t, yaw: lerpAngle(ca[2], cb[2], t), speed: cb[3], steer: cb[4] };
  }

  /** Applies a replicated event; returns true when it changed visible state. */
  apply(e: GameEvent) {
    switch (e.k) {
      case 'door':
        this.doors[e.i] = { open: e.open, locked: e.locked };
        break;
      case 'item':
        this.items.set(e.s.id, e.s);
        break;
      case 'container':
        this.containers[e.i] = e.open;
        break;
      case 'hide':
        this.hides[e.i] = e.occupant;
        break;
      case 'ladder':
        this.ladders[e.i] = e.open;
        break;
      case 'water':
        this.water[e.i] = { drained: e.drained, level: e.level };
        break;
      case 'mechs':
        this.mechs = e.s;
        break;
      case 'car':
        this.car = e.s;
        break;
      case 'trap':
        this.traps[e.i] = e.s;
        break;
      case 'player':
        this.players.set(e.s.id, e.s);
        break;
      case 'journal':
        if (!this.journal.includes(e.note)) this.journal.push(e.note);
        break;
      case 'phase':
        this.phase = e.phase;
        this.alert = e.alert;
        this.result = e.result;
        this.phaseEndsAt = e.endsAt;
        break;
    }
  }

  get me(): PlayerPublic {
    return this.players.get(this.you)!;
  }
}
