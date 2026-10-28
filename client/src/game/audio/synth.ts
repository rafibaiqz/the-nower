/** Low-level Web Audio synthesis primitives (noise bursts, tones, modal impacts, creaks). */

export interface Out {
  ctx: AudioContext;
  dest: AudioNode;
  t: number;
  gain: number;
}

const buffers = new WeakMap<AudioContext, { white: AudioBuffer; brown: AudioBuffer }>();

export function noiseBuffers(ctx: AudioContext) {
  let b = buffers.get(ctx);
  if (b) return b;
  const len = ctx.sampleRate * 2;
  const white = ctx.createBuffer(1, len, ctx.sampleRate);
  const brown = ctx.createBuffer(1, len, ctx.sampleRate);
  const w = white.getChannelData(0);
  const br = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    w[i] = Math.random() * 2 - 1;
    last = (last + 0.02 * w[i]) / 1.02;
    br[i] = last * 3.5;
  }
  b = { white, brown };
  buffers.set(ctx, b);
  return b;
}

/** Filtered noise burst with an attack/decay envelope. */
export function noise(o: Out, opts: { dur: number; type?: BiquadFilterType; freq?: number; q?: number; freqEnd?: number; attack?: number; gain?: number; brown?: boolean; delay?: number }) {
  const { ctx } = o;
  const t = o.t + (opts.delay ?? 0);
  const src = ctx.createBufferSource();
  const nb = noiseBuffers(ctx);
  src.buffer = opts.brown ? nb.brown : nb.white;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = opts.type ?? 'bandpass';
  f.frequency.setValueAtTime(opts.freq ?? 1000, t);
  if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t + opts.dur);
  f.Q.value = opts.q ?? 1;
  const g = ctx.createGain();
  const peak = (opts.gain ?? 0.5) * o.gain;
  const a = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  src.connect(f).connect(g).connect(o.dest);
  src.start(t, Math.random() * 1.5);
  src.stop(t + opts.dur + 0.05);
}

/** Oscillator tone with pitch glide and envelope. */
export function tone(o: Out, opts: { freq: number; freqEnd?: number; dur: number; type?: OscillatorType; attack?: number; gain?: number; delay?: number; filter?: number; vibrato?: number }) {
  const { ctx } = o;
  const t = o.t + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(10, opts.freqEnd), t + opts.dur);
  let node: AudioNode = osc;
  if (opts.filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.filter;
    osc.connect(f);
    node = f;
  }
  if (opts.vibrato) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 5 + Math.random() * 2;
    lg.gain.value = opts.vibrato;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + opts.dur + 0.05);
  }
  const g = ctx.createGain();
  const a = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, (opts.gain ?? 0.3) * o.gain), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  node.connect(g).connect(o.dest);
  osc.start(t);
  osc.stop(t + opts.dur + 0.05);
}

/** Sum of decaying sine partials: metallic clangs, bells, glass. */
export function modal(o: Out, freqs: number[], decay: number, gain = 0.3, delay = 0) {
  freqs.forEach((f, i) => tone(o, { freq: f * (1 + (Math.random() - 0.5) * 0.01), dur: decay * (1 - i * 0.12), gain: gain / (1 + i * 0.6), delay, attack: 0.002 }));
}

/** Stick-slip creak: a low pulse train through resonant filters. */
export function creak(o: Out, dur: number, base = 900, gain = 0.25, delay = 0) {
  const { ctx } = o;
  const t = o.t + delay;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const steps = 12;
  osc.frequency.setValueAtTime(18 + Math.random() * 20, t);
  for (let i = 1; i <= steps; i++) osc.frequency.linearRampToValueAtTime(12 + Math.random() * 45, t + (dur * i) / steps);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.setValueAtTime(base, t);
  f1.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.6), t + dur);
  f1.Q.value = 9;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = base * 2.3;
  f2.Q.value = 6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain * o.gain * 4, t + 0.04);
  g.gain.setValueAtTime(gain * o.gain * 4, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(f1).connect(g);
  osc.connect(f2).connect(g);
  g.connect(o.dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Low thump (body impacts, footsteps). */
export function thump(o: Out, freq = 80, dur = 0.12, gain = 0.5, delay = 0) {
  tone(o, { freq, freqEnd: freq * 0.55, dur, gain, delay, attack: 0.002 });
  noise(o, { dur: dur * 0.5, type: 'lowpass', freq: 600, gain: gain * 0.4, delay });
}

/** Speech-like gibberish: buzz through two moving formants. */
export function mutter(o: Out, syllables: number, pitch = 105, gain = 0.25) {
  const { ctx } = o;
  let t = o.t;
  const vowels = [
    [700, 1100],
    [400, 2000],
    [300, 900],
    [600, 1700],
    [350, 700],
  ];
  for (let i = 0; i < syllables; i++) {
    const d = 0.08 + Math.random() * 0.16;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(pitch * (0.9 + Math.random() * 0.25), t);
    osc.frequency.linearRampToValueAtTime(pitch * (0.8 + Math.random() * 0.3), t + d);
    const [f1, f2] = vowels[Math.floor(Math.random() * vowels.length)];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * o.gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    for (const [fq, q] of [
      [f1, 6],
      [f2, 9],
    ]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = q;
      osc.connect(bp).connect(g);
    }
    g.connect(o.dest);
    osc.start(t);
    osc.stop(t + d + 0.03);
    t += d + Math.random() * 0.07;
  }
}

/** Soft-clipping curve for distorted screams. */
export function distortion(ctx: AudioContext, amount = 30): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  ws.curve = curve;
  return ws;
}
