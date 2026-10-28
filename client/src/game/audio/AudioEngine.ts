/**
 * Audio engine: mix buses (music / sfx / ambient / enemy), HRTF positional voices with wall
 * occlusion, a zone-dependent reverb send, continuous ambience beds and random unsettling
 * events. All sound is synthesized at runtime.
 */
import type { SoundName, Surface, Zone } from '@nower/shared';
import type { Settings } from '../../state/store';
import { Music } from './music';
import { enemyBreath, enemyFootstep, enemyGroan, enemyGrowl, enemyHmm, enemyScream, footstep, play, rustle } from './sounds';
import { creak, modal, mutter, noise, noiseBuffers, thump, tone, type Out } from './synth';

type Bus = 'music' | 'sfx' | 'ambient' | 'enemy';
export interface Vec {
  x: number;
  y: number;
  z: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private beds: Record<string, GainNode> = {};
  private zone: Zone = 'mansion';
  private nextEvent = 0;
  music: Music | null = null;
  /** Position resolver for random events (set by the game). */
  randomNear: ((dist: number) => Vec | null) | null = null;
  occlusionOf: ((p: Vec) => number) | null = null;
  private loops = new Map<string, { gain: GainNode; panner: PannerNode; stop: () => void }>();

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    for (const b of ['music', 'sfx', 'ambient', 'enemy'] as Bus[]) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.25;
    this.reverbSend.connect(this.reverb).connect(this.master);
    noiseBuffers(ctx);
    this.buildBeds();
    this.music = new Music(ctx, this.buses.music);
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get now() {
    return this.ctx?.currentTime ?? 0;
  }

  applySettings(s: Settings) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(s.music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.buses.ambient.gain.setTargetAtTime(s.ambient, t, 0.05);
    this.buses.enemy.gain.setTargetAtTime(s.enemy, t, 0.05);
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  setListener(pos: Vec, fx: number, fz: number, fy = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Builds a positional voice chain: panner -> occlusion lowpass -> gain -> bus (+ reverb). */
  private voice(pos: Vec | null, bus: Bus, volume: number, refDistance = 1.5, rolloff = 1.4): Out | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(this.buses[bus]);
    g.connect(this.reverbSend);
    if (!pos) return { ctx, dest: g, t: ctx.currentTime + 0.01, gain: volume };
    const occ = this.occlusionOf ? this.occlusionOf(pos) : 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 18000 - occ * 17000;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = rolloff;
    p.maxDistance = 200;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(lp).connect(g);
    return { ctx, dest: p, t: ctx.currentTime + 0.01, gain: volume * (1 - occ * 0.55) };
  }

  play(name: SoundName, pos: Vec | null, volume = 1, bus: Bus = 'sfx') {
    const o = this.voice(pos, bus, volume, name === 'alarm' || name === 'car_start' || name === 'floodgate' || name === 'gate_crash' ? 6 : 1.6);
    if (o) play(o, name);
  }

  footstep(pos: Vec | null, surface: Surface, mode: 'crouch' | 'walk' | 'sprint', volume = 1) {
    const o = this.voice(pos, 'sfx', volume, 1.2, 1.8);
    if (o) footstep(o, surface, mode);
  }

  enemy(kind: 'step' | 'drag' | 'breath' | 'breathFast' | 'growl' | 'scream' | 'hmm' | 'groan' | 'mutter' | 'rustle', pos: Vec, volume = 1) {
    const o = this.voice(pos, 'enemy', volume, kind === 'scream' ? 5 : 1.6, 1.3);
    if (!o) return;
    switch (kind) {
      case 'step':
      case 'drag':
        enemyFootstep(o, kind === 'drag');
        break;
      case 'breath':
      case 'breathFast':
        enemyBreath(o, kind === 'breathFast');
        break;
      case 'growl':
        enemyGrowl(o);
        break;
      case 'scream':
        enemyScream(o);
        break;
      case 'hmm':
        enemyHmm(o);
        break;
      case 'groan':
        enemyGroan(o);
        break;
      case 'mutter':
        mutter(o, 5 + Math.floor(Math.random() * 6), 100, 0.3);
        break;
      case 'rustle':
        rustle(o);
        break;
    }
  }

  /** Local player body sounds (non-positional). */
  breath(intensity: number) {
    const o = this.voice(null, 'sfx', 0.18 + intensity * 0.4);
    if (!o) return;
    noise(o, { dur: 0.5, type: 'bandpass', freq: 900, freqEnd: 1400, q: 2, gain: 0.25, attack: 0.25 });
    noise(o, { dur: 0.6, type: 'bandpass', freq: 700, freqEnd: 450, q: 2, gain: 0.2, attack: 0.05, delay: 0.5 });
  }

  heartbeat(intensity: number) {
    const o = this.voice(null, 'sfx', 0.3 + intensity * 0.7);
    if (!o) return;
    thump(o, 52, 0.12, 0.8);
    thump(o, 48, 0.14, 0.6, 0.22);
  }

  /** A sound with no gameplay meaning, for uncertainty. */
  phantom() {
    const p = this.randomNear?.(8 + Math.random() * 18);
    if (!p) return;
    const o = this.voice(p, 'ambient', 0.6 + Math.random() * 0.4, 2, 1);
    if (!o) return;
    const r = Math.random();
    if (r < 0.3) creak(o, 0.5 + Math.random() * 0.8, 300 + Math.random() * 700, 0.3);
    else if (r < 0.5) {
      thump(o, 70, 0.15, 0.6);
      thump(o, 70, 0.15, 0.5, 0.45 + Math.random() * 0.3);
    } else if (r < 0.65) enemyFootstep(o, true);
    else if (r < 0.75) modal(o, [180, 470, 1100], 1.2, 0.25);
    else if (r < 0.85) mutter({ ...o, gain: o.gain * 0.4 }, 4, 90, 0.2);
    else noise(o, { dur: 0.8, type: 'bandpass', freq: 300, q: 1, gain: 0.3, attack: 0.2, brown: true });
  }

  thunder(distance = 1) {
    const o = this.voice(null, 'ambient', 0.9 / distance);
    if (!o) return;
    noise(o, { dur: 0.2, type: 'highpass', freq: 1500, gain: 0.25 });
    noise(o, { dur: 5, type: 'lowpass', freq: 220, freqEnd: 60, gain: 0.9, attack: 0.15, brown: true, delay: 0.25 + Math.random() * 1.5 });
  }

  // --------------------------------------------------------------- ambience beds
  private bedSource(kind: 'white' | 'brown', type: BiquadFilterType, freq: number, q = 0.7, lfoRate = 0, lfoDepth = 0): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = kind === 'white' ? noiseBuffers(ctx).white : noiseBuffers(ctx).brown;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (lfoRate) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = lfoRate;
      lg.gain.value = lfoDepth;
      lfo.connect(lg).connect(f.frequency);
      lfo.start();
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.buses.ambient);
    src.start();
    return g;
  }

  private buildBeds() {
    const ctx = this.ctx!;
    this.beds.wind = this.bedSource('white', 'bandpass', 400, 0.8, 0.07, 250);
    this.beds.rain = this.bedSource('white', 'highpass', 2500, 0.5);
    this.beds.room = this.bedSource('brown', 'lowpass', 180);
    this.beds.water = this.bedSource('brown', 'lowpass', 700, 0.5, 0.3, 200);
    // electrical buzz
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 50;
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 400;
    bf.Q.value = 3;
    const bg = ctx.createGain();
    bg.gain.value = 0;
    osc.connect(bf).connect(bg).connect(this.buses.ambient);
    osc.start();
    this.beds.buzz = bg;
  }

  /** Crossfades ambience to the listener's zone; schedules random events. */
  updateAmbience(zone: Zone, indoors: boolean, nearBuzz: boolean, dt: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.zone = zone;
    const t = ctx.currentTime;
    const outdoor = zone === 'garden' || zone === 'yard' || zone === 'road';
    const target: Record<string, number> = {
      wind: outdoor ? 0.35 : zone === 'attic' ? 0.22 : indoors ? 0.07 : 0.15,
      rain: outdoor ? 0.16 : zone === 'attic' || zone === 'garage' ? 0.08 : zone === 'sewer' || zone === 'basement' ? 0 : 0.03,
      room: zone === 'basement' ? 0.5 : zone === 'sewer' ? 0.35 : outdoor ? 0.1 : 0.32,
      water: zone === 'sewer' ? 0.35 : zone === 'basement' ? 0.04 : 0,
      buzz: nearBuzz ? 0.025 : 0,
    };
    for (const [k, v] of Object.entries(target)) this.beds[k]?.gain.setTargetAtTime(v, t, 0.8);
    this.reverbSend.gain.setTargetAtTime(zone === 'sewer' ? 0.7 : zone === 'basement' ? 0.45 : outdoor ? 0.12 : zone === 'attic' ? 0.2 : 0.28, t, 0.5);
    this.nextEvent -= dt;
    if (this.nextEvent <= 0) {
      this.nextEvent = 5 + Math.random() * 14;
      this.ambientEvent(zone);
    }
  }

  private ambientEvent(zone: Zone) {
    const r = Math.random();
    if ((zone === 'garden' || zone === 'yard' || zone === 'road') && r < 0.25) return this.thunder(1);
    if (r < 0.12) return this.thunder(2.5);
    if (zone === 'sewer' || zone === 'basement') {
      const p = this.randomNear?.(3 + Math.random() * 10);
      const o = p && this.voice(p, 'ambient', 0.5, 1.5, 1);
      if (o) {
        if (Math.random() < 0.6) for (let i = 0; i < 3; i++) tone(o, { freq: 1400 + Math.random() * 900, freqEnd: 600, dur: 0.07, gain: 0.25, delay: i * (0.4 + Math.random()) });
        else for (let i = 0; i < 4; i++) modal(o, [300 + Math.random() * 200, 900], 0.25, 0.2, i * 0.15);
      }
      return;
    }
    if (r < 0.5) this.phantom();
    else {
      const p = this.randomNear?.(4 + Math.random() * 10);
      const o = p && this.voice(p, 'ambient', 0.5, 1.5, 1);
      if (o) creak(o, 0.6 + Math.random(), 250 + Math.random() * 400, 0.3);
    }
  }

  // --------------------------------------------------------------- positional loops
  /** Continuous positional machine loops (generator, pump, car engine). */
  loop(id: string, kind: 'generator' | 'pump' | 'engine', pos: Vec, on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    let l = this.loops.get(id);
    if (on && !l) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.refDistance = kind === 'engine' ? 4 : 3;
      p.rolloffFactor = 1.2;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(kind === 'engine' ? 0.5 : 0.4, ctx.currentTime, 0.4);
      p.connect(gain).connect(this.buses.sfx);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = kind === 'engine' ? 38 : kind === 'generator' ? 30 : 46;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = kind === 'pump' ? 220 : 380;
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = kind === 'engine' ? 13 : 9;
      lg.gain.value = 0.35;
      const am = ctx.createGain();
      am.gain.value = 0.65;
      lfo.connect(lg).connect(am.gain);
      osc.connect(f).connect(am).connect(p);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffers(ctx).brown;
      src.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'lowpass';
      nf.frequency.value = kind === 'pump' ? 900 : 500;
      const ng = ctx.createGain();
      ng.gain.value = 0.5;
      src.connect(nf).connect(ng).connect(p);
      osc.start();
      lfo.start();
      src.start();
      l = {
        gain,
        panner: p,
        stop: () => {
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
          setTimeout(() => {
            osc.stop();
            lfo.stop();
            src.stop();
          }, 2000);
        },
      };
      this.loops.set(id, l);
    }
    if (l) {
      l.panner.positionX.value = pos.x;
      l.panner.positionY.value = pos.y;
      l.panner.positionZ.value = pos.z;
      if (!on) {
        l.stop();
        this.loops.delete(id);
      }
    }
  }

  stopAllLoops() {
    for (const l of this.loops.values()) l.stop();
    this.loops.clear();
  }

  /** Menu ambience: wind, rain, distant thunder. */
  menuMode(on: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.beds.wind.gain.setTargetAtTime(on ? 0.28 : 0, t, 1);
    this.beds.rain.gain.setTargetAtTime(on ? 0.1 : 0, t, 1);
    this.beds.room.gain.setTargetAtTime(on ? 0.15 : 0, t, 1);
    this.beds.water.gain.setTargetAtTime(0, t, 1);
    this.beds.buzz.gain.setTargetAtTime(0, t, 1);
    this.music?.setMenu(on);
  }

  menuTick(dt: number) {
    this.nextEvent -= dt;
    if (this.nextEvent <= 0) {
      this.nextEvent = 8 + Math.random() * 12;
      if (Math.random() < 0.6) this.thunder(1.5 + Math.random() * 2);
    }
  }

  uiClick() {
    const o = this.voice(null, 'sfx', 0.4);
    if (o) {
      noise(o, { dur: 0.05, type: 'bandpass', freq: 1800, q: 2, gain: 0.25 });
      tone(o, { freq: 140, freqEnd: 90, dur: 0.12, gain: 0.15 });
    }
  }
}

export const audio = new AudioEngine();
