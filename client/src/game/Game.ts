/**
 * Client game runtime: renders the estate, runs local first-person prediction, mirrors the
 * authoritative server state, plays positional audio and drives the HUD. All gameplay
 * decisions (items, doors, puzzles, the enemy, captures, escapes) come from the server.
 */
import * as THREE from 'three';
import {
  CLIENT_SEND_HZ,
  DIFFICULTY,
  ENEMY_ANIMS,
  ENEMY_STATES,
  F,
  FLOOR_NAMES,
  INTERACT_RANGE,
  PF,
  cellFlags,
  floorOfY,
  itemDef,
  lineOfSight,
  listTargets,
  resolveInteraction,
  roomAt,
  surfaceOfFloorMat,
  type CircleObstacle,
  type EscapeRoute,
  type GameEvent,
  type Interaction,
  type MatchInit,
  type Snapshot,
  type Surface,
  type TargetInfo,
  type Zone,
} from '@nower/shared';
import { net } from '../net/net';
import { store, type Hud, type Teammate } from '../state/store';
import { audio } from './audio/AudioEngine';
import { Cinematic } from './Cinematics';
import { ClientWorld } from './ClientWorld';
import { CarView } from './entities/CarView';
import { DoorView } from './entities/DoorViews';
import { EnemyModel } from './entities/EnemyModel';
import { itemModel } from './entities/ItemModels';
import { MechViews } from './entities/MechViews';
import { LadderViews, TrapView, WaterView, buildNotes } from './entities/MiscViews';
import { PlayerModel } from './entities/PlayerModel';
import { PostFX } from './fx/PostFX';
import { computeObjectives } from './objectives';
import { Controller, Input, type Action } from './player/Controller';
import { buildStaticWorld, type StaticWorld } from './scene';
import { LightPool } from './world/Lights';
import { Rain } from './world/props';

const OUTDOOR_ZONES: Zone[] = ['garden', 'yard', 'road'];

interface ItemView {
  obj: THREE.Object3D;
  type: string;
}

interface Remote {
  model: PlayerModel;
  last: THREE.Vector3;
  stride: number;
  lastCell: number;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private post: PostFX | null = null;
  world: ClientWorld;
  private ctrl: Controller;
  private input: Input;
  private static: StaticWorld | null = null;
  private doors: DoorView[] = [];
  private items = new Map<string, ItemView>();
  private mechs!: MechViews;
  private car!: CarView;
  private traps: TrapView[] = [];
  private water!: WaterView;
  private ladders!: LadderViews;
  private enemy = new EnemyModel();
  private remotes = new Map<string, Remote>();
  private held: THREE.Object3D | null = null;
  private heldType: string | null = null;
  private flashlight: THREE.SpotLight;
  private flashOn = true;
  private ambient: THREE.AmbientLight;
  private moon: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private lights!: LightPool;
  private rain = new Rain();
  private cinematic: Cinematic | null = null;
  private target: { info: TargetInfo; inter: Interaction } | null = null;
  private targets: TargetInfo[] = [];
  private targetsAt = 0;
  private holding: { label: string; start: number; dur: number } | null = null;
  private seq = 0;
  private sendAcc = 0;
  private hudAcc = 0;
  private objAcc = 0;
  private raf = 0;
  private last = performance.now();
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  private running = false;
  private enemyLast = new THREE.Vector3();
  private enemyStride = 0;
  private enemyStep = 0;
  private enemyBreathAt = 0;
  private enemyVoiceAt = 0;
  private heartbeatAt = 0;
  private playerBreathAt = 0;
  private danger = 0;
  private pulse = 0;
  private screenFlash = 0;
  private heardAt = 0;
  private spottedAt = 0;
  private spectate: string | null = null;
  private orbit = 0;
  private lastCell = -1;
  private holdingBreath = false;
  private breath = 8;
  private hideLook = { yaw: 0, pitch: 0 };
  private projectiles: { obj: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];
  private flashLight = new THREE.PointLight(0xffffff, 0, 12, 2);
  private matchStartedAt = Date.now();
  private personalDone = false;
  private endingShown = false;
  private lastStatus = '';
  private handlers: [string, (...a: never[]) => void][] = [];
  private onResize = () => this.resize();

  constructor(
    private container: HTMLElement,
    init: MatchInit,
  ) {
    this.world = new ClientWorld(init);
    const q = store.getState().settings.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 1.75 : q === 'medium' ? 1.25 : 0.8));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(store.getState().settings.fov, 1, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.fog = new THREE.FogExp2(0x040506, 0.06);
    this.scene.background = new THREE.Color(0x020203);
    this.ambient = new THREE.AmbientLight(0x3a4252, 0.8);
    this.hemi = new THREE.HemisphereLight(0x4a5a7a, 0x10100c, 0);
    this.moon = new THREE.DirectionalLight(0x8090b8, 0);
    this.moon.position.set(-45, 75, 120);
    this.moon.target.position.set(48, 0, 40);
    this.scene.add(this.ambient, this.hemi, this.moon, this.moon.target, this.flashLight);
    // flashlight
    this.flashlight = new THREE.SpotLight(0xfff1d8, 70, 26, 0.5, 0.45, 1.6);
    this.flashlight.castShadow = q !== 'low';
    this.flashlight.shadow.mapSize.set(q === 'high' ? 1024 : 512, q === 'high' ? 1024 : 512);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.bias = -0.0015;
    this.flashlight.position.set(0.2, -0.15, 0.1);
    this.flashlight.target.position.set(0, -0.2, -4);
    this.camera.add(this.flashlight, this.flashlight.target);
    if (q !== 'low') this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.ctrl = new Controller(this.world.level, this.world.dyn);
    this.input = new Input(this.renderer.domElement);
    this.input.on((a) => this.onAction(a));
    this.ctrl.onStep = (mode) => this.localStep(mode);
    const me = init.snapshot.p.find((p) => p[0] === init.you);
    if (me) this.ctrl.place(me[1], me[2], me[3], me[4]);
    this.seq = init.teleportSeq;
    window.addEventListener('resize', this.onResize);
    this.resize();
    // subscribe immediately: events that arrive while the world is still loading are buffered
    const s = net.socket!;
    const onEv = (evs: GameEvent[]) => {
      if (this.built) evs.forEach((e) => this.onEvent(e));
      else this.backlog.push(...evs);
    };
    const onSnap = (snap: Snapshot) => this.world.pushSnapshot(snap);
    s.on('g:ev', onEv);
    s.on('g:snap', onSnap);
    this.handlers.push(['g:ev', onEv as never], ['g:snap', onSnap as never]);
  }

  private built = false;
  private backlog: GameEvent[] = [];

  async build(progress: (text: string, p: number) => void) {
    const L = this.world.level;
    this.static = await buildStaticWorld(L, progress);
    this.scene.add(this.static.root);
    progress('Unlocking the doors', 0.95);
    for (const d of L.doors) {
      const v = new DoorView(d, L);
      v.set(this.world.doors[d.index]);
      v.update(10);
      this.doors.push(v);
      this.scene.add(v.obj);
    }
    for (const c of this.static.containers) {
      c.target = this.world.containers[c.index] ? 1 : 0;
    }
    this.mechs = new MechViews(L, this.world.panelSymbols, this.world.valveWeights, this.world.valveTarget);
    this.mechs.set(this.world.mechs);
    this.scene.add(this.mechs.obj);
    this.car = new CarView();
    this.car.set(this.world.car);
    this.car.attachSmoke(this.scene);
    this.scene.add(this.car.obj);
    this.world.traps.forEach((t) => {
      const v = new TrapView(L, t);
      this.traps.push(v);
      this.scene.add(v.obj);
    });
    this.water = new WaterView(L);
    this.water.set(this.world.water[0].level);
    this.scene.add(this.water.obj);
    this.ladders = new LadderViews(L);
    this.world.ladders.forEach((o, i) => this.ladders.set(i, o || L.ladders[i].spec.id !== 'garden_grate'));
    this.scene.add(this.ladders.obj, buildNotes(L));
    for (const it of this.world.items.values()) this.syncItem(it.id);
    this.scene.add(this.enemy.root);
    for (const p of this.world.players.values()) this.syncRemote(p.id);
    this.scene.add(this.rain.obj);
    this.lights = new LightPool(L, this.scene, store.getState().settings.quality === 'high' ? 9 : store.getState().settings.quality === 'medium' ? 7 : 4);
    this.applyStatusCamera(true);
    progress('He is waiting', 1);
  }

  start(intro: boolean) {
    this.built = true;
    const backlog = this.backlog;
    this.backlog = [];
    for (const e of backlog) this.onEvent(e);
    audio.menuMode(false);
    audio.music?.set('calm');
    audio.randomNear = (d) => this.randomNear(d);
    audio.occlusionOf = (p) => this.occlusion(p);
    const st = this.world.me.status;
    if (intro && st === 'free' && this.world.phase !== 'ENDED') {
      this.cinematic = new Cinematic('intro', new THREE.Vector3(this.ctrl.x, this.ctrl.y, this.ctrl.z), this.ctrl.yaw);
      store.getState().set({ introPlaying: true });
    }
    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      try {
        this.update(dt);
      } catch (err) {
        console.error(err);
      }
    };
    loop();
  }

  /** Replace state after a reconnect. */
  resync(init: MatchInit) {
    const fresh = new ClientWorld(init);
    this.world = fresh;
    (this.ctrl as unknown as { dyn: unknown }).dyn = fresh.dyn;
    const me = init.snapshot.p.find((p) => p[0] === init.you);
    if (me) this.ctrl.place(me[1], me[2], me[3], me[4]);
    this.seq = init.teleportSeq;
    this.doors.forEach((d, i) => d.set(fresh.doors[i]));
    this.static?.containers.forEach((c) => (c.target = fresh.containers[c.index] ? 1 : 0));
    this.mechs.set(fresh.mechs);
    this.car.set(fresh.car);
    this.water.set(fresh.water[0].level);
    fresh.traps.forEach((t, i) => this.traps[i]?.set(t));
    for (const it of fresh.items.values()) this.syncItem(it.id);
    for (const p of fresh.players.values()) this.syncRemote(p.id);
    this.holding = null;
  }

  // ---------------------------------------------------------------- state sync helpers
  private syncItem(id: string) {
    const it = this.world.items.get(id)!;
    let v = this.items.get(id);
    if (!v) {
      const obj = itemModel(it.type);
      v = { obj, type: it.type };
      this.items.set(id, v);
      this.scene.add(obj);
    }
    v.obj.visible = it.place === 'world';
    v.obj.position.set(it.pos[0], it.pos[1], it.pos[2]);
    v.obj.rotation.y = (id.length * 1.37) % 6.28;
    if (it.holder === this.world.you) this.setHeld(it.type);
    else if (this.heldType && this.world.me.held === null) this.setHeld(null);
  }

  /** Positions items inside drawers/cupboards so they appear when the container is opened. */
  private placeContainerItems() {
    const L = this.world.level;
    for (const [id, v] of this.items) {
      const it = this.world.items.get(id)!;
      if (it.place !== 'world' || it.container < 0) continue;
      const c = this.static!.containers.find((cc) => cc.index === it.container)!;
      const fu = L.furniture[L.containers[it.container].furn];
      const front = [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ][fu.rot];
      v.obj.visible = c.t > 0.3;
      const out = c.kind === 'chest' ? 0 : c.kind === 'drawer' ? 0.42 * c.t : 0.38 * c.t;
      v.obj.position.set(it.pos[0] + front[0] * out, c.kind === 'chest' ? it.pos[1] + 0.3 * c.t : it.pos[1], it.pos[2] + front[1] * out);
    }
  }

  private setHeld(type: string | null) {
    if (type === this.heldType) return;
    if (this.held) this.camera.remove(this.held);
    this.held = null;
    this.heldType = type;
    if (!type) return;
    const m = itemModel(type);
    const def = itemDef(type);
    m.scale.setScalar(def.heavy ? 1 : def.cat === 'small' ? 1.9 : 1.2);
    m.position.set(0.3, def.heavy ? -0.45 : -0.28, -0.55);
    m.rotation.set(0.3, -0.5, 0);
    m.traverse((o) => {
      o.renderOrder = 10;
      o.castShadow = false;
    });
    this.held = m;
    this.camera.add(m);
  }

  private syncRemote(id: string) {
    if (id === this.world.you) return;
    const p = this.world.players.get(id)!;
    let r = this.remotes.get(id);
    if (!r) {
      r = { model: new PlayerModel(p.name, p.color), last: new THREE.Vector3(), stride: 0, lastCell: -1 };
      this.remotes.set(id, r);
      this.scene.add(r.model.root);
    }
    r.model.root.visible = p.status === 'free' || p.status === 'trapped' || p.status === 'caged' || p.status === 'climbing' || p.status === 'captured';
  }

  // ---------------------------------------------------------------- events
  private onEvent(e: GameEvent) {
    this.world.apply(e);
    const me = this.world.you;
    const st = store.getState();
    const P = (p: [number, number, number]) => ({ x: p[0], y: p[1], z: p[2] });
    switch (e.k) {
      case 'door':
        this.doors[e.i].set({ open: e.open, locked: e.locked });
        break;
      case 'item':
        this.syncItem(e.s.id);
        if (e.s.holder !== me && this.world.me.held === null) this.setHeld(null);
        break;
      case 'container': {
        const c = this.static?.containers.find((cc) => cc.index === e.i);
        if (c) c.target = e.open ? 1 : 0;
        break;
      }
      case 'ladder':
        this.ladders.set(e.i, e.open);
        break;
      case 'water':
        this.water.set(e.level);
        break;
      case 'mechs':
        this.mechs.set(e.s);
        this.lights.basementPowered = e.s.generator.running;
        break;
      case 'car':
        this.car.set(e.s);
        break;
      case 'trap':
        this.traps[e.i]?.set(e.s);
        break;
      case 'player':
        this.syncRemote(e.s.id);
        if (e.s.id === me) this.onMyStatus();
        if (e.s.id === me && e.s.held === null) this.setHeld(null);
        break;
      case 'sound':
        audio.play(e.s, P(e.pos), Math.min(1.5, e.v));
        break;
      case 'notify':
        if (!e.to || e.to === me) {
          const chasing = this.world.interpEnemy().state === ENEMY_STATES.indexOf('CHASE');
          if (!(chasing && e.tone === 'info')) st.toast(e.text, e.tone);
        }
        break;
      case 'cue':
        this.onCue(e);
        break;
      case 'journal': {
        const note = this.world.level.notes.find((n) => n.spec.id === e.note);
        st.set({ journal: [...this.world.journal] });
        if (note && e.by !== me) st.toast(`${this.world.players.get(e.by)?.name ?? 'Someone'} found a note: ${note.spec.title}`, 'info');
        break;
      }
      case 'phase':
        if (e.phase === 'ENDED') this.maybeShowEnding();
        break;
      case 'hold':
        if (e.player === me) this.holding = { label: e.label, start: performance.now(), dur: e.dur };
        break;
      case 'holdEnd':
        if (e.player === me) this.holding = null;
        break;
      case 'throw': {
        const obj = itemModel('bottle');
        this.scene.add(obj);
        this.projectiles.push({ obj, from: new THREE.Vector3(...e.from), to: new THREE.Vector3(...e.to), t: 0 });
        break;
      }
      case 'flash': {
        this.flashLight.position.set(...e.pos);
        this.flashLight.intensity = 400;
        const d = this.camera.position.distanceTo(new THREE.Vector3(...e.pos));
        if (d < 10) this.screenFlash = e.by === me ? 0.6 : 0.4 * (1 - d / 10);
        audio.play('flash', P(e.pos));
        break;
      }
      case 'teleport':
        if (e.player === me) {
          this.ctrl.place(e.pos[0], e.pos[1], e.pos[2], e.yaw);
          this.seq = e.seq;
        }
        break;
      case 'stumble':
        if (e.player === me) {
          this.ctrl.stumbleUntil = performance.now() + 1100;
          audio.play('stumble', null, 0.6);
        }
        break;
      case 'escape':
        if (e.player !== me) audio.music?.stinger('escape');
        break;
    }
  }

  private onCue(e: Extract<GameEvent, { k: 'cue' }>) {
    const me = this.world.you;
    const ep = this.world.interpEnemy();
    const epos = { x: ep.x, y: ep.y + 1.6, z: ep.z };
    switch (e.cue) {
      case 'heard':
        if (e.target === me) this.heardAt = performance.now();
        if (Math.random() < 0.6) audio.enemy('hmm', epos, 0.9);
        break;
      case 'spotted':
        this.spottedAt = performance.now();
        audio.enemy('scream', epos, e.target === me ? 1.2 : 0.8);
        if (e.target === me || this.camera.position.distanceTo(new THREE.Vector3(ep.x, ep.y, ep.z)) < 25) audio.music?.stinger('spotted');
        break;
      case 'lost':
      case 'search':
        if (Math.random() < 0.7) audio.enemy('mutter', epos, 0.9);
        break;
      case 'capture':
        audio.enemy('growl', epos, 1.2);
        if (e.target === me) {
          audio.music?.stinger('capture');
          this.pulse = 1;
        }
        break;
      case 'stunned':
        audio.enemy('groan', epos, 1.1);
        break;
      case 'escape_alert':
        audio.music?.stinger('escape');
        break;
      case 'chase_end':
        break;
    }
  }

  private onMyStatus() {
    const me = this.world.me;
    const st = me.status;
    if (st === this.lastStatus) return;
    const prev = this.lastStatus;
    this.lastStatus = st;
    if (st === 'captured') {
      this.cinematic = new Cinematic('captured', this.camera.position.clone(), this.ctrl.yaw);
      this.holding = null;
    }
    if (st === 'escaped' && me.escapedVia) {
      this.cinematic = new Cinematic(me.escapedVia, this.camera.position.clone(), this.ctrl.yaw);
      store.getState().set({ personalEnding: me.escapedVia });
      audio.music?.stinger('victory');
    }
    if (st === 'eliminated') {
      this.cinematic = new Cinematic('eliminated', this.camera.position.clone(), this.ctrl.yaw);
      store.getState().set({ personalEnding: 'captured' });
      audio.music?.stinger('defeat');
    }
    if (st === 'caged' && prev === 'captured') store.getState().toast('You wake up in a cage. Work the latch (E) or wait for a teammate.', 'warn');
    if (st === 'hidden') {
      this.hideLook = { yaw: 0, pitch: 0 };
      this.breath = 8;
    }
    this.applyStatusCamera(false);
  }

  private applyStatusCamera(_initial: boolean) {
    this.flashlight.visible = this.flashOn && this.world.me.battery > 0;
  }

  // ---------------------------------------------------------------- main loop
  private update(dt: number) {
    const w = this.world;
    w.now = w.serverNow();
    const settings = store.getState().settings;
    const me = w.me;
    const st = me.status;
    const modal = store.getState().modal;
    const cin = this.cinematic;

    // mouse look
    const mouse = this.input.consumeMouse();
    if (!cin && !modal) {
      if (st === 'hidden') {
        this.hideLook.yaw = Math.max(-0.7, Math.min(0.7, this.hideLook.yaw - mouse.dx * 0.0022 * settings.sensitivity));
        this.hideLook.pitch = Math.max(-0.4, Math.min(0.4, this.hideLook.pitch - mouse.dy * 0.0022 * settings.sensitivity));
      } else this.ctrl.look(mouse.dx, mouse.dy, settings.sensitivity, settings.invertY);
    }

    // local movement prediction
    const canMove = !cin && !modal && w.phase === 'PLAYING' && (st === 'free' || st === 'caged');
    const heavy = !!(me.held && itemDef(w.items.get(me.held)!.type).heavy);
    const obstacles: CircleObstacle[] = [];
    if (!w.car.escaped) {
      const c = w.interpCar();
      const fx = -Math.sin(c.yaw);
      const fz = -Math.cos(c.yaw);
      for (const o of [-1.45, 0, 1.45]) obstacles.push({ x: c.x + fx * o, z: c.z + fz * o, r: 0.95, f: 2 });
    }
    if (st === 'free' || st === 'caged') this.ctrl.update(dt, this.input, { canMove, heavy, obstacles, now: performance.now() });
    this.creakCheck();

    // network: movement + car input at a fixed rate
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / CLIENT_SEND_HZ) {
      this.sendAcc = 0;
      let flags = 0;
      if (this.ctrl.crouch) flags |= PF.CROUCH;
      if (this.ctrl.sprinting) flags |= PF.SPRINT;
      if (this.flashOn && me.battery > 0) flags |= PF.FLASH;
      if (this.ctrl.speed > 0.2) flags |= PF.MOVING;
      if (this.holdingBreath) flags |= PF.HOLDING_BREATH;
      net.send('g:move', { seq: this.seq, x: this.ctrl.x, y: this.ctrl.y, z: this.ctrl.z, yaw: this.ctrl.yaw, pitch: this.ctrl.pitch, flags });
      if (st === 'driving' && !modal) {
        const th = (this.input.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.input.has('KeyS', 'ArrowDown') ? 1 : 0);
        const sr = (this.input.has('KeyA', 'ArrowLeft') ? 1 : 0) - (this.input.has('KeyD', 'ArrowRight') ? 1 : 0);
        net.send('g:car', { throttle: th, steer: sr });
      }
    }

    // breath holding while hidden
    if (st === 'hidden' && this.holdingBreath) {
      this.breath -= dt;
      if (this.breath <= 0) this.holdingBreath = false;
    } else this.breath = Math.min(8, this.breath + dt * 0.6);

    this.updateCamera(dt, cin);
    this.updateWorldViews(dt);
    this.updateTargeting();
    this.updateAudio(dt);
    this.updateFx(dt);

    this.hudAcc += dt;
    if (this.hudAcc > 0.1) {
      this.hudAcc = 0;
      this.pushHud();
    }
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 1) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (this.post) this.post.renderFrame();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Debug-only free camera (enabled through window.__nower with ?debug). Purely visual. */
  debugCam: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;

  private updateCamera(dt: number, cin: Cinematic | null) {
    if (this.debugCam) {
      const d = this.debugCam;
      this.camera.position.set(d.x, d.y, d.z);
      this.camera.rotation.set(d.pitch, d.yaw, 0);
      this.cineOverlay = null;
      return;
    }
    const w = this.world;
    const me = w.me;
    const st = me.status;
    const L = w.level;
    const cam = this.camera;
    cam.fov += (store.getState().settings.fov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
    if (cin) {
      const shot = cin.update(dt);
      cam.position.copy(shot.pos);
      cam.lookAt(shot.look);
      if (cin.kind === 'captured') {
        // face the Nower as he grabs you
        const e = w.interpEnemy();
        cam.lookAt(e.x, e.y + 1.6, e.z);
      }
      if (shot.cue === 'metal') audio.play('door_slam', { x: cam.position.x + 30, y: 2, z: cam.position.z - 40 }, 0.8);
      if (shot.cue === 'thunder') audio.thunder(1);
      if (shot.cue === 'wake') audio.breath(0.8);
      if (shot.cue === 'distant') audio.phantom();
      this.screenFlash = Math.max(this.screenFlash, shot.flash);
      store.getState().set({ hud: { ...store.getState().hud }, introPlaying: cin.kind === 'intro' });
      this.cineOverlay = { fade: shot.fade, title: shot.title, subtitle: shot.subtitle };
      if (cin.done) this.endCinematic();
      return;
    }
    this.cineOverlay = null;
    if (st === 'hidden' && me.hide >= 0) {
      const h = L.hides[me.hide];
      const eye = h.kind === 'bed' ? 0.28 : h.kind === 'niche' ? 1.25 : 1.5;
      cam.position.set(h.inside[0], h.inside[1] + eye, h.inside[2]);
      cam.rotation.set(this.hideLook.pitch, h.yaw + this.hideLook.yaw, 0);
      return;
    }
    if (st === 'driving' || st === 'passenger') {
      const c = w.interpCar();
      const side = st === 'driving' ? -0.4 : 0.4;
      const fx = -Math.sin(c.yaw);
      const fz = -Math.cos(c.yaw);
      cam.position.set(c.x + -fz * side + fx * -0.25, 1.3, c.z + fx * side + fz * -0.25);
      cam.rotation.set(this.ctrl.pitch * 0.5, c.yaw + (this.ctrl.yaw - c.yaw) * 0, 0);
      cam.rotation.y = c.yaw + Math.max(-1.2, Math.min(1.2, angle(this.ctrl.yaw - c.yaw)));
      return;
    }
    if (st === 'escaped' || st === 'eliminated') {
      this.updateSpectate(dt);
      return;
    }
    // first person
    const bob = store.getState().settings.headBob ? Math.sin(this.ctrl.bob * Math.PI) * 0.035 * this.ctrl.bobAmount : 0;
    const sway = store.getState().settings.headBob ? Math.cos(this.ctrl.bob * Math.PI * 0.5) * 0.02 * this.ctrl.bobAmount : 0;
    let eye = this.ctrl.eye;
    if (st === 'trapped') eye = 1.2;
    if (st === 'climbing') eye = 1.4;
    cam.position.set(this.ctrl.x + sway * Math.cos(this.ctrl.yaw), this.ctrl.y + eye + bob, this.ctrl.z - sway * Math.sin(this.ctrl.yaw));
    cam.rotation.set(this.ctrl.pitch, this.ctrl.yaw, 0);
    if (this.held) {
      this.held.position.y += ((this.heldType && itemDef(this.heldType).heavy ? -0.45 : -0.28) + bob * 0.4 - this.held.position.y) * Math.min(1, dt * 10);
    }
  }

  cineOverlay: { fade: number; title: string | null; subtitle: string | null } | null = null;

  private endCinematic() {
    const kind = this.cinematic?.kind;
    this.cinematic = null;
    store.getState().set({ introPlaying: false });
    if (kind === 'intro') {
      store.getState().toast('Find a way out. Stay quiet. He is listening.', 'warn');
      if (!store.getState().seenTutorial) {
        store.getState().toast('WASD move · SHIFT sprint · CTRL/C crouch · E interact · G drop · F use · L flashlight · TAB journal', 'info');
        store.getState().markTutorial();
      }
      this.input.requestLock();
    }
    if (kind && kind !== 'intro' && kind !== 'captured') {
      this.personalDone = true;
      this.maybeShowEnding();
    }
  }

  private updateSpectate(dt: number) {
    const w = this.world;
    const alive = [...w.players.values()].filter((p) => p.id !== w.you && p.status !== 'escaped' && p.status !== 'eliminated');
    if (!this.spectate || !alive.some((p) => p.id === this.spectate)) this.spectate = alive[0]?.id ?? null;
    const cam = this.camera;
    if (this.spectate) {
      const ip = w.interpPlayer(this.spectate);
      if (ip) {
        const fx = -Math.sin(ip.yaw);
        const fz = -Math.cos(ip.yaw);
        const want = new THREE.Vector3(ip.x - fx * 2.4, ip.y + 2.1, ip.z - fz * 2.4);
        if (!lineOfSight(w.level, w.dyn, ip.x, ip.y + 1.6, ip.z, want.x, want.y, want.z)) want.set(ip.x - fx * 0.4, ip.y + 1.8, ip.z - fz * 0.4);
        cam.position.lerp(want, Math.min(1, dt * 5));
        cam.lookAt(ip.x + fx * 2, ip.y + 1.4, ip.z + fz * 2);
        return;
      }
    }
    this.orbit += dt * 0.05;
    cam.position.set(48 + Math.cos(this.orbit) * 60, 26, 36 + Math.sin(this.orbit) * 60);
    cam.lookAt(48, 4, 36);
  }

  private cullAcc = 1;

  /** Draw only nearby floors and chunks that are not lost in the fog. */
  private cull(outdoors: boolean) {
    const cam = this.camera.position;
    const fc = floorOfY(cam.y - 1.5);
    const maxD = outdoors ? 85 : 42;
    for (const c of this.static!.chunks) {
      const floorOk = outdoors && fc >= 2 ? c.floor >= 2 : Math.abs(c.floor - fc) <= 1;
      c.mesh.visible = floorOk && cam.distanceTo(c.center) - c.radius < maxD;
    }
  }

  private updateWorldViews(dt: number) {
    const w = this.world;
    for (const d of this.doors) d.update(dt);
    for (const c of this.static!.containers) c.update(dt);
    this.placeContainerItems();
    this.mechs.update(dt);
    this.water.update(dt);
    // car
    const c = w.interpCar();
    this.car.obj.visible = !w.car.escaped || this.cinematic?.kind === 'garage';
    this.car.pose(c.x, c.z, c.yaw, c.speed, c.steer, dt);
    if (this.cinematic?.kind === 'garage') this.car.pose(84 - this.cinematic.t * 6, 84, -Math.PI / 2, 6, 0, dt);
    audio.loop('engine', 'engine', { x: c.x, y: 0.8, z: c.z }, w.car.running && !w.car.escaped);
    const gp = w.level.mechs[w.level.mechById.get('generator')!].spec.pos;
    audio.loop('generator', 'generator', { x: gp[0], y: gp[1], z: gp[2] - 1 }, w.mechs.generator.running);
    const pp = w.level.mechs[w.level.mechById.get('pump_panel')!].spec.pos;
    audio.loop('pump', 'pump', { x: pp[0] - 1.6, y: pp[1], z: pp[2] + 1.6 }, w.mechs.pump.running);
    // enemy
    const e = w.interpEnemy();
    this.enemy.root.position.set(e.x, e.y, e.z);
    this.enemy.root.rotation.y = e.yaw + Math.PI;
    this.enemy.update(dt, ENEMY_ANIMS[e.anim] ?? 'idle', e.speed);
    this.enemy.root.visible = ENEMY_STATES[e.state] !== undefined;
    // remote players
    for (const [id, r] of this.remotes) {
      const p = w.players.get(id)!;
      const ip = w.interpPlayer(id);
      if (!ip || !r.model.root.visible) continue;
      r.model.root.position.set(ip.x, ip.y, ip.z);
      r.model.root.rotation.y = ip.yaw + Math.PI;
      const moved = Math.hypot(ip.x - r.last.x, ip.z - r.last.z);
      const sp = moved / Math.max(dt, 1e-3);
      r.model.update(dt, p.status === 'trapped' ? 0 : sp, !!(ip.flags & PF.CROUCH), ip.pitch, !!(ip.flags & PF.FLASH) && p.battery > 0);
      r.stride += moved;
      const crouch = !!(ip.flags & PF.CROUCH);
      const sprint = !!(ip.flags & PF.SPRINT);
      const len = crouch ? 0.55 : sprint ? 1.05 : 0.75;
      if (r.stride > len && moved < 2) {
        r.stride = 0;
        audio.footstep({ x: ip.x, y: ip.y, z: ip.z }, this.surfaceAt(ip.x, ip.y, ip.z), crouch ? 'crouch' : sprint ? 'sprint' : 'walk', 0.8);
      }
      const cell = floorOfY(ip.y) * 100000 + Math.floor(ip.z) * w.level.W + Math.floor(ip.x);
      if (cell !== r.lastCell) {
        r.lastCell = cell;
        if (cellFlags(w.level, floorOfY(ip.y), Math.floor(ip.x), Math.floor(ip.z)) & F.CREAKY) audio.play('creak', { x: ip.x, y: ip.y, z: ip.z }, crouch ? 0.3 : 0.8);
      }
      r.last.set(ip.x, ip.y, ip.z);
    }
    // projectiles
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt / 0.45;
      const k = Math.min(1, p.t);
      p.obj.position.lerpVectors(p.from, p.to, k);
      p.obj.position.y += Math.sin(k * Math.PI) * 0.8;
      p.obj.rotation.x += dt * 12;
      if (k >= 1) {
        this.scene.remove(p.obj);
        return false;
      }
      return true;
    });
    this.flashLight.intensity *= Math.pow(0.0001, dt);
    // lights, rain, sky, fog by zone
    const zone = this.zoneAt(this.camera.position);
    const outdoors = OUTDOOR_ZONES.includes(zone) || (zone === 'road' && this.camera.position.y > -1);
    this.cullAcc += dt;
    if (this.cullAcc > 0.2) {
      this.cullAcc = 0;
      this.cull(outdoors);
    }
    this.lights.update(dt, this.camera.position, this.danger);
    this.rain.update(dt, this.camera.position, outdoors && this.camera.position.y > -1);
    const fog = this.scene.fog as THREE.FogExp2;
    const targetDensity = zone === 'sewer' ? 0.085 : outdoors ? 0.032 : zone === 'basement' ? 0.07 : zone === 'attic' ? 0.065 : 0.05;
    fog.density += (targetDensity - fog.density) * Math.min(1, dt * 1.5);
    fog.color.lerp(new THREE.Color(zone === 'sewer' ? 0x050806 : outdoors ? 0x07090d : 0x040405), Math.min(1, dt * 1.5));
    this.moon.intensity += ((outdoors ? 3.2 : 0) - this.moon.intensity) * Math.min(1, dt * 2);
    this.hemi.intensity += ((outdoors ? 1.1 : 0.1) - this.hemi.intensity) * Math.min(1, dt * 2);
    const bright = store.getState().settings.brightness;
    this.ambient.intensity = (zone === 'sewer' ? 0.65 : 0.8) * bright;
    const skyMat = this.static!.sky.material as THREE.ShaderMaterial;
    skyMat.uniforms.flash.value = this.screenFlash;
    // flashlight
    const me = w.me;
    const on = this.flashOn && me.battery > 0 && me.status !== 'hidden' && me.status !== 'escaped' && me.status !== 'eliminated';
    this.flashlight.visible = on;
    if (on) {
      const low = me.battery < 0.15;
      this.flashlight.intensity = (low ? 30 : 70) * (low && Math.random() < 0.08 ? 0.2 : 1);
    }
  }

  private updateTargeting() {
    const w = this.world;
    const me = w.me;
    this.target = null;
    if (this.cinematic || store.getState().modal) return;
    const st = me.status;
    if (st === 'hidden') {
      const inter = resolveInteraction(w, me.id, `hide:${me.hide}`);
      if (inter) this.target = { info: { ref: `hide:${me.hide}`, pos: [0, 0, 0], f: 0, ignoreDoor: -1 }, inter };
      return;
    }
    if (st === 'driving' || st === 'passenger') {
      const inter = resolveInteraction(w, me.id, 'car:driver');
      if (inter) this.target = { info: { ref: 'car:driver', pos: [0, 0, 0], f: 0, ignoreDoor: -1 }, inter };
      return;
    }
    if (st !== 'free' && st !== 'caged') return;
    const now = performance.now();
    if (now - this.targetsAt > 250) {
      this.targetsAt = now;
      this.targets = listTargets(w).filter((t) => Math.abs(t.pos[0] - this.ctrl.x) < 6 && Math.abs(t.pos[2] - this.ctrl.z) < 6 && Math.abs(t.pos[1] - this.ctrl.y) < 4);
      for (const p of w.players.values()) {
        if (p.id === me.id || p.status !== 'trapped') continue;
        const ip = w.interpPlayer(p.id);
        if (ip) this.targets.push({ ref: `player:${p.id}`, pos: [ip.x, ip.y + 0.8, ip.z], f: floorOfY(ip.y), ignoreDoor: -1 });
      }
    }
    const cam = this.camera.position;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const room = roomAt(w.level, floorOfY(this.ctrl.y), this.ctrl.x, this.ctrl.z);
    let best: { info: TargetInfo; inter: Interaction; score: number } | null = null;
    for (const t of this.targets) {
      const dx = t.pos[0] - cam.x;
      const dy = t.pos[1] - cam.y;
      const dz = t.pos[2] - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > INTERACT_RANGE + 0.3 || d < 0.05) continue;
      const cos = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d;
      const tol = t.ref.startsWith('door') || t.ref.startsWith('car') || t.ref.startsWith('hide') ? 0.8 : 0.9;
      if (cos < tol) continue;
      const pull = Math.min(0.5, d * 0.5);
      if (!lineOfSight(w.level, w.dyn, cam.x, cam.y, cam.z, t.pos[0] - (dx / d) * pull, t.pos[1] - (dy / d) * pull, t.pos[2] - (dz / d) * pull, t.ignoreDoor)) continue;
      const inter = resolveInteraction(w, me.id, t.ref, room);
      if (!inter) continue;
      const score = (1 - cos) * 6 + d * 0.15 + (inter.enabled ? 0 : 0.2);
      if (!best || score < best.score) best = { info: t, inter, score };
    }
    if (best) this.target = { info: best.info, inter: best.inter };
  }

  // ---------------------------------------------------------------- audio
  private surfaceAt(x: number, y: number, z: number): Surface {
    const L = this.world.level;
    const f = floorOfY(y);
    const fl = cellFlags(L, f, Math.floor(x), Math.floor(z));
    if (fl & F.SHALLOW) return 'water';
    if (fl & F.GRATE) return 'metal';
    const ri = roomAt(L, f, x, z);
    return ri >= 0 ? surfaceOfFloorMat(L.rooms[ri].spec.floor) : 'stone';
  }

  private zoneAt(p: THREE.Vector3): Zone {
    const L = this.world.level;
    const f = floorOfY(p.y - 1.5);
    const ri = roomAt(L, f, p.x, p.z);
    return ri >= 0 ? L.rooms[ri].spec.zone : f <= 1 ? (f === 0 ? 'sewer' : 'basement') : 'garden';
  }

  private localStep(mode: 'crouch' | 'walk' | 'sprint') {
    audio.footstep(null, this.surfaceAt(this.ctrl.x, this.ctrl.y, this.ctrl.z), mode, mode === 'crouch' ? 0.35 : 0.55);
  }

  private creakCheck() {
    const L = this.world.level;
    const f = floorOfY(this.ctrl.y);
    const cell = f * 100000 + Math.floor(this.ctrl.z) * L.W + Math.floor(this.ctrl.x);
    if (cell === this.lastCell) return;
    this.lastCell = cell;
    if (this.world.me.status !== 'free') return;
    const fl = cellFlags(L, f, Math.floor(this.ctrl.x), Math.floor(this.ctrl.z));
    if (fl & F.CREAKY) audio.play('creak', null, this.ctrl.crouch ? 0.25 : 0.7);
  }

  private randomNear(dist: number) {
    const L = this.world.level;
    const cam = this.camera.position;
    const f = floorOfY(cam.y - 1.5);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const x = cam.x + Math.cos(a) * dist;
      const z = cam.z + Math.sin(a) * dist;
      const ff = f + (Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0);
      if (ff < 0 || ff > 4) continue;
      if (roomAt(L, ff, x, z) >= 0) return { x, y: (ff - 2) * 4 + 1.2, z };
    }
    return null;
  }

  /** 0 = clear line to the listener, 1 = behind walls/floors. */
  private occlusion(p: { x: number; y: number; z: number }) {
    const cam = this.camera.position;
    const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
    if (d < 1.5) return 0;
    const clear = lineOfSight(this.world.level, this.world.dyn, cam.x, cam.y, cam.z, p.x, p.y + 0.3, p.z);
    if (clear) return 0;
    const floors = Math.abs(floorOfY(p.y) - floorOfY(cam.y - 1.5));
    return Math.min(1, 0.6 + floors * 0.25);
  }

  private updateAudio(dt: number) {
    const w = this.world;
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    audio.setListener(cam.position, fwd.x, fwd.z, fwd.y);
    const zone = this.zoneAt(cam.position);
    const nearBuzz = this.world.level.lights.some((l) => l.kind === 'fluoro' && l.on && Math.hypot(l.pos[0] - cam.position.x, l.pos[2] - cam.position.z) < 6 && Math.abs(l.pos[1] - cam.position.y) < 3);
    audio.updateAmbience(zone, !OUTDOOR_ZONES.includes(zone), nearBuzz, dt);
    // the Nower's footsteps, breathing and voice
    const e = w.interpEnemy();
    const epos = new THREE.Vector3(e.x, e.y, e.z);
    const state = ENEMY_STATES[e.state];
    const d = epos.distanceTo(cam.position) + Math.abs(floorOfY(e.y) - floorOfY(cam.position.y - 1.5)) * 6;
    const moved = epos.distanceTo(this.enemyLast);
    if (moved < 3) this.enemyStride += moved;
    this.enemyLast.copy(epos);
    const chase = state === 'CHASE';
    if (this.enemyStride > (chase ? 0.95 : 0.7) && state !== 'DORMANT') {
      this.enemyStride = 0;
      this.enemyStep++;
      audio.enemy(this.enemyStep % 2 ? 'drag' : 'step', { x: e.x, y: e.y + 0.1, z: e.z }, chase ? 1.2 : 0.9);
      if (Math.random() < 0.3) audio.enemy('rustle', { x: e.x, y: e.y + 1, z: e.z }, 0.6);
    }
    const t = performance.now();
    if (d < 16 && t > this.enemyBreathAt && state !== 'DORMANT') {
      this.enemyBreathAt = t + (chase ? 1100 : 2600 + Math.random() * 800);
      audio.enemy(chase ? 'breathFast' : 'breath', { x: e.x, y: e.y + 1.6, z: e.z }, 0.9);
    }
    if (d < 30 && t > this.enemyVoiceAt && state !== 'DORMANT') {
      this.enemyVoiceAt = t + 7000 + Math.random() * 14000;
      audio.enemy(chase ? 'growl' : Math.random() < 0.6 ? 'mutter' : 'groan', { x: e.x, y: e.y + 1.6, z: e.z }, 0.9);
    }
    // danger & music
    const me = w.me;
    const targetMe = e.target === me.id;
    this.danger = Math.max(0, Math.min(1, 1 - d / 14)) * (state === 'DORMANT' ? 0 : 1);
    if (chase && targetMe) this.danger = Math.max(this.danger, 0.75);
    let ms: 'calm' | 'investigate' | 'chase' | 'hiding' | 'escape' = 'calm';
    if (w.alert === 'ESCAPE_IN_PROGRESS') ms = 'escape';
    if ((state === 'INVESTIGATE_SOUND' || state === 'INVESTIGATE_VISUAL' || state === 'SEARCH_AREA' || state === 'SEARCH_HIDING_SPOT') && d < 26) ms = 'investigate';
    if (me.status === 'hidden' && d < 18) ms = 'hiding';
    if ((chase && (targetMe || d < 22)) || state === 'ATTACK_OR_CAPTURE') ms = 'chase';
    if (me.status === 'escaped' || me.status === 'eliminated' || w.phase === 'ENDED') ms = 'calm';
    if (!this.cinematic || this.cinematic.kind !== 'intro') audio.music?.set(ms);
    // heartbeat when close; ragged breathing after sprinting
    if (this.danger > 0.35 && t > this.heartbeatAt) {
      this.heartbeatAt = t + 1000 - this.danger * 550;
      audio.heartbeat(this.danger);
    }
    if (this.ctrl.stamina < 0.4 && t > this.playerBreathAt && me.status === 'free') {
      this.playerBreathAt = t + 900 + this.ctrl.stamina * 1500;
      audio.breath(1 - this.ctrl.stamina);
    }
  }

  private updateFx(dt: number) {
    this.pulse = Math.max(0, this.pulse - dt * 0.4);
    this.screenFlash = Math.max(0, this.screenFlash - dt * 2.5);
    const me = this.world.me;
    const hideKind = me.status === 'hidden' && me.hide >= 0 ? this.world.level.hides[me.hide].kind : null;
    this.post?.set({
      time: performance.now() / 1000,
      danger: this.danger,
      pulse: me.status === 'captured' ? Math.max(this.pulse, 0.7) : this.pulse,
      flash: this.screenFlash,
      vignette: 1,
      brightness: store.getState().settings.brightness,
      hide: hideKind === 'wardrobe' || hideKind === 'locker' ? 1 : hideKind ? 0.55 : 0,
      desat: me.status === 'caged' ? 0.5 : me.status === 'eliminated' ? 1 : 0,
    });
  }

  // ---------------------------------------------------------------- HUD
  private pushHud() {
    const w = this.world;
    const me = w.me;
    const L = w.level;
    const now = performance.now();
    const tm: Teammate[] = [...w.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, status: p.status, connected: p.connected, captures: p.captures, escapedVia: p.escapedVia, you: p.id === me.id }));
    this.objAcc++;
    const prevObj = store.getState().hud.objectives;
    const objectives = this.objAcc % 10 === 1 || !prevObj.length ? computeObjectives(w) : prevObj;
    const heldItem = me.held ? w.items.get(me.held) : null;
    const def = heldItem ? itemDef(heldItem.type) : null;
    const secondary: string[] = [];
    if (def && me.status === 'free') {
      secondary.push('G — DROP');
      if (def.use === 'throw') secondary.push('F — THROW');
      if (def.use === 'decoy') secondary.push('F — WIND & SET DOWN');
      if (def.use === 'flash') secondary.push(`F — FLASH (${heldItem!.charges})`);
      secondary.push('I — INSPECT');
    }
    if (me.status === 'driving' && !w.car.running) secondary.push('F — START ENGINE');
    if (me.status === 'driving' && w.car.running) secondary.push('W/S — THROTTLE · A/D — STEER');
    if (me.status === 'hidden') secondary.push('HOLD SPACE — HOLD YOUR BREATH');
    const tuning = DIFFICULTY[w.difficulty];
    let cageText: string | null = null;
    if (me.status === 'caged') {
      const sr = tuning.selfReleaseSeconds;
      if (sr === null) cageText = 'Locked in the cage. Only a teammate can force it open.';
      else {
        const left = Math.ceil((me.cagedAt + sr * 1000 - w.now) / 1000);
        cageText = left > 0 ? `Locked in the cage. The latch might give in ${left}s — or wait for rescue.` : 'The latch is loose. Go to the cage door and work it (hold E).';
      }
    }
    const f = floorOfY(this.ctrl.y);
    const ri = roomAt(L, f, this.ctrl.x, this.ctrl.z);
    const hud: Hud = {
      prompt: this.target ? this.target.inter.label : null,
      promptEnabled: this.target ? this.target.inter.enabled : true,
      secondary,
      hold: this.holding ? { label: this.holding.label, progress: Math.min(1, (now - this.holding.start) / this.holding.dur) } : null,
      held: def ? { name: def.name, type: def.type, description: def.description, use: def.use } : null,
      stamina: this.ctrl.stamina,
      battery: me.battery,
      flashlight: this.flashOn,
      status: me.status,
      hideKind: me.status === 'hidden' && me.hide >= 0 ? L.hides[me.hide].kind : null,
      breath: this.breath,
      holdingBreath: this.holdingBreath,
      cageText,
      countdown: w.phase === 'COUNTDOWN' ? Math.max(0, Math.ceil((w.phaseEndsAt - w.now) / 1000)) : 0,
      phase: w.phase,
      alert: w.alert,
      danger: this.danger,
      heardAt: this.heardAt,
      spottedAt: this.spottedAt,
      teammates: tm,
      objectives,
      spectating: me.status === 'escaped' || me.status === 'eliminated' ? (this.spectate ? w.players.get(this.spectate)?.name ?? null : null) : null,
      driving: me.status === 'driving',
      carSpeed: Math.abs(w.car.speed),
      fps: this.fps,
      floorName: FLOOR_NAMES[f],
      roomName: ri >= 0 ? L.rooms[ri].spec.name : '',
      captureLimit: tuning.captureLimit,
    };
    store.getState().set({ hud });
  }

  private maybeShowEnding() {
    const w = this.world;
    if (this.endingShown || w.phase !== 'ENDED' || !w.result) return;
    const st = w.me.status;
    if ((st === 'escaped' || st === 'eliminated') && !this.personalDone && this.cinematic) return;
    this.endingShown = true;
    const players = [...w.players.values()];
    store.getState().set({
      ending: {
        result: w.result,
        escaped: players.filter((p) => p.status === 'escaped').map((p) => ({ name: p.name, route: p.escapedVia as EscapeRoute })),
        lost: players.filter((p) => p.status !== 'escaped').map((p) => p.name),
        durationSec: Math.round((Date.now() - this.matchStartedAt) / 1000),
      },
    });
    audio.music?.stinger(w.result === 'GAME_OVER' ? 'defeat' : 'victory');
    this.input.releaseLock();
  }

  // ---------------------------------------------------------------- input actions
  private async onAction(a: Action) {
    const st = store.getState();
    const w = this.world;
    const me = w.me;
    if (a === 'skip' && this.cinematic?.kind === 'intro') {
      this.cinematic = null;
      st.set({ introPlaying: false });
      this.cineOverlay = null;
      this.input.requestLock();
      return;
    }
    if (a === 'unlocked') {
      // the browser released the mouse (Esc while locked): open the pause menu unless a modal took it
      if (!st.modal && !st.ending && !this.cinematic) st.set({ modal: { kind: 'pause' } });
      return;
    }
    if (a === 'pause') {
      if (st.modal && st.modal.kind !== 'pause') st.set({ modal: null });
      else if (!st.ending) st.set({ modal: st.modal ? null : { kind: 'pause' } });
      if (st.modal) this.input.requestLock();
      return;
    }
    if (st.modal || this.cinematic) {
      if (a === 'journal' && st.modal?.kind === 'journal') st.set({ modal: null });
      return;
    }
    switch (a) {
      case 'interact': {
        if (me.status === 'escaped' || me.status === 'eliminated') return;
        const t = this.target;
        if (!t) return;
        if (!t.inter.enabled) {
          if (t.info.ref.startsWith('door:') && t.inter.label.startsWith('LOCKED')) audio.play('door_locked', { x: t.info.pos[0], y: t.info.pos[1], z: t.info.pos[2] }, 0.8);
          return;
        }
        const res = await net.emit<{ hold?: number; panel?: boolean; symbols?: string[]; note?: string }>('g:act', { ref: t.info.ref });
        if (!res.ok) {
          if (res.error && res.error !== 'Busy.') st.toast(res.error, 'warn');
          return;
        }
        if (res.data?.panel) {
          this.input.releaseLock();
          st.set({ modal: { kind: 'keypad', symbols: res.data.symbols ?? w.panelSymbols } });
        }
        if (res.data?.note) {
          this.input.releaseLock();
          st.set({ modal: { kind: 'note', id: res.data.note }, journal: [...w.journal] });
        }
        if (t.info.ref === 'mech:final_wheel' && res.data?.hold) this.mechs.wheelSpin = res.data.hold / 1000;
        if (t.info.ref === 'mech:winch' && res.data?.hold) this.mechs.winchSpin = res.data.hold / 1000;
        return;
      }
      case 'interactUp':
        if (this.holding) {
          net.socket?.emit('g:holdStop');
          this.holding = null;
        }
        return;
      case 'drop':
        if (me.held && me.status === 'free') await net.emit('g:drop');
        return;
      case 'use':
        if (me.status === 'driving' || (me.held && me.status === 'free')) {
          const r = await net.emit('g:use', { yaw: this.ctrl.yaw, pitch: this.ctrl.pitch });
          if (!r.ok && r.error && me.status !== 'driving') st.toast(r.error, 'warn');
        }
        return;
      case 'flashlight':
        if (me.battery <= 0) {
          st.toast('The flashlight is dead. Find batteries.', 'warn');
          this.flashOn = false;
        } else this.flashOn = !this.flashOn;
        audio.play('install', null, 0.25);
        return;
      case 'journal':
        this.input.releaseLock();
        st.set({ modal: { kind: 'journal' }, journal: [...w.journal] });
        return;
      case 'inspect': {
        if (!me.held) return;
        const type = w.items.get(me.held)!.type;
        this.input.releaseLock();
        if (type === 'cipher_plate') {
          const r = await net.emit<{ cipher?: { symbol: string; digit: number }[] }>('g:inspect');
          st.set({ modal: { kind: 'inspect', type, cipher: r.data?.cipher } });
        } else st.set({ modal: { kind: 'inspect', type } });
        return;
      }
      case 'breathOn':
        if (me.status === 'hidden' && this.breath > 0.5) {
          this.holdingBreath = true;
          net.socket?.emit('g:breath', { holding: true });
        }
        return;
      case 'breathOff':
        if (this.holdingBreath) {
          this.holdingBreath = false;
          net.socket?.emit('g:breath', { holding: false });
        }
        return;
      case 'spectateNext': {
        if (me.status !== 'escaped' && me.status !== 'eliminated') return;
        const alive = [...w.players.values()].filter((p) => p.id !== me.id && p.status !== 'escaped' && p.status !== 'eliminated');
        const i = alive.findIndex((p) => p.id === this.spectate);
        this.spectate = alive[(i + 1) % Math.max(1, alive.length)]?.id ?? null;
        return;
      }
    }
  }

  requestLock() {
    this.input.requestLock();
  }

  releaseLock() {
    this.input.releaseLock();
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const [ev, h] of this.handlers) net.socket?.off(ev, h as never);
    this.input.releaseLock();
    this.input.dispose();
    window.removeEventListener('resize', this.onResize);
    audio.stopAllLoops();
    audio.randomNear = null;
    audio.occlusionOf = null;
    if (this.static) this.scene.remove(this.static.root);
    this.post?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function angle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
