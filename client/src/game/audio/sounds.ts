/** Every gameplay sound as a synthesized recipe. */
import type { SoundName, Surface } from '@nower/shared';
import { creak, distortion, modal, mutter, noise, thump, tone, type Out } from './synth';

export function footstep(o: Out, surface: Surface, mode: 'crouch' | 'walk' | 'sprint') {
  const v = mode === 'crouch' ? 0.35 : mode === 'sprint' ? 1.25 : 0.8;
  const p = { ...o, gain: o.gain * v };
  switch (surface) {
    case 'wood':
      thump(p, 95, 0.09, 0.35);
      noise(p, { dur: 0.06, type: 'bandpass', freq: 900, q: 0.8, gain: 0.18 });
      break;
    case 'carpet':
      noise(p, { dur: 0.08, type: 'lowpass', freq: 500, gain: 0.25 });
      break;
    case 'tile':
      noise(p, { dur: 0.035, type: 'highpass', freq: 2400, gain: 0.25 });
      thump(p, 120, 0.06, 0.2);
      break;
    case 'metal':
      modal(p, [420, 1130, 2210, 3300], 0.28, 0.12);
      thump(p, 90, 0.08, 0.25);
      break;
    case 'grass':
      noise(p, { dur: 0.14, type: 'bandpass', freq: 3500, q: 0.6, gain: 0.12, attack: 0.02 });
      break;
    case 'gravel':
      for (let i = 0; i < 5; i++) noise(p, { dur: 0.03, type: 'bandpass', freq: 2500 + Math.random() * 2500, q: 2, gain: 0.12, delay: Math.random() * 0.1 });
      thump(p, 80, 0.06, 0.15);
      break;
    case 'water':
      noise(p, { dur: 0.25, type: 'bandpass', freq: 400, freqEnd: 1600, q: 1.5, gain: 0.3, attack: 0.02 });
      tone(p, { freq: 300 + Math.random() * 200, freqEnd: 900, dur: 0.08, gain: 0.05, delay: 0.05 });
      break;
    case 'dirt':
      noise(p, { dur: 0.08, type: 'lowpass', freq: 400, gain: 0.25 });
      break;
    default:
      noise(p, { dur: 0.05, type: 'bandpass', freq: 1600, q: 0.8, gain: 0.2 });
      thump(p, 100, 0.07, 0.25);
  }
}

export function enemyFootstep(o: Out, drag: boolean) {
  thump(o, 55, 0.18, 0.7);
  noise(o, { dur: 0.1, type: 'lowpass', freq: 400, gain: 0.3 });
  if (drag) noise(o, { dur: 0.35, type: 'bandpass', freq: 900, freqEnd: 500, q: 1.2, gain: 0.18, attack: 0.08, delay: 0.1 });
}

export function enemyBreath(o: Out, fast: boolean) {
  const d = fast ? 0.45 : 1.1;
  noise(o, { dur: d, type: 'bandpass', freq: 700, freqEnd: 1300, q: 3, gain: 0.35, attack: d * 0.6 });
  noise(o, { dur: d * 1.1, type: 'bandpass', freq: 500, freqEnd: 300, q: 2.5, gain: 0.3, attack: 0.05, delay: d });
  tone(o, { freq: 85, dur: d * 0.9, type: 'sawtooth', gain: 0.04, filter: 400, delay: d, attack: 0.1 });
}

export function enemyGrowl(o: Out) {
  const { ctx } = o;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(62, o.t);
  osc.frequency.linearRampToValueAtTime(48, o.t + 1.2);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 420;
  f.Q.value = 3;
  const trem = ctx.createOscillator();
  const tg = ctx.createGain();
  trem.frequency.value = 23;
  tg.gain.value = 0.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.exponentialRampToValueAtTime(0.5 * o.gain, o.t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + 1.3);
  trem.connect(tg).connect(g.gain);
  osc.connect(f).connect(g).connect(o.dest);
  osc.start(o.t);
  trem.start(o.t);
  osc.stop(o.t + 1.4);
  trem.stop(o.t + 1.4);
}

export function enemyScream(o: Out) {
  const { ctx } = o;
  const ws = distortion(ctx, 40);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.exponentialRampToValueAtTime(0.45 * o.gain, o.t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + 1.3);
  ws.connect(g).connect(o.dest);
  for (const det of [0, 7, -11, 15]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190 + det, o.t);
    osc.frequency.exponentialRampToValueAtTime(520 + det * 3, o.t + 0.4);
    osc.frequency.exponentialRampToValueAtTime(300 + det, o.t + 1.2);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1200;
    f.Q.value = 1.5;
    osc.connect(f).connect(ws);
    osc.start(o.t);
    osc.stop(o.t + 1.3);
  }
  noise(o, { dur: 1.0, type: 'bandpass', freq: 2500, q: 1, gain: 0.15, attack: 0.05 });
}

export function enemyHmm(o: Out) {
  mutter({ ...o, gain: o.gain * 1.2 }, 2, 95, 0.35);
  tone(o, { freq: 110, freqEnd: 160, dur: 0.6, type: 'sawtooth', gain: 0.08, filter: 600, delay: 0.3, attack: 0.1 });
}

export function enemyGroan(o: Out) {
  tone(o, { freq: 140, freqEnd: 60, dur: 1.6, type: 'sawtooth', gain: 0.18, filter: 700, attack: 0.05, vibrato: 6 });
  noise(o, { dur: 1.2, type: 'bandpass', freq: 600, q: 2, gain: 0.15, attack: 0.1 });
}

export function rustle(o: Out) {
  noise(o, { dur: 0.25, type: 'bandpass', freq: 3000, q: 0.8, gain: 0.08, attack: 0.05 });
}

/** One-shot sound effects named by the protocol. */
export function play(o: Out, name: SoundName) {
  switch (name) {
    case 'door_open':
      creak(o, 0.7 + Math.random() * 0.4, 700 + Math.random() * 500, 0.22);
      noise(o, { dur: 0.05, type: 'highpass', freq: 2000, gain: 0.2 });
      break;
    case 'enemy_open_door':
      creak(o, 1.4, 500, 0.3);
      thump(o, 70, 0.2, 0.4, 1.2);
      break;
    case 'door_close':
      thump(o, 75, 0.2, 0.6);
      noise(o, { dur: 0.04, type: 'highpass', freq: 2500, gain: 0.25, delay: 0.03 });
      break;
    case 'door_slam':
      thump(o, 60, 0.4, 1.0);
      noise(o, { dur: 0.6, type: 'bandpass', freq: 300, q: 0.7, gain: 0.5 });
      modal(o, [210, 560, 1300], 0.4, 0.1, 0.02);
      break;
    case 'door_locked':
      for (let i = 0; i < 3; i++) noise(o, { dur: 0.04, type: 'bandpass', freq: 2200, q: 3, gain: 0.3, delay: i * 0.11 });
      break;
    case 'door_unlock':
    case 'lockpick':
      noise(o, { dur: 0.15, type: 'bandpass', freq: 3000, freqEnd: 1800, q: 2, gain: 0.15 });
      modal(o, [1800, 3900], 0.12, 0.15, 0.15);
      modal(o, [1500, 3400], 0.15, 0.2, 0.32);
      break;
    case 'drawer_open':
    case 'drawer_close':
      noise(o, { dur: 0.35, type: 'bandpass', freq: name === 'drawer_open' ? 500 : 800, freqEnd: name === 'drawer_open' ? 900 : 400, q: 1.5, gain: 0.25, attack: 0.05 });
      thump(o, 110, 0.08, 0.3, 0.33);
      break;
    case 'pickup':
      noise(o, { dur: 0.12, type: 'bandpass', freq: 2500, q: 1, gain: 0.1, attack: 0.02 });
      modal(o, [2400, 5100], 0.1, 0.05, 0.05);
      break;
    case 'drop':
      thump(o, 90, 0.15, 0.6);
      modal(o, [640, 1610, 2900], 0.45, 0.18, 0.01);
      break;
    case 'install':
    case 'fuse':
      for (let i = 0; i < 4; i++) noise(o, { dur: 0.03, type: 'bandpass', freq: 2600, q: 4, gain: 0.25, delay: i * 0.07 });
      thump(o, 130, 0.12, 0.4, 0.3);
      if (name === 'fuse') tone(o, { freq: 120, dur: 0.7, type: 'sawtooth', gain: 0.08, filter: 1500, delay: 0.35 });
      break;
    case 'glass_break':
      noise(o, { dur: 0.4, type: 'highpass', freq: 3000, gain: 0.6 });
      for (let i = 0; i < 9; i++) modal(o, [3000 + Math.random() * 5000], 0.25, 0.08, Math.random() * 0.35);
      thump(o, 160, 0.08, 0.3);
      break;
    case 'trap_snare':
      noise(o, { dur: 0.05, type: 'highpass', freq: 1500, gain: 0.9 });
      modal(o, [480, 1210, 2450], 0.6, 0.35);
      tone(o, { freq: 300, freqEnd: 120, dur: 0.4, gain: 0.15, delay: 0.05 });
      break;
    case 'trap_cans':
      for (let i = 0; i < 7; i++) modal(o, [700 + Math.random() * 900, 2100 + Math.random() * 900], 0.25, 0.2, i * 0.08 + Math.random() * 0.05);
      break;
    case 'trap_bell':
      modal(o, [523, 1180, 1690, 2620, 3500], 2.2, 0.35);
      break;
    case 'creak':
      creak(o, 0.45 + Math.random() * 0.3, 500 + Math.random() * 600, 0.3);
      break;
    case 'weak_board':
      noise(o, { dur: 0.08, type: 'highpass', freq: 800, gain: 0.8 });
      thump(o, 60, 0.3, 0.8);
      creak(o, 0.5, 400, 0.4, 0.05);
      break;
    case 'generator':
      for (let i = 0; i < 2; i++) noise(o, { dur: 0.35, type: 'bandpass', freq: 600, freqEnd: 1800, q: 2, gain: 0.3, delay: i * 0.6 });
      tone(o, { freq: 32, dur: 2.0, type: 'sawtooth', gain: 0.3, filter: 300, delay: 1.2, attack: 0.3 });
      break;
    case 'pump':
      tone(o, { freq: 45, dur: 2.5, type: 'sawtooth', gain: 0.28, filter: 250, attack: 0.4 });
      noise(o, { dur: 2.5, type: 'lowpass', freq: 500, gain: 0.25, attack: 0.5, brown: true });
      break;
    case 'floodgate':
      noise(o, { dur: 4.5, type: 'lowpass', freq: 300, gain: 0.7, brown: true, attack: 0.3 });
      tone(o, { freq: 38, dur: 4.5, type: 'sawtooth', gain: 0.25, filter: 200, attack: 0.3 });
      creak(o, 1.5, 1600, 0.25, 0.5);
      creak(o, 1.2, 2100, 0.2, 2.2);
      thump(o, 45, 0.8, 0.9, 4.3);
      break;
    case 'grate_open':
      noise(o, { dur: 1.2, type: 'bandpass', freq: 1500, freqEnd: 900, q: 3, gain: 0.3, attack: 0.1 });
      modal(o, [380, 950, 2100], 1.2, 0.3, 1.1);
      break;
    case 'shutter': {
      for (let i = 0; i < 30; i++) noise(o, { dur: 0.04, type: 'bandpass', freq: 1800 + Math.random() * 800, q: 3, gain: 0.25, delay: i * 0.07 });
      thump(o, 70, 0.4, 0.7, 2.1);
      break;
    }
    case 'crank':
      for (let i = 0; i < 10; i++) noise(o, { dur: 0.03, type: 'bandpass', freq: 2200, q: 5, gain: 0.25, delay: i * 0.1 });
      break;
    case 'car_start':
    case 'car_fail':
      for (let i = 0; i < 6; i++) noise(o, { dur: 0.16, type: 'bandpass', freq: 250, q: 1, gain: 0.5, delay: i * 0.22, brown: true });
      if (name === 'car_start') {
        tone(o, { freq: 40, freqEnd: 70, dur: 1.5, type: 'sawtooth', gain: 0.5, filter: 600, delay: 1.3, attack: 0.05 });
        noise(o, { dur: 1.5, type: 'lowpass', freq: 800, gain: 0.5, delay: 1.3, brown: true });
      }
      break;
    case 'gate_crash':
      noise(o, { dur: 0.8, type: 'lowpass', freq: 2000, gain: 1.0 });
      modal(o, [220, 610, 1450, 3100], 1.4, 0.5);
      thump(o, 45, 0.5, 1.0);
      break;
    case 'alarm':
      for (let i = 0; i < 12; i++) tone(o, { freq: i % 2 ? 660 : 880, dur: 0.48, type: 'square', gain: 0.18, delay: i * 0.5, filter: 3000 });
      break;
    case 'keypad_ok':
      tone(o, { freq: 1200, dur: 0.1, type: 'square', gain: 0.08, filter: 3000 });
      tone(o, { freq: 1600, dur: 0.15, type: 'square', gain: 0.08, filter: 3000, delay: 0.13 });
      break;
    case 'keypad_bad':
      tone(o, { freq: 180, dur: 0.45, type: 'square', gain: 0.12, filter: 1200 });
      break;
    case 'maglock':
      thump(o, 90, 0.2, 0.8);
      tone(o, { freq: 60, freqEnd: 30, dur: 0.6, type: 'sawtooth', gain: 0.12, filter: 400 });
      break;
    case 'bar_lift':
      noise(o, { dur: 1.0, type: 'bandpass', freq: 900, q: 2, gain: 0.3, attack: 0.1 });
      modal(o, [300, 720, 1600], 0.8, 0.4, 0.9);
      break;
    case 'front_open':
      creak(o, 2.2, 380, 0.4);
      noise(o, { dur: 3, type: 'bandpass', freq: 500, q: 0.6, gain: 0.3, attack: 1, delay: 0.5 });
      break;
    case 'valve':
      creak(o, 0.9, 1800, 0.25);
      break;
    case 'decoy':
      for (let i = 0; i < 5; i++) modal(o, [900 + Math.random() * 300, 2600], 0.08, 0.2, i * 0.12);
      break;
    case 'flash':
      tone(o, { freq: 3000, freqEnd: 9000, dur: 0.4, gain: 0.05 });
      noise(o, { dur: 0.08, type: 'highpass', freq: 3000, gain: 0.5, delay: 0.4 });
      break;
    case 'cage_open':
    case 'cage_close':
      creak(o, 0.8, 1200, 0.3);
      modal(o, [330, 870, 1900], 0.9, 0.4, name === 'cage_close' ? 0.1 : 0.7);
      break;
    case 'ladder':
      for (let i = 0; i < 5; i++) modal(o, [700, 1900], 0.12, 0.15, i * 0.25);
      break;
    case 'splash':
      noise(o, { dur: 0.5, type: 'bandpass', freq: 500, freqEnd: 2000, q: 1, gain: 0.5, attack: 0.02 });
      break;
    case 'gasp':
      noise(o, { dur: 0.4, type: 'bandpass', freq: 1200, freqEnd: 2200, q: 3, gain: 0.5, attack: 0.03 });
      break;
    case 'hide_in':
    case 'hide_out':
      creak(o, 0.35, 1100, 0.15);
      rustle(o);
      break;
    case 'enemy_search_hide':
      thump(o, 80, 0.2, 0.9);
      creak(o, 0.5, 800, 0.4);
      break;
    case 'stumble':
      thump(o, 70, 0.25, 0.8);
      break;
  }
}
