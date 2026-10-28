/**
 * Generative layered horror score. Layers (drone, tension, chase, escape) fade with game
 * intensity; a hiding state low-passes everything; stingers mark spotted / capture / endings.
 * Long stretches stay near-silent on purpose so real gameplay sounds stay readable.
 */
import { distortion, modal, noise, thump, tone, type Out } from './synth';

export type MusicState = 'menu' | 'calm' | 'investigate' | 'chase' | 'hiding' | 'escape' | 'silent';

export class Music {
  private out: GainNode;
  private filter: BiquadFilterNode;
  private layers: Record<'drone' | 'tension' | 'chase' | 'escape', GainNode>;
  private state: MusicState = 'silent';
  private timer: ReturnType<typeof setInterval>;
  private nextBeat = 0;
  private nextPlink = 0;
  private step = 0;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.out = ctx.createGain();
    this.out.connect(this.filter).connect(dest);
    const mk = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      return g;
    };
    this.layers = { drone: mk(), tension: mk(), chase: mk(), escape: mk() };
    // drone: detuned low tones beating against each other + breathy noise
    for (const [f, det] of [
      [55, 0],
      [55.6, 0],
      [82.4, -3],
      [116.5, 4],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = f > 100 ? 0.04 : 0.12;
      o.connect(g).connect(this.layers.drone);
      o.start();
    }
    // tension: a slow high cluster a semitone apart
    for (const f of [622.25, 659.25, 698.46]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 0.1 + Math.random() * 0.2;
      lg.gain.value = 0.02;
      const g = ctx.createGain();
      g.gain.value = 0.02;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(this.layers.tension);
      o.start();
      lfo.start();
    }
    // chase: dissonant distorted saws
    const ws = distortion(ctx, 8);
    const cf = ctx.createBiquadFilter();
    cf.type = 'lowpass';
    cf.frequency.value = 1400;
    ws.connect(cf).connect(this.layers.chase);
    for (const f of [73.4, 77.8, 110, 155.6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o.connect(g).connect(ws);
      o.start();
    }
    this.timer = setInterval(() => this.schedule(), 50);
  }

  private o(gain: number, dest: AudioNode = this.out): Out {
    return { ctx: this.ctx, dest, t: Math.max(this.ctx.currentTime + 0.02, this.nextBeat), gain };
  }

  set(state: MusicState) {
    if (state === this.state) return;
    this.state = state;
    const t = this.ctx.currentTime;
    const target = {
      menu: { drone: 0.5, tension: 0.15, chase: 0, escape: 0 },
      calm: { drone: 0.35, tension: 0, chase: 0, escape: 0 },
      investigate: { drone: 0.45, tension: 0.55, chase: 0, escape: 0 },
      chase: { drone: 0.4, tension: 0.4, chase: 0.6, escape: 0 },
      hiding: { drone: 0.25, tension: 0.35, chase: 0, escape: 0 },
      escape: { drone: 0.3, tension: 0.2, chase: 0.15, escape: 0.6 },
      silent: { drone: 0, tension: 0, chase: 0, escape: 0 },
    }[state];
    for (const [k, v] of Object.entries(target)) this.layers[k as keyof typeof this.layers].gain.setTargetAtTime(v, t, state === 'chase' ? 0.3 : 1.8);
    this.filter.frequency.setTargetAtTime(state === 'hiding' ? 500 : 18000, t, 0.6);
  }

  setMenu(on: boolean) {
    this.set(on ? 'menu' : 'silent');
  }

  get current() {
    return this.state;
  }

  private schedule() {
    const now = this.ctx.currentTime;
    if (this.nextBeat < now) this.nextBeat = now + 0.05;
    if (this.nextBeat > now + 0.25) return;
    const st = this.state;
    if (st === 'chase') {
      // pounding 150 bpm pulse with metallic ticks
      const beat = 60 / 150;
      thump(this.o(0.55, this.layers.chase), 50, 0.16, 0.9);
      if (this.step % 2 === 1) noise(this.o(0.3, this.layers.chase), { dur: 0.05, type: 'highpass', freq: 5000, gain: 0.3 });
      if (this.step % 8 === 0) modal(this.o(0.25, this.layers.chase), [233, 247, 466], 0.9, 0.2);
      this.step++;
      this.nextBeat += beat / 2;
      return;
    }
    if (st === 'investigate' || st === 'hiding') {
      // slow heartbeat-like double pulse
      thump(this.o(st === 'hiding' ? 0.6 : 0.45, this.layers.tension), 45, 0.18, 0.7);
      thump(this.o(st === 'hiding' ? 0.45 : 0.35, this.layers.tension), 42, 0.2, 0.6, 0.28);
      this.nextBeat += st === 'hiding' ? 0.85 : 1.0;
      return;
    }
    if (st === 'escape') {
      const pattern = [0, 3, 7, 3, 10, 7, 3, 1];
      const f = 146.8 * Math.pow(2, pattern[this.step % 8] / 12);
      tone(this.o(0.3, this.layers.escape), { freq: f, dur: 0.35, type: 'triangle', gain: 0.4 });
      if (this.step % 4 === 0) thump(this.o(0.4, this.layers.escape), 55, 0.2, 0.6);
      this.step++;
      this.nextBeat += Math.max(0.16, 0.26 - this.step * 0.0008);
      return;
    }
    if (st === 'calm' || st === 'menu') {
      // sparse, detuned "music box" plinks with long silences
      if (now > this.nextPlink) {
        this.nextPlink = now + 9 + Math.random() * 16;
        const notes = [523.25, 554.37, 622.25, 698.46, 739.99];
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) modal({ ctx: this.ctx, dest: this.out, t: now + 0.1 + i * (0.5 + Math.random() * 0.6), gain: 0.25 }, [notes[Math.floor(Math.random() * notes.length)] * (1 + (Math.random() - 0.5) * 0.02), 2093 * 1.01], 2.4, 0.18);
      }
    }
    this.nextBeat = now + 0.2;
  }

  stinger(kind: 'spotted' | 'capture' | 'victory' | 'defeat' | 'escape') {
    const t = this.ctx.currentTime + 0.01;
    const o: Out = { ctx: this.ctx, dest: this.out, t, gain: 1 };
    switch (kind) {
      case 'spotted':
        for (const f of [220, 233, 311]) tone(o, { freq: f, freqEnd: f * 1.5, dur: 1.4, type: 'sawtooth', gain: 0.12, filter: 2500, attack: 0.01 });
        thump(o, 40, 0.5, 1);
        break;
      case 'capture':
        noise(o, { dur: 1.5, type: 'lowpass', freq: 3000, freqEnd: 100, gain: 0.8 });
        for (const f of [98, 104, 147]) tone(o, { freq: f, freqEnd: f / 2, dur: 3, type: 'sawtooth', gain: 0.2, filter: 1200 });
        break;
      case 'escape':
        for (const f of [293.7, 349.2, 440]) tone(o, { freq: f, dur: 2.5, type: 'triangle', gain: 0.12, attack: 0.4 });
        break;
      case 'victory':
        for (const [f, d] of [
          [196, 0],
          [246.9, 0.4],
          [293.7, 0.8],
          [369.9, 1.2],
          [440, 1.6],
        ])
          tone(o, { freq: f, dur: 6, type: 'triangle', gain: 0.12, attack: 1.2, delay: d });
        break;
      case 'defeat':
        thump(o, 35, 1.5, 1);
        for (const f of [110, 116.5, 164.8]) tone(o, { freq: f, freqEnd: f * 0.5, dur: 6, type: 'sawtooth', gain: 0.12, filter: 800, attack: 0.5 });
        break;
    }
  }

  dispose() {
    clearInterval(this.timer);
  }
}
