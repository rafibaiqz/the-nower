/**
 * THE NOWER — authoritative enemy AI (finite state machine).
 *
 * States: DORMANT → PATROL ⇄ INVESTIGATE_SOUND / INVESTIGATE_VISUAL → SEARCH_AREA →
 * SEARCH_HIDING_SPOT, CHASE → ATTACK_OR_CAPTURE, TEMPORARILY_DISABLED, RETURN_TO_PATROL.
 *
 * Perception is never omniscient:
 *  - Vision: field of view, range scaled by room lighting / crouching / flashlight, and a 3D
 *    line-of-sight test through the cell grid. Sightings build an awareness meter per player;
 *    a full meter starts a chase.
 *  - Hearing: the match forwards every noise event. Loudness is attenuated by a propagation
 *    field (walls, doors, floors) computed from the Nower's position. He walks to an
 *    *estimated* source position whose error grows with distance.
 * Movement uses grid A* and the same collision as players. He opens doors (with delay and
 * sound), climbs ladders, and never jumps directly to a player.
 */
import {
  CAPTURE_RANGE,
  ENEMY_EYE,
  ENEMY_RADIUS,
  Navigator,
  SoundField,
  angleDiff,
  audibility,
  floorOfY,
  forwardFromYaw,
  lineOfSight,
  moveBody,
  yawToward,
  type CircleObstacle,
  type DifficultyTuning,
  type DynWorld,
  type EnemyAnim,
  type EnemyState,
  type Level,
  type NavPoint,
  type NavWorld,
  type Rng,
} from '@nower/shared';

export interface AIPlayer {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  status: string;
  crouch: boolean;
  flash: boolean;
  hide: number;
  graceUntil: number;
  inCar: boolean;
  carSpeed: number;
}

export interface EnemyHost {
  level: Level;
  tuning: DifficultyTuning;
  dyn: DynWorld;
  nav: NavWorld;
  rng: Rng;
  aiPlayers(): AIPlayer[];
  hideOccupant(hide: number): string | null;
  enemyOpenDoor(door: number, locked: boolean): void;
  enemyCloseDoor(door: number): void;
  isDoorOpen(door: number): boolean;
  isDoorLocked(door: number): boolean;
  capture(playerId: string): void;
  cue(cue: 'heard' | 'spotted' | 'lost' | 'search' | 'capture' | 'stunned' | 'chase_end', target?: string, pos?: [number, number, number]): void;
  carObstacle(): CircleObstacle | null;
  /** Extra patrol interest (escape mechanisms in progress, caged players, recent noise). */
  patrolInterest(): { f: number; x: number; z: number; w: number }[];
  roomBright(f: number, x: number, z: number): number;
}

interface Goal {
  f: number;
  x: number;
  z: number;
}

const PERCEPTION_INTERVAL = 0.1;

export class EnemyAI {
  x: number;
  y: number;
  z: number;
  yaw = 0;
  speed = 0;
  state: EnemyState = 'DORMANT';
  anim: EnemyAnim = 'idle';
  target: string | null = null;

  private nav: Navigator;
  private field: SoundField;
  private fieldCell = -1;
  private fieldAt = 0;
  private path: NavPoint[] | null = null;
  private pathIdx = 0;
  private goal: Goal | null = null;
  private stateAt = 0;
  private now = 0;
  private activeAt: number;
  private pause = 0; // seconds of standing still (looking, listening, opening)
  private pauseAnim: EnemyAnim = 'idle';
  private onPauseEnd: (() => void) | null = null;
  private awareness = new Map<string, number>();
  private visible = new Set<string>();
  private lastKnown: { f: number; x: number; y: number; z: number; vx: number; vz: number; t: number } | null = null;
  private lostSightAt = 0;
  private investigate: { goal: Goal; interest: number; at: number } | null = null;
  private searchCenter: Goal | null = null;
  private searchUntil = 0;
  private searchQueue: ({ kind: 'point'; goal: Goal } | { kind: 'hide'; hide: number })[] = [];
  private hideTarget = -1;
  private witnessed = new Map<number, string>(); // hide spot -> player seen entering
  private recentlyChecked = new Map<number, number>();
  private disabledUntil = 0;
  private attackAt = 0;
  private percAcc = 0;
  private repathAt = 0;
  private stuckT = 0;
  private stuckFails = 0;
  private lastProgress = { x: 0, z: 0 };
  private doorWait: { door: number; until: number; locked: boolean } | null = null;
  private transit: { door: number; locked: boolean; close: boolean }[] = [];
  private lastPatrolRooms: number[] = [];
  private unreachable = new Map<string, number>();
  private climbing: { until: number; to: NavPoint } | null = null;
  private reactUntil = 0;

  constructor(
    private host: EnemyHost,
    start: [number, number, number],
    activeAt: number,
  ) {
    this.x = start[0];
    this.y = start[1];
    this.z = start[2];
    this.activeAt = activeAt;
    this.nav = new Navigator(host.level);
    this.field = new SoundField(host.level);
    this.lastProgress = { x: this.x, z: this.z };
  }

  get f() {
    return floorOfY(this.y);
  }

  stateIndex(): EnemyState {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // External stimuli
  // ---------------------------------------------------------------------------

  /** A noise happened somewhere. `source` is a player id when a player caused it. */
  hear(f: number, x: number, y: number, z: number, intensity: number, source: string | null, hiddenSource = false) {
    if (this.state === 'DORMANT' || this.state === 'TEMPORARILY_DISABLED' || this.state === 'ATTACK_OR_CAPTURE') return;
    this.refreshField();
    let eff = this.field.at(f, x, z);
    // beyond the flooded radius only very loud events matter: estimate through the structure
    if (eff === Infinity) eff = Math.hypot(x - this.x, z - this.z) * 1.6 + Math.abs(f - this.f) * 16 + 20;
    const a = audibility(intensity, this.host.tuning.hearingMultiplier, eff);
    if (a <= 0) return;
    // breathing from a hiding place makes him check that place
    if (hiddenSource && source) {
      const hide = this.host.aiPlayers().find((p) => p.id === source)?.hide ?? -1;
      if (hide >= 0 && (this.state === 'SEARCH_AREA' || this.state === 'INVESTIGATE_SOUND' || this.state === 'PATROL')) {
        this.witnessed.set(hide, source);
        this.enterSearchHide(hide);
      }
      return;
    }
    if (this.state === 'CHASE' && this.target && this.visible.has(this.target)) return;
    const interest = a * intensity;
    const fresh = !this.investigate || this.now - this.investigate.at > 5 || interest > this.investigate.interest * 1.2;
    if (this.state === 'CHASE') {
      // lost the target: a loud sound nearby re-focuses him
      if (!fresh || a < 0.3) return;
    }
    if (!fresh && this.state === 'INVESTIGATE_SOUND') return;
    // estimate position: error grows as the sound gets fainter
    const err = 0.6 + (1 - a) * 5;
    const ang = this.host.rng.next() * Math.PI * 2;
    const gx = x + Math.cos(ang) * err * this.host.rng.next();
    const gz = z + Math.sin(ang) * err * this.host.rng.next();
    const goal = { f, x: gx, z: gz };
    this.investigate = { goal, interest, at: this.now };
    if (source && a > 0.55) this.bumpAwareness(source, 0.25 * a);
    this.host.cue('heard', source ?? undefined, [x, y, z]);
    this.setState('INVESTIGATE_SOUND');
    this.react(0.7, 'listen');
    this.setGoal(goal);
  }

  /** A player entered a hiding spot; if he can see it happen he will remember. */
  observeHide(playerId: string, hide: number) {
    if (this.state === 'DORMANT') return;
    const aw = this.awareness.get(playerId) ?? 0;
    if (this.visible.has(playerId) && (aw > 0.3 || this.state === 'CHASE')) {
      this.witnessed.set(hide, playerId);
      if (this.state === 'CHASE' && this.target === playerId) this.enterSearchHide(hide);
    }
  }

  stun(seconds: number) {
    if (this.state === 'DORMANT') return;
    this.disabledUntil = this.now + seconds;
    this.path = null;
    this.setState('TEMPORARILY_DISABLED');
    this.host.cue('stunned', undefined, [this.x, this.y, this.z]);
  }

  /** Called when a player he was chasing becomes unavailable (escaped, captured by rules...). */
  forget(playerId: string) {
    this.awareness.delete(playerId);
    this.visible.delete(playerId);
    if (this.target === playerId) {
      this.target = null;
      if (this.state === 'CHASE' || this.state === 'ATTACK_OR_CAPTURE') this.setState('RETURN_TO_PATROL');
    }
    for (const [h, p] of this.witnessed) if (p === playerId) this.witnessed.delete(h);
  }

  /** Test hook: keep him dormant. */
  freeze() {
    this.state = 'DORMANT';
    this.activeAt = Infinity;
    this.path = null;
  }

  /** Test hook: place him and start patrolling immediately. */
  wake(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.activeAt = 0;
    this.state = 'PATROL';
    this.path = null;
    this.goal = null;
    this.pause = 0;
  }

  /** Stand looking around for a while (used by tests and scripted moments). */
  holdStill(seconds: number) {
    this.pauseFor(seconds, 'look');
  }

  pushAway(dx: number, dz: number) {
    moveBody(this.host.level, this.host.dyn, this, dx, dz, ENEMY_RADIUS);
  }

  // ---------------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------------

  update(dt: number, nowMs: number) {
    this.now = nowMs / 1000;
    if (this.state === 'DORMANT') {
      this.anim = 'idle';
      this.speed = 0;
      if (nowMs >= this.activeAt) {
        this.setState('PATROL');
        this.host.cue('search', undefined, [this.x, this.y, this.z]);
      }
      return;
    }
    this.updateTransit();
    if (this.climbing) {
      this.anim = 'climb';
      this.speed = 0;
      if (this.now >= this.climbing.until) {
        const to = this.climbing.to;
        this.x = to.x;
        this.y = to.y;
        this.z = to.z;
        this.climbing = null;
        this.pathIdx++;
      }
      return;
    }

    this.percAcc += dt;
    if (this.percAcc >= PERCEPTION_INTERVAL) {
      this.perceive(this.percAcc);
      this.percAcc = 0;
    }

    switch (this.state) {
      case 'PATROL':
        this.tickPatrol();
        break;
      case 'INVESTIGATE_SOUND':
      case 'INVESTIGATE_VISUAL':
        this.tickInvestigate();
        break;
      case 'SEARCH_AREA':
        this.tickSearch();
        break;
      case 'SEARCH_HIDING_SPOT':
        this.tickSearchHide();
        break;
      case 'CHASE':
        this.tickChase();
        break;
      case 'ATTACK_OR_CAPTURE':
        this.tickAttack();
        break;
      case 'TEMPORARILY_DISABLED':
        this.speed = 0;
        this.anim = 'stunned';
        if (this.now >= this.disabledUntil) {
          this.beginSearch({ f: this.f, x: this.x, z: this.z });
        }
        return;
      case 'RETURN_TO_PATROL':
        this.tickReturn();
        break;
    }
    this.move(dt);
  }

  // ---------------------------------------------------------------------------
  // Perception
  // ---------------------------------------------------------------------------

  private perceive(dt: number) {
    const t = this.host.tuning;
    const L = this.host.level;
    const fwd = forwardFromYaw(this.yaw);
    const fovHalf = ((t.visionFovDeg / 2) * Math.PI) / 180;
    this.visible.clear();
    let best: { id: string; score: number } | null = null;
    for (const p of this.host.aiPlayers()) {
      if (p.graceUntil > this.now * 1000) continue;
      const seenable = p.status === 'free' || p.status === 'trapped' || p.status === 'climbing' || (p.inCar && p.carSpeed < 1.5);
      if (!seenable) {
        this.decay(p.id, dt);
        continue;
      }
      const dx = p.x - this.x;
      const dz = p.z - this.z;
      const dy = p.y - this.y;
      const dist = Math.hypot(dx, dz, dy);
      const bright = this.host.roomBright(floorOfY(p.y), p.x, p.z);
      let range = t.visionRange * (0.35 + 0.65 * bright);
      if (p.crouch) range *= 0.65;
      if (p.flash) range = Math.max(range, t.visionRange * 1.15);
      const ang = Math.abs(angleDiff(yawToward(dx, dz), this.yaw));
      const inCone = ang < fovHalf || dist < 2.2;
      if (dist > range || !inCone) {
        this.decay(p.id, dt);
        continue;
      }
      const eyeY = p.y + (p.crouch ? 0.8 : 1.3);
      if (!lineOfSight(L, this.host.dyn, this.x, this.y + ENEMY_EYE, this.z, p.x, eyeY, p.z)) {
        this.decay(p.id, dt);
        continue;
      }
      void fwd;
      this.visible.add(p.id);
      const closeness = 1 - dist / range;
      const centre = 1 - ang / Math.max(fovHalf, 0.01);
      let rate = t.detectionRate * (0.25 + closeness * 1.2) * (0.6 + 0.4 * Math.max(0, centre));
      if (this.state === 'CHASE' && this.target === p.id) rate *= 4;
      if (this.state === 'SEARCH_AREA' || this.state === 'INVESTIGATE_SOUND' || this.state === 'INVESTIGATE_VISUAL') rate *= 1.6;
      if (dist < 2.5) rate = 99;
      const aw = Math.min(1.5, (this.awareness.get(p.id) ?? 0) + rate * dt);
      this.awareness.set(p.id, aw);
      const score = aw * 2 + closeness + (this.target === p.id ? 0.5 : 0);
      if (!best || score > best.score) best = { id: p.id, score };
    }

    if (!best) return;
    const aw = this.awareness.get(best.id) ?? 0;
    const p = this.host.aiPlayers().find((pp) => pp.id === best!.id)!;
    if (aw >= 1) {
      if (this.state !== 'CHASE' && this.state !== 'ATTACK_OR_CAPTURE') {
        this.target = best.id;
        this.setState('CHASE');
        this.react(0.55, 'react');
        this.host.cue('spotted', best.id, [p.x, p.y, p.z]);
      } else if (this.state === 'CHASE') this.target = best.id;
      this.lastKnown = { f: floorOfY(p.y), x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz, t: this.now };
    } else if (aw >= 0.35 && this.state !== 'CHASE' && this.state !== 'ATTACK_OR_CAPTURE' && this.state !== 'SEARCH_HIDING_SPOT') {
      const goal = { f: floorOfY(p.y), x: p.x, z: p.z };
      if (this.state !== 'INVESTIGATE_VISUAL') {
        this.setState('INVESTIGATE_VISUAL');
        this.react(0.4, 'look');
      }
      this.investigate = { goal, interest: 10, at: this.now };
      this.setGoal(goal);
    }
  }

  private decay(id: string, dt: number) {
    const aw = this.awareness.get(id);
    if (aw === undefined) return;
    const rate = this.state === 'CHASE' && this.target === id ? 0.12 : 0.3;
    const n = aw - rate * dt;
    if (n <= 0) this.awareness.delete(id);
    else this.awareness.set(id, n);
  }

  private bumpAwareness(id: string, v: number) {
    this.awareness.set(id, Math.min(0.9, (this.awareness.get(id) ?? 0) + v));
  }

  private refreshField() {
    const cell = this.f * 100000 + Math.floor(this.z) * this.host.level.W + Math.floor(this.x);
    if (cell === this.fieldCell && this.now - this.fieldAt < 0.6) return;
    this.field.compute(this.host.dyn, this.f, Math.floor(this.x), Math.floor(this.z), 64);
    this.fieldCell = cell;
    this.fieldAt = this.now;
  }

  // ---------------------------------------------------------------------------
  // State behaviours
  // ---------------------------------------------------------------------------

  private setState(s: EnemyState) {
    if (this.state === 'CHASE' && s !== 'CHASE' && s !== 'ATTACK_OR_CAPTURE') this.host.cue('chase_end', this.target ?? undefined);
    this.state = s;
    this.stateAt = this.now;
    this.stuckFails = 0;
    if (s !== 'CHASE' && s !== 'ATTACK_OR_CAPTURE') this.target = s === 'SEARCH_HIDING_SPOT' ? this.target : null;
  }

  private react(seconds: number, anim: EnemyAnim) {
    this.reactUntil = this.now + seconds;
    this.pauseFor(seconds, anim);
  }

  private pauseFor(seconds: number, anim: EnemyAnim, then?: () => void) {
    this.pause = seconds;
    this.pauseAnim = anim;
    this.onPauseEnd = then ?? null;
  }

  private tickPatrol() {
    if (this.pause > 0) return;
    if (!this.path || this.pathIdx >= this.path.length) {
      if (this.goal && this.dist2(this.goal) < 2.5) {
        this.goal = null;
        // look around, listen, mutter
        const r = this.host.rng.next();
        this.pauseFor(1.5 + this.host.rng.next() * 2.5, r < 0.4 ? 'listen' : 'look');
        return;
      }
      this.pickPatrolGoal();
    }
    // occasional unsettling pause mid-route
    if (this.host.rng.next() < 0.0025) this.pauseFor(1 + this.host.rng.next() * 1.5, 'listen');
  }

  private pickPatrolGoal() {
    const L = this.host.level;
    const pts = L.patrolPoints;
    const interest = this.host.patrolInterest();
    const weights = pts.map((p) => {
      if ((this.unreachable.get(`${p.f}:${p.x}:${p.z}`) ?? 0) > this.now) return 0;
      if (this.lastPatrolRooms.includes(p.room)) return 0.05;
      let w = 1;
      for (const it of interest) {
        if (it.f !== p.f) continue;
        const d = Math.hypot(it.x - p.x, it.z - p.z);
        if (d < 12) w += it.w * (1 - d / 12);
      }
      const d = Math.hypot(p.x - this.x, p.z - this.z) + Math.abs(p.f - this.f) * 10;
      w *= d < 6 ? 0.2 : 1 / (1 + d / 50);
      return w;
    });
    for (let attempt = 0; attempt < 6; attempt++) {
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) break;
      let r = this.host.rng.next() * total;
      let i = 0;
      for (; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) break;
      }
      i = Math.min(i, pts.length - 1);
      const p = pts[i];
      if (this.setGoal({ f: p.f, x: p.x + 0.5, z: p.z + 0.5 })) {
        this.lastPatrolRooms.push(p.room);
        if (this.lastPatrolRooms.length > 4) this.lastPatrolRooms.shift();
        return;
      }
      this.unreachable.set(`${p.f}:${p.x}:${p.z}`, this.now + 30);
      weights[i] = 0;
    }
    this.pauseFor(1, 'look');
  }

  private tickInvestigate() {
    if (this.pause > 0) return;
    const inv = this.investigate;
    if (!inv) {
      this.setState('RETURN_TO_PATROL');
      return;
    }
    if (this.dist2(inv.goal) < 1.6 || !this.path || this.pathIdx >= (this.path?.length ?? 0)) {
      const center = { ...inv.goal };
      this.investigate = null;
      this.pauseFor(1.2, 'listen', () => this.beginSearch(center));
      return;
    }
    if (this.now - this.stateAt > 40) this.beginSearch({ f: this.f, x: this.x, z: this.z });
  }

  private beginSearch(center: Goal) {
    const t = this.host.tuning;
    const L = this.host.level;
    this.setState('SEARCH_AREA');
    this.searchCenter = center;
    this.searchUntil = this.now + t.searchDuration;
    this.host.cue('search', undefined, [center.x, this.y, center.z]);
    const queue: typeof this.searchQueue = [];
    // nearby hiding spots, checked with a difficulty-based chance (or always if witnessed)
    const hides = L.hides
      .filter((h) => h.f === center.f && Math.hypot(h.exit[0] - center.x, h.exit[2] - center.z) < 8)
      .filter((h) => (this.recentlyChecked.get(h.index) ?? 0) < this.now);
    let checks = 0;
    for (const h of hides) {
      const witnessed = this.witnessed.has(h.index);
      if (witnessed || (checks < 2 && this.host.rng.next() < t.hidingCheckChance)) {
        queue.push({ kind: 'hide', hide: h.index });
        if (!witnessed) checks++;
      }
    }
    for (let i = 0; i < 4; i++) {
      const ang = this.host.rng.next() * Math.PI * 2;
      const r = 2 + this.host.rng.next() * 6;
      const gx = center.x + Math.cos(ang) * r;
      const gz = center.z + Math.sin(ang) * r;
      if (this.nav.walkable(this.host.nav, center.f, Math.floor(gx), Math.floor(gz))) queue.push({ kind: 'point', goal: { f: center.f, x: gx, z: gz } });
    }
    this.host.rng.shuffle(queue);
    // witnessed hiding spots first
    queue.sort((a, b) => Number(b.kind === 'hide' && this.witnessed.has(b.hide)) - Number(a.kind === 'hide' && this.witnessed.has(a.hide)));
    this.searchQueue = queue;
    this.path = null;
  }

  private tickSearch() {
    if (this.pause > 0) return;
    if (this.now > this.searchUntil) {
      this.setState('RETURN_TO_PATROL');
      return;
    }
    if (this.path && this.pathIdx < this.path.length) return;
    const next = this.searchQueue.shift();
    if (!next) {
      if (this.searchCenter && this.now < this.searchUntil - 2) {
        // keep sweeping until the timer runs out
        const c = this.searchCenter;
        const ang = this.host.rng.next() * Math.PI * 2;
        const goal = { f: c.f, x: c.x + Math.cos(ang) * 5, z: c.z + Math.sin(ang) * 5 };
        if (!this.setGoal(goal)) this.pauseFor(1.2, 'look');
        else this.pauseFor(0.8 + this.host.rng.next(), 'look');
        return;
      }
      this.setState('RETURN_TO_PATROL');
      return;
    }
    if (next.kind === 'hide') {
      this.enterSearchHide(next.hide);
      return;
    }
    if (!this.setGoal(next.goal)) return;
    this.pauseFor(0.6 + this.host.rng.next() * 1.2, this.host.rng.next() < 0.5 ? 'look' : 'listen');
  }

  private enterSearchHide(hide: number) {
    const h = this.host.level.hides[hide];
    this.hideTarget = hide;
    this.setState('SEARCH_HIDING_SPOT');
    if (!this.setGoal({ f: h.f, x: h.exit[0], z: h.exit[2] })) {
      this.recentlyChecked.set(hide, this.now + 20);
      this.witnessed.delete(hide);
      this.beginSearch({ f: this.f, x: this.x, z: this.z });
    }
  }

  private tickSearchHide() {
    if (this.pause > 0) return;
    const h = this.host.level.hides[this.hideTarget];
    if (!h) {
      this.setState('RETURN_TO_PATROL');
      return;
    }
    const d = Math.hypot(h.exit[0] - this.x, h.exit[2] - this.z);
    if (d < 1.0 || !this.path || this.pathIdx >= this.path.length) {
      if (d > 1.8) {
        // could not get there
        this.recentlyChecked.set(h.index, this.now + 20);
        this.beginSearch({ f: this.f, x: this.x, z: this.z });
        return;
      }
      this.yaw = yawToward(h.inside[0] - this.x, h.inside[2] - this.z);
      const hideIdx = h.index;
      this.pauseFor(1.3, 'searchHide', () => {
        this.recentlyChecked.set(hideIdx, this.now + 25);
        const occ = this.host.hideOccupant(hideIdx);
        this.witnessed.delete(hideIdx);
        if (occ) {
          this.target = occ;
          this.host.capture(occ);
          this.pauseFor(2.2, 'attack', () => this.setState('RETURN_TO_PATROL'));
          return;
        }
        // nobody there — keep searching if time remains
        if (this.now < this.searchUntil && this.searchCenter) {
          this.state = 'SEARCH_AREA';
          this.stateAt = this.now;
        } else this.beginSearch({ f: this.f, x: this.x, z: this.z });
      });
    }
  }

  private tickChase() {
    const t = this.host.tuning;
    const target = this.host.aiPlayers().find((p) => p.id === this.target);
    if (!target || target.status === 'escaped' || target.status === 'caged' || target.status === 'captured' || target.status === 'eliminated') {
      this.setState('RETURN_TO_PATROL');
      return;
    }
    if (target.status === 'hidden') {
      // he did not see the hide (otherwise observeHide switched state) — go to last known
      this.beginSearch(this.lastKnown ? { f: this.lastKnown.f, x: this.lastKnown.x, z: this.lastKnown.z } : { f: this.f, x: this.x, z: this.z });
      this.host.cue('lost', target.id);
      return;
    }
    const seen = this.visible.has(target.id);
    const canGrab = !target.inCar || target.carSpeed < 1.5;
    if (seen) {
      this.lostSightAt = this.now;
      const d = Math.hypot(target.x - this.x, target.z - this.z);
      if (d < CAPTURE_RANGE + (target.inCar ? 1.2 : 0) && Math.abs(target.y - this.y) < 1.2 && canGrab) {
        this.setState('ATTACK_OR_CAPTURE');
        this.target = target.id;
        this.attackAt = this.now + 0.42;
        this.path = null;
        return;
      }
      if (this.now >= this.repathAt || !this.goal || Math.hypot(this.goal.x - target.x, this.goal.z - target.z) > 1.2) {
        this.setGoal({ f: floorOfY(target.y), x: target.x, z: target.z });
        this.repathAt = this.now + 0.3;
      }
      return;
    }
    // lost sight: chase persistence — run to where they were heading
    const lost = this.now - this.lostSightAt;
    const lk = this.lastKnown;
    if (!lk) {
      this.beginSearch({ f: this.f, x: this.x, z: this.z });
      return;
    }
    if (lost > t.chasePersistence + 1.5) {
      this.host.cue('lost', target.id);
      this.beginSearch({ f: lk.f, x: lk.x, z: lk.z });
      return;
    }
    if (this.now >= this.repathAt) {
      const ahead = Math.min(lost, 1.2);
      this.setGoal({ f: lk.f, x: lk.x + lk.vx * ahead, z: lk.z + lk.vz * ahead }) || this.setGoal({ f: lk.f, x: lk.x, z: lk.z });
      this.repathAt = this.now + 0.5;
    }
  }

  private tickAttack() {
    this.speed = 0;
    this.anim = 'attack';
    if (this.attackAt === Infinity) return;
    const target = this.host.aiPlayers().find((p) => p.id === this.target);
    if (!target) {
      this.setState('RETURN_TO_PATROL');
      return;
    }
    this.yaw = yawToward(target.x - this.x, target.z - this.z);
    if (this.now < this.attackAt) return;
    const d = Math.hypot(target.x - this.x, target.z - this.z);
    const reach = CAPTURE_RANGE + 0.65 + (target.inCar ? 1.2 : 0);
    if (d <= reach && Math.abs(target.y - this.y) < 1.4 && (target.status === 'free' || target.status === 'trapped' || target.status === 'climbing' || target.inCar)) {
      this.host.capture(target.id);
      this.awareness.delete(target.id);
      this.pauseFor(2.5, 'attack', () => this.setState('RETURN_TO_PATROL'));
      this.state = 'ATTACK_OR_CAPTURE';
      this.attackAt = Infinity;
      return;
    }
    // they slipped away
    this.setState('CHASE');
    this.target = target.id;
  }

  private tickReturn() {
    if (this.pause > 0) return;
    if (!this.path || this.pathIdx >= this.path.length) {
      this.setState('PATROL');
      this.pickPatrolGoal();
    }
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  private dist2(g: Goal) {
    return Math.hypot(g.x - this.x, g.z - this.z) + (g.f !== this.f ? 10 : 0);
  }

  private setGoal(goal: Goal): boolean {
    const path = this.nav.findPath(this.host.nav, this.f, this.x, this.z, goal.f, goal.x, goal.z);
    if (!path || !path.length) {
      this.path = null;
      return false;
    }
    this.goal = goal;
    this.path = path;
    this.pathIdx = path.length > 1 ? 1 : 0;
    this.stuckT = 0;
    this.lastProgress = { x: this.x, z: this.z };
    return true;
  }

  private speedFor(): number {
    const t = this.host.tuning;
    switch (this.state) {
      case 'CHASE':
        return t.enemyChaseSpeed;
      case 'INVESTIGATE_SOUND':
      case 'INVESTIGATE_VISUAL':
        return t.enemyInvestigateSpeed;
      case 'SEARCH_AREA':
      case 'SEARCH_HIDING_SPOT':
        return t.enemyInvestigateSpeed * 0.8;
      default:
        return t.enemyPatrolSpeed;
    }
  }

  private move(dt: number) {
    if (this.pause > 0) {
      this.pause -= dt;
      this.speed = 0;
      this.anim = this.pauseAnim;
      if (this.pause <= 0) {
        const cb = this.onPauseEnd;
        this.onPauseEnd = null;
        cb?.();
      }
      return;
    }
    if (this.doorWait) {
      this.speed = 0;
      this.anim = 'door';
      if (this.now >= this.doorWait.until) {
        const dw = this.doorWait;
        this.doorWait = null;
        if (!this.host.isDoorOpen(dw.door)) {
          this.host.enemyOpenDoor(dw.door, dw.locked);
          const close = dw.locked || (this.state === 'PATROL' && this.host.rng.next() < 0.25);
          this.transit.push({ door: dw.door, locked: dw.locked, close });
        }
      }
      return;
    }
    const path = this.path;
    if (!path || this.pathIdx >= path.length) {
      this.speed = 0;
      this.anim = this.state === 'SEARCH_AREA' ? 'look' : 'idle';
      return;
    }
    const wp = path[this.pathIdx];
    // ladders: climbing animation, then transfer to the other end
    if (wp.ladder >= 0) {
      this.climbing = { until: this.now + 1.6, to: wp };
      return;
    }
    // doors: stop, open (slowly if locked), continue
    if (wp.door >= 0 && !this.host.isDoorOpen(wp.door)) {
      const dc = this.host.level.doors[wp.door].center;
      const dd = Math.hypot(dc[0] - this.x, dc[2] - this.z);
      if (dd < 1.35) {
        const locked = this.host.isDoorLocked(wp.door);
        this.doorWait = { door: wp.door, until: this.now + (locked ? 1.4 : 0.75), locked };
        this.yaw = yawToward(dc[0] - this.x, dc[2] - this.z);
        return;
      }
    }
    const dx = wp.x - this.x;
    const dz = wp.z - this.z;
    const d = Math.hypot(dx, dz);
    const sameCell = Math.floor(wp.x) === Math.floor(this.x) && Math.floor(wp.z) === Math.floor(this.z) && wp.f === this.f;
    if (d < 0.35 || (sameCell && d < 0.6)) {
      this.pathIdx++;
      return;
    }
    const sp = this.speedFor() * (this.now < this.reactUntil ? 0 : 1);
    const step = Math.min(d, sp * dt);
    const obstacles: CircleObstacle[] = [];
    const car = this.host.carObstacle();
    if (car) obstacles.push(car);
    moveBody(this.host.level, this.host.dyn, this, (dx / d) * step, (dz / d) * step, ENEMY_RADIUS, obstacles);
    // stairs: snap floor transitions along the ramp
    if (wp.f !== this.f && Math.hypot(wp.x - this.x, wp.z - this.z) < 0.5) this.y = wp.y;
    // turn smoothly toward travel direction
    const desired = yawToward(dx, dz);
    const turn = (this.state === 'CHASE' ? 9 : 4.5) * dt;
    const diff = angleDiff(desired, this.yaw);
    this.yaw += Math.max(-turn, Math.min(turn, diff));
    this.speed = sp;
    this.anim = this.state === 'CHASE' ? 'chase' : this.state === 'INVESTIGATE_SOUND' || this.state === 'INVESTIGATE_VISUAL' ? 'investigate' : 'walk';
    // stuck detection
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      const moved = Math.hypot(this.x - this.lastProgress.x, this.z - this.lastProgress.z);
      this.lastProgress = { x: this.x, z: this.z };
      this.stuckT = 0;
      if (moved < 0.3) {
        this.stuckFails++;
        if (this.goal && this.stuckFails < 3) this.setGoal(this.goal);
        else {
          this.path = null;
          this.stuckFails = 0;
          // nudge free and give up on this goal
          const ang = this.host.rng.next() * Math.PI * 2;
          this.pushAway(Math.cos(ang) * 0.3, Math.sin(ang) * 0.3);
          if (this.state === 'CHASE') this.beginSearch({ f: this.f, x: this.x, z: this.z });
          else if (this.state !== 'PATROL') this.setState('RETURN_TO_PATROL');
        }
      }
    }
  }

  /** Re-close (and re-lock) doors he passed through once he is clear of them. */
  private updateTransit() {
    if (!this.transit.length) return;
    this.transit = this.transit.filter((tr) => {
      const c = this.host.level.doors[tr.door].center;
      const d = Math.hypot(c[0] - this.x, c[2] - this.z);
      if (d > 2.2 || Math.abs(c[1] - this.y) > 2) {
        if (tr.close) this.host.enemyCloseDoor(tr.door);
        return false;
      }
      return true;
    });
  }
}
