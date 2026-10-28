/**
 * Procedural, tileable textures drawn at load time (no external image assets, so nothing to
 * license and nothing that can go missing). Each material key maps to a generator plus its
 * physical tile size in metres, roughness and metalness.
 */
import * as THREE from 'three';
import { Rng, hashString } from '@nower/shared';

type Ctx = CanvasRenderingContext2D;

class TileNoise {
  private grid: Float32Array;
  constructor(
    private n: number,
    seed: number,
  ) {
    const r = new Rng(seed);
    this.grid = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) this.grid[i] = r.next();
  }
  /** Tileable value noise; u,v in [0,1) wrap at `period` cells. */
  at(u: number, v: number, period: number): number {
    const x = u * period;
    const y = v * period;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const p = period;
    const g = (a: number, b: number) => this.grid[(((b % p) + p) % p) * this.n + (((a % p) + p) % p)];
    const a = g(xi, yi);
    const b = g(xi + 1, yi);
    const c = g(xi, yi + 1);
    const d = g(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  fbm(u: number, v: number, base: number, oct = 4): number {
    let sum = 0;
    let amp = 0.5;
    let per = base;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += this.at(u, v, per) * amp;
      norm += amp;
      amp *= 0.5;
      per *= 2;
    }
    return sum / norm;
  }
}

const noise = new TileNoise(256, 1337);
const noise2 = new TileNoise(256, 4242);

function canvas(size: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Fills a canvas with base colour modulated by tileable fbm noise. */
function noiseFill(ctx: Ctx, size: number, color: number, amount: number, scale = 4, n = noise) {
  const img = ctx.createImageData(size, size);
  const [r, g, b] = rgb(color);
  const d = img.data;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = (n.fbm(x / size, y / size, scale) - 0.5) * 2 * amount + 1;
      const i = (y * size + x) * 4;
      d[i] = Math.min(255, r * v);
      d[i + 1] = Math.min(255, g * v);
      d[i + 2] = Math.min(255, b * v);
      d[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

/** Multiplies grime/age onto the canvas. */
function grime(ctx: Ctx, size: number, strength: number, seed: number, scale = 3) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const n = new TileNoise(128, seed);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = n.fbm(x / size, y / size, scale, 5);
      const k = 1 - Math.max(0, v - 0.45) * strength * 2.2;
      const i = (y * size + x) * 4;
      d[i] *= k;
      d[i + 1] *= k;
      d[i + 2] *= k * 0.98;
    }
  ctx.putImageData(img, 0, 0);
}

function stains(ctx: Ctx, size: number, rng: Rng, count: number, color: string, maxR: number) {
  for (let i = 0; i < count; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const r = maxR * (0.3 + rng.next() * 0.7);
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
      [0, size],
      [0, -size],
    ]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}

function drips(ctx: Ctx, size: number, rng: Rng, count: number, color: string) {
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    const x = rng.next() * size;
    const y0 = rng.next() * size * 0.4;
    const len = size * (0.2 + rng.next() * 0.6);
    ctx.lineWidth = 1 + rng.next() * 3;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    let xx = x;
    for (let y = y0; y < y0 + len; y += 6) {
      xx += (rng.next() - 0.5) * 1.5;
      ctx.lineTo(xx, y);
    }
    ctx.stroke();
  }
}

function cracks(ctx: Ctx, size: number, rng: Rng, count: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    let x = rng.next() * size;
    let y = rng.next() * size;
    let a = rng.next() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const n = 6 + rng.int(0, 14);
    for (let j = 0; j < n; j++) {
      a += (rng.next() - 0.5) * 1.2;
      x += Math.cos(a) * 8;
      y += Math.sin(a) * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function planks(ctx: Ctx, size: number, rng: Rng, opts: { rows: number; base: number; vary: number; gap: string; horizontal?: boolean; grain?: number }) {
  const h = size / opts.rows;
  const [r0, g0, b0] = rgb(opts.base);
  for (let row = 0; row < opts.rows; row++) {
    let x = -rng.next() * size * 0.5;
    while (x < size) {
      const len = size * (0.35 + rng.next() * 0.5);
      const k = 1 + (rng.next() - 0.5) * opts.vary;
      ctx.fillStyle = `rgb(${r0 * k},${g0 * k},${b0 * k})`;
      const rx = opts.horizontal === false ? row * h : x;
      const ry = opts.horizontal === false ? x : row * h;
      const rw = opts.horizontal === false ? h : len;
      const rh = opts.horizontal === false ? len : h;
      ctx.fillRect(rx, ry, rw, rh);
      // grain
      ctx.globalAlpha = 0.18 * (opts.grain ?? 1);
      for (let gl = 0; gl < 6; gl++) {
        ctx.strokeStyle = rng.next() < 0.5 ? 'rgba(0,0,0,0.6)' : 'rgba(255,230,200,0.25)';
        ctx.lineWidth = 0.6 + rng.next();
        ctx.beginPath();
        const off = rng.next();
        if (opts.horizontal === false) {
          ctx.moveTo(rx + off * rw, ry);
          ctx.bezierCurveTo(rx + off * rw + 4, ry + rh * 0.3, rx + off * rw - 4, ry + rh * 0.6, rx + off * rw, ry + rh);
        } else {
          ctx.moveTo(rx, ry + off * rh);
          ctx.bezierCurveTo(rx + rw * 0.3, ry + off * rh + 3, rx + rw * 0.6, ry + off * rh - 3, rx + rw, ry + off * rh);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = opts.gap;
      if (opts.horizontal === false) {
        ctx.fillRect(rx, ry, 2, rh);
        ctx.fillRect(rx, ry, rw, 2);
      } else {
        ctx.fillRect(rx, ry, rw, 2);
        ctx.fillRect(rx, ry, 2, rh);
      }
      x += len;
    }
  }
}

function bricks(ctx: Ctx, size: number, rng: Rng, opts: { rows: number; cols: number; base: number; vary: number; mortar: string; jitter?: number }) {
  ctx.fillStyle = opts.mortar;
  ctx.fillRect(0, 0, size, size);
  const bh = size / opts.rows;
  const bw = size / opts.cols;
  const [r0, g0, b0] = rgb(opts.base);
  for (let row = 0; row < opts.rows; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let c = -1; c <= opts.cols; c++) {
      const k = 1 + (rng.next() - 0.5) * opts.vary;
      const tint = (rng.next() - 0.5) * 18;
      ctx.fillStyle = `rgb(${r0 * k + tint},${g0 * k},${b0 * k - tint * 0.5})`;
      const j = opts.jitter ?? 1;
      ctx.fillRect(c * bw + off + 2 + rng.next() * j, row * bh + 2 + rng.next() * j, bw - 4, bh - 4);
    }
  }
}

function damask(ctx: Ctx, size: number, color: string, cols: number) {
  const cw = size / cols;
  ctx.fillStyle = color;
  for (let y = 0; y < cols * 1.5; y++)
    for (let x = 0; x < cols; x++) {
      const cx = x * cw + (y % 2 ? cw / 2 : 0);
      const cy = (y * cw) / 1.5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      // stylised fleur / damask motif
      ctx.moveTo(0, -cw * 0.42);
      ctx.bezierCurveTo(cw * 0.32, -cw * 0.2, cw * 0.18, cw * 0.1, 0, cw * 0.42);
      ctx.bezierCurveTo(-cw * 0.18, cw * 0.1, -cw * 0.32, -cw * 0.2, 0, -cw * 0.42);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cw * 0.22, 0, cw * 0.08, cw * 0.16, 0.5, 0, Math.PI * 2);
      ctx.ellipse(-cw * 0.22, 0, cw * 0.08, cw * 0.16, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
}

function peel(ctx: Ctx, size: number, rng: Rng, count: number, color: string) {
  for (let i = 0; i < count; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const n = 8;
    for (let j = 0; j <= n; j++) {
      const a = (j / n) * Math.PI * 2;
      const r = 10 + rng.next() * 26;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 1.4);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,30,20,0.35)';
    ctx.stroke();
  }
}

interface Gen {
  size: number;
  tile: number; // metres per texture repeat
  rough: number;
  metal?: number;
  bump?: number;
  transparent?: boolean;
  emissive?: number;
  draw: (ctx: Ctx, size: number, rng: Rng) => void;
}

const GENS: Record<string, Gen> = {
  // ------------------------------------------------------------- walls
  damask_red: {
    size: 512, tile: 1.6, rough: 0.9, bump: 0.6,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x4a1414, 0.25);
      damask(c, s, 'rgba(120,40,30,0.45)', 4);
      peel(c, s, r, 3, 'rgba(170,150,120,0.8)');
      drips(c, s, r, 10, 'rgba(25,10,5,0.35)');
      grime(c, s, 0.7, 11);
    },
  },
  damask_blue: {
    size: 512, tile: 1.6, rough: 0.9, bump: 0.6,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x1d2a3a, 0.25);
      damask(c, s, 'rgba(90,110,130,0.35)', 4);
      peel(c, s, r, 2, 'rgba(160,150,130,0.8)');
      drips(c, s, r, 8, 'rgba(10,10,5,0.35)');
      grime(c, s, 0.7, 12);
    },
  },
  stripe_green: {
    size: 512, tile: 1.6, rough: 0.9, bump: 0.4,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x2c3a26, 0.2);
      for (let x = 0; x < s; x += s / 8) {
        c.fillStyle = 'rgba(60,80,50,0.55)';
        c.fillRect(x, 0, s / 16, s);
        c.fillStyle = 'rgba(170,140,70,0.35)';
        c.fillRect(x + s / 16, 0, 2, s);
      }
      peel(c, s, r, 3, 'rgba(165,150,120,0.8)');
      drips(c, s, r, 10, 'rgba(15,12,5,0.4)');
      grime(c, s, 0.75, 13);
    },
  },
  floral_faded: {
    size: 512, tile: 1.6, rough: 0.9, bump: 0.4,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x6b5a4c, 0.2);
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 8; x++) {
          const cx = (x + (y % 2) * 0.5) * (s / 8);
          const cy = y * (s / 10);
          c.fillStyle = 'rgba(120,60,60,0.35)';
          for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2;
            c.beginPath();
            c.ellipse(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, 5, 3, a, 0, Math.PI * 2);
            c.fill();
          }
          c.fillStyle = 'rgba(70,90,50,0.4)';
          c.fillRect(cx - 1, cy + 6, 2, 10);
        }
      drips(c, s, r, 12, 'rgba(40,25,10,0.35)');
      stains(c, s, r, 5, 'rgba(70,50,20,0.25)', 70);
      grime(c, s, 0.75, 14);
    },
  },
  wood_panel: {
    size: 512, tile: 2.0, rough: 0.7, bump: 0.8,
    draw: (c, s, r) => {
      planks(c, s, r, { rows: 6, base: 0x3a2416, vary: 0.25, gap: 'rgba(10,5,2,0.9)', horizontal: false, grain: 1.5 });
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineWidth = 4;
      c.strokeRect(s * 0.1, s * 0.1, s * 0.8, s * 0.35);
      c.strokeRect(s * 0.1, s * 0.55, s * 0.8, s * 0.35);
      grime(c, s, 0.5, 15);
    },
  },
  wainscot_brown: {
    size: 512, tile: 1.6, rough: 0.85, bump: 0.5,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x4a3524, 0.22);
      c.strokeStyle = 'rgba(30,20,10,0.4)';
      for (let i = 0; i < s; i += 16) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i, s);
        c.stroke();
      }
      drips(c, s, r, 10, 'rgba(15,10,5,0.4)');
      grime(c, s, 0.7, 16);
    },
  },
  plaster_dirty: {
    size: 512, tile: 2.0, rough: 0.95, bump: 0.8,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x8a8170, 0.35, 6);
      cracks(c, s, r, 10, 'rgba(40,35,30,0.6)');
      stains(c, s, r, 8, 'rgba(70,55,30,0.35)', 80);
      drips(c, s, r, 14, 'rgba(50,40,20,0.35)');
      grime(c, s, 0.9, 17);
    },
  },
  tile_wall: {
    size: 512, tile: 1.2, rough: 0.35, bump: 0.6,
    draw: (c, s, r) => {
      c.fillStyle = '#4c4a43';
      c.fillRect(0, 0, s, s);
      const n = 8;
      const w = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const k = 0.85 + r.next() * 0.15;
          c.fillStyle = `rgb(${190 * k},${188 * k},${170 * k})`;
          c.fillRect(x * w + 2, y * w + 2, w - 4, w - 4);
        }
      cracks(c, s, r, 6, 'rgba(30,30,30,0.6)');
      drips(c, s, r, 12, 'rgba(80,60,20,0.35)');
      grime(c, s, 0.9, 18);
    },
  },
  brick: {
    size: 512, tile: 2.0, rough: 0.9, bump: 1,
    draw: (c, s, r) => {
      bricks(c, s, r, { rows: 16, cols: 6, base: 0x6a3022, vary: 0.35, mortar: '#3b342c' });
      grime(c, s, 0.8, 19);
      stains(c, s, r, 6, 'rgba(0,0,0,0.3)', 60);
    },
  },
  stone: {
    size: 512, tile: 2.5, rough: 0.95, bump: 1.2,
    draw: (c, s, r) => {
      bricks(c, s, r, { rows: 6, cols: 3, base: 0x5c5850, vary: 0.3, mortar: '#25231f', jitter: 6 });
      const img = c.getImageData(0, 0, s, s);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 0.85 + Math.random() * 0.25;
        img.data[i] *= v;
        img.data[i + 1] *= v;
        img.data[i + 2] *= v;
      }
      c.putImageData(img, 0, 0);
      grime(c, s, 0.9, 20);
    },
  },
  sewer_brick: {
    size: 512, tile: 2.0, rough: 0.45, bump: 1,
    draw: (c, s, r) => {
      bricks(c, s, r, { rows: 14, cols: 5, base: 0x3a3424, vary: 0.35, mortar: '#191a12' });
      drips(c, s, r, 30, 'rgba(20,35,15,0.55)');
      const g = c.createLinearGradient(0, s * 0.6, 0, s);
      g.addColorStop(0, 'rgba(30,60,20,0)');
      g.addColorStop(1, 'rgba(30,60,20,0.5)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
      grime(c, s, 1, 21);
    },
  },
  concrete: {
    size: 512, tile: 3, rough: 0.9, bump: 0.6,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x6a6862, 0.3, 8);
      cracks(c, s, r, 8, 'rgba(20,20,20,0.6)');
      stains(c, s, r, 10, 'rgba(30,25,20,0.3)', 70);
      grime(c, s, 0.8, 22);
    },
  },
  attic_boards: {
    size: 512, tile: 2.5, rough: 0.9, bump: 0.8,
    draw: (c, s, r) => {
      planks(c, s, r, { rows: 8, base: 0x5a4632, vary: 0.35, gap: 'rgba(15,10,5,0.95)', grain: 1.3 });
      noiseOverlay(c, s, 'rgba(160,150,130,0.25)', 23);
      grime(c, s, 0.6, 23);
    },
  },
  wood_planks: {
    size: 512, tile: 2.5, rough: 0.95, bump: 0.9,
    draw: (c, s, r) => {
      planks(c, s, r, { rows: 5, base: 0x4c3e30, vary: 0.4, gap: 'rgba(5,5,5,0.95)', horizontal: false, grain: 1.5 });
      grime(c, s, 0.8, 24);
    },
  },
  hedge: {
    size: 256, tile: 2.0, rough: 1, bump: 2,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x18301a, 0.6, 12, noise2);
      for (let i = 0; i < 900; i++) {
        c.fillStyle = `rgba(${20 + r.next() * 40},${50 + r.next() * 50},${20 + r.next() * 25},0.7)`;
        c.beginPath();
        c.ellipse(r.next() * s, r.next() * s, 2 + r.next() * 4, 1 + r.next() * 2, r.next() * 3, 0, Math.PI * 2);
        c.fill();
      }
    },
  },
  facade: {
    size: 512, tile: 3.0, rough: 0.95, bump: 1,
    emissive: 0x0c1018,
    draw: (c, s, r) => {
      bricks(c, s, r, { rows: 7, cols: 3, base: 0x5d5a52, vary: 0.25, mortar: '#2a2824', jitter: 2 });
      drips(c, s, r, 25, 'rgba(10,12,8,0.45)');
      noiseOverlay(c, s, 'rgba(30,45,25,0.25)', 25);
      grime(c, s, 1, 25);
    },
  },
  garage_brick: {
    size: 512, tile: 2.0, rough: 0.9, bump: 1,
    emissive: 0x0a0d14,
    draw: (c, s, r) => {
      bricks(c, s, r, { rows: 16, cols: 6, base: 0x5a2c22, vary: 0.4, mortar: '#3a3630' });
      drips(c, s, r, 15, 'rgba(10,10,8,0.4)');
      grime(c, s, 0.9, 26);
    },
  },
  fence: {
    size: 256, tile: 2.0, rough: 0.6, metal: 0.6, transparent: true, emissive: 0x05070a,
    draw: (c, s) => {
      c.clearRect(0, 0, s, s);
      c.fillStyle = '#1b1c1e';
      for (let x = 0; x < s; x += s / 8) {
        c.fillRect(x + 6, 0, 5, s);
        c.beginPath();
        c.moveTo(x + 2, 12);
        c.lineTo(x + 8.5, 0);
        c.lineTo(x + 15, 12);
        c.fill();
      }
      c.fillRect(0, 26, s, 6);
      c.fillRect(0, s - 30, s, 6);
    },
  },
  shed: {
    size: 256, tile: 2.0, rough: 0.95, bump: 0.8, emissive: 0x080a10,
    draw: (c, s, r) => planks(c, s, r, { rows: 5, base: 0x3a3026, vary: 0.4, gap: 'rgba(5,5,5,0.95)', horizontal: false, grain: 1.5 }),
  },
  rock: {
    size: 256, tile: 3.0, rough: 1, bump: 2, emissive: 0x06080a,
    draw: (c, s) => {
      noiseFill(c, s, 0x2c2a26, 0.6, 6);
      grime(c, s, 1, 27);
    },
  },
  bars: {
    size: 128, tile: 1, rough: 0.5, metal: 0.8,
    draw: (c, s) => noiseFill(c, s, 0x2a2826, 0.4, 8),
  },
  // ------------------------------------------------------------- floors
  marble: {
    size: 512, tile: 2.0, rough: 0.25, bump: 0.2,
    draw: (c, s, r) => {
      const n = 2;
      const w = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          c.fillStyle = (x + y) % 2 ? '#1d1c1b' : '#8f8a80';
          c.fillRect(x * w, y * w, w, w);
        }
      c.globalAlpha = 0.25;
      for (let i = 0; i < 30; i++) {
        c.strokeStyle = r.next() < 0.5 ? '#ddd' : '#333';
        c.lineWidth = 0.5 + r.next() * 2;
        c.beginPath();
        let x = r.next() * s;
        let y = r.next() * s;
        c.moveTo(x, y);
        for (let j = 0; j < 12; j++) {
          x += (r.next() - 0.3) * 30;
          y += (r.next() - 0.5) * 30;
          c.lineTo(x, y);
        }
        c.stroke();
      }
      c.globalAlpha = 1;
      c.fillStyle = '#111';
      c.fillRect(0, 0, s, 2);
      c.fillRect(0, 0, 2, s);
      c.fillRect(0, s / 2, s, 2);
      c.fillRect(s / 2, 0, 2, s);
      grime(c, s, 0.9, 30);
    },
  },
  parquet: {
    size: 512, tile: 1.6, rough: 0.6, bump: 0.6,
    draw: (c, s, r) => {
      c.fillStyle = '#1a1009';
      c.fillRect(0, 0, s, s);
      const w = s / 16;
      for (let y = -2; y < 18; y++)
        for (let x = -2; x < 18; x++) {
          const k = 0.75 + r.next() * 0.35;
          c.fillStyle = `rgb(${92 * k},${58 * k},${32 * k})`;
          const px = x * w * 2 + (y % 2) * w;
          const py = y * w;
          c.save();
          c.translate(px, py);
          c.rotate(((x + y) % 2) * (Math.PI / 2));
          c.fillRect(1, 1, w * 2 - 2, w - 2);
          c.restore();
        }
      grime(c, s, 0.8, 31);
    },
  },
  wood: {
    size: 512, tile: 2.0, rough: 0.7, bump: 0.6,
    draw: (c, s, r) => {
      planks(c, s, r, { rows: 8, base: 0x6a4a2e, vary: 0.3, gap: 'rgba(10,5,2,0.9)' });
      grime(c, s, 0.75, 32);
    },
  },
  wood_dark: {
    size: 512, tile: 2.0, rough: 0.6, bump: 0.6,
    draw: (c, s, r) => {
      planks(c, s, r, { rows: 8, base: 0x3a2516, vary: 0.3, gap: 'rgba(5,2,1,0.95)' });
      grime(c, s, 0.7, 33);
    },
  },
  wood_rough: {
    size: 512, tile: 2.0, rough: 0.95, bump: 1,
    draw: (c, s, r) => {
      planks(c, s, r, { rows: 7, base: 0x544636, vary: 0.45, gap: 'rgba(5,5,5,0.95)', grain: 1.6 });
      grime(c, s, 0.9, 34);
    },
  },
  carpet_red: {
    size: 512, tile: 2.0, rough: 1, bump: 0.3,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x4a0e10, 0.3, 32);
      c.strokeStyle = 'rgba(150,110,50,0.35)';
      c.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.arc(s / 2, s / 2, s * (0.12 + i * 0.1), 0, Math.PI * 2);
        c.stroke();
      }
      stains(c, s, r, 6, 'rgba(15,5,2,0.45)', 60);
      grime(c, s, 0.7, 35);
    },
  },
  runner: {
    size: 256, tile: 2.0, rough: 1, bump: 0.3,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x3c0b0d, 0.3, 24);
      c.fillStyle = 'rgba(130,90,40,0.5)';
      c.fillRect(0, s * 0.08, s, 4);
      c.fillRect(0, s * 0.92 - 4, s, 4);
      for (let x = 0; x < s; x += 32) {
        c.beginPath();
        c.moveTo(x, s / 2);
        c.lineTo(x + 16, s / 2 - 14);
        c.lineTo(x + 32, s / 2);
        c.lineTo(x + 16, s / 2 + 14);
        c.fill();
      }
      stains(c, s, r, 3, 'rgba(10,5,2,0.4)', 40);
    },
  },
  tile_dirty: {
    size: 512, tile: 1.6, rough: 0.6, bump: 0.6,
    draw: (c, s, r) => {
      c.fillStyle = '#2a2722';
      c.fillRect(0, 0, s, s);
      const n = 6;
      const w = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const k = 0.8 + r.next() * 0.2;
          c.fillStyle = `rgb(${150 * k},${138 * k},${110 * k})`;
          c.fillRect(x * w + 2, y * w + 2, w - 4, w - 4);
        }
      cracks(c, s, r, 8, 'rgba(20,20,20,0.6)');
      grime(c, s, 1, 36);
    },
  },
  tile_checker: {
    size: 512, tile: 1.6, rough: 0.45, bump: 0.4,
    draw: (c, s, r) => {
      const n = 8;
      const w = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          c.fillStyle = (x + y) % 2 ? '#1e1e1c' : '#a6a294';
          c.fillRect(x * w, y * w, w, w);
        }
      cracks(c, s, r, 6, 'rgba(10,10,10,0.6)');
      stains(c, s, r, 5, 'rgba(60,30,10,0.3)', 60);
      grime(c, s, 1, 37);
    },
  },
  tile_terracotta: {
    size: 512, tile: 1.6, rough: 0.8, bump: 0.6,
    draw: (c, s, r) => {
      c.fillStyle = '#3a2a20';
      c.fillRect(0, 0, s, s);
      const n = 5;
      const w = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const k = 0.75 + r.next() * 0.3;
          c.fillStyle = `rgb(${140 * k},${70 * k},${40 * k})`;
          c.fillRect(x * w + 3, y * w + 3, w - 6, w - 6);
        }
      grime(c, s, 0.9, 38);
    },
  },
  concrete_oil: {
    size: 512, tile: 3, rough: 0.8, bump: 0.5,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x5c5a55, 0.3, 8);
      stains(c, s, r, 12, 'rgba(5,5,5,0.55)', 90);
      cracks(c, s, r, 8, 'rgba(15,15,15,0.6)');
      grime(c, s, 0.8, 39);
    },
  },
  sewer_stone: {
    size: 512, tile: 2.0, rough: 0.3, bump: 0.8,
    draw: (c, s, r) => {
      bricks(c, s, r, { rows: 8, cols: 4, base: 0x35352a, vary: 0.35, mortar: '#141510', jitter: 3 });
      noiseOverlay(c, s, 'rgba(25,50,20,0.35)', 40);
      grime(c, s, 1, 40);
    },
  },
  grass: {
    size: 512, tile: 4, rough: 1, bump: 1,
    emissive: 0x03050a,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x1e2a14, 0.6, 6, noise2);
      for (let i = 0; i < 6000; i++) {
        const x = r.next() * s;
        const y = r.next() * s;
        c.strokeStyle = `rgba(${30 + r.next() * 40},${45 + r.next() * 50},${15 + r.next() * 20},0.6)`;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + (r.next() - 0.5) * 4, y - 3 - r.next() * 6);
        c.stroke();
      }
      stains(c, s, r, 8, 'rgba(30,22,10,0.4)', 70);
    },
  },
  gravel: {
    size: 512, tile: 2.5, rough: 1, bump: 1.5,
    emissive: 0x070a0d,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x3e3a34, 0.3, 16);
      for (let i = 0; i < 4500; i++) {
        const k = 0.6 + r.next() * 0.7;
        c.fillStyle = `rgb(${95 * k},${90 * k},${82 * k})`;
        c.beginPath();
        c.ellipse(r.next() * s, r.next() * s, 1.5 + r.next() * 3, 1 + r.next() * 2.5, r.next() * 3, 0, Math.PI * 2);
        c.fill();
      }
    },
  },
  dirt: {
    size: 256, tile: 3, rough: 1, bump: 1.2, emissive: 0x05070a,
    draw: (c, s) => noiseFill(c, s, 0x2e2418, 0.5, 8),
  },
  asphalt: {
    size: 512, tile: 4, rough: 0.9, bump: 0.8,
    emissive: 0x06080b,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x2a2a2a, 0.35, 24);
      cracks(c, s, r, 14, 'rgba(5,5,5,0.7)');
    },
  },
  // ------------------------------------------------------------- ceilings & misc
  ceiling: {
    size: 512, tile: 3, rough: 1, bump: 0.4,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x6e685c, 0.3, 5);
      for (let i = 0; i < 6; i++) {
        const x = r.next() * s;
        const y = r.next() * s;
        for (let k = 0; k < 3; k++) {
          c.strokeStyle = `rgba(90,60,20,${0.25 - k * 0.06})`;
          c.lineWidth = 2;
          c.beginPath();
          c.ellipse(x, y, 30 + k * 18 + r.next() * 10, 22 + k * 14, r.next(), 0, Math.PI * 2);
          c.stroke();
        }
      }
      cracks(c, s, r, 8, 'rgba(30,25,20,0.5)');
      grime(c, s, 0.9, 41);
    },
  },
  ceiling_wood: {
    size: 512, tile: 2.5, rough: 0.9, bump: 0.8,
    draw: (c, s, r) => {
      planks(c, s, r, { rows: 6, base: 0x3a2c1e, vary: 0.35, gap: 'rgba(0,0,0,0.95)' });
      grime(c, s, 0.9, 42);
    },
  },
  roof: {
    size: 512, tile: 3, rough: 0.8, bump: 1, emissive: 0x05070c,
    draw: (c, s, r) => {
      c.fillStyle = '#0e0f12';
      c.fillRect(0, 0, s, s);
      const rows = 12;
      const h = s / rows;
      for (let y = 0; y < rows; y++)
        for (let x = -1; x < 9; x++) {
          const k = 0.7 + r.next() * 0.5;
          c.fillStyle = `rgb(${38 * k},${40 * k},${46 * k})`;
          c.fillRect(x * (s / 8) + (y % 2) * (s / 16) + 1, y * h + 1, s / 8 - 2, h - 1);
        }
      grime(c, s, 0.8, 43);
    },
  },
  trim: {
    size: 256, tile: 1.5, rough: 0.55, bump: 0.5,
    draw: (c, s, r) => planks(c, s, r, { rows: 2, base: 0x2a170c, vary: 0.2, gap: 'rgba(0,0,0,0.6)', grain: 1 }),
  },
  metal: {
    size: 256, tile: 1.5, rough: 0.55, metal: 0.6, bump: 0.4,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x50524f, 0.3, 8);
      stains(c, s, r, 8, 'rgba(110,50,15,0.45)', 40);
    },
  },
  rust: {
    size: 256, tile: 1.5, rough: 0.85, metal: 0.4, bump: 0.8,
    draw: (c, s) => noiseFill(c, s, 0x5a2e16, 0.5, 10),
  },
  fabric: {
    size: 256, tile: 1, rough: 1, bump: 0.3,
    draw: (c, s) => noiseFill(c, s, 0x3b2a2a, 0.3, 32),
  },
  fabric_green: {
    size: 256, tile: 1, rough: 1, bump: 0.3,
    draw: (c, s) => noiseFill(c, s, 0x223022, 0.3, 32),
  },
  sheet: {
    size: 256, tile: 1.5, rough: 1, bump: 0.4,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x8f897c, 0.25, 6);
      stains(c, s, r, 4, 'rgba(60,50,30,0.3)', 50);
    },
  },
  leather: {
    size: 256, tile: 1, rough: 0.6, bump: 0.5,
    draw: (c, s) => noiseFill(c, s, 0x2e1a10, 0.35, 24),
  },
  porcelain: {
    size: 128, tile: 1, rough: 0.25,
    draw: (c, s, r) => {
      noiseFill(c, s, 0xb8b4a6, 0.1, 4);
      stains(c, s, r, 3, 'rgba(110,80,30,0.4)', 30);
    },
  },
  bark: {
    size: 256, tile: 1.5, rough: 1, bump: 2, emissive: 0x040608,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x241c16, 0.5, 4);
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      for (let i = 0; i < 40; i++) {
        c.lineWidth = 1 + r.next() * 3;
        const x = r.next() * s;
        c.beginPath();
        c.moveTo(x, 0);
        c.bezierCurveTo(x + 6, s * 0.3, x - 6, s * 0.6, x + 2, s);
        c.stroke();
      }
    },
  },
  leaves: {
    size: 256, tile: 2, rough: 1, bump: 1, emissive: 0x05090a,
    draw: (c, s, r) => {
      noiseFill(c, s, 0x101c10, 0.6, 8, noise2);
      for (let i = 0; i < 700; i++) {
        c.fillStyle = `rgba(${15 + r.next() * 25},${30 + r.next() * 35},${12 + r.next() * 15},0.8)`;
        c.beginPath();
        c.ellipse(r.next() * s, r.next() * s, 2 + r.next() * 5, 1 + r.next() * 2, r.next() * 3, 0, Math.PI * 2);
        c.fill();
      }
    },
  },
  paper: {
    size: 128, tile: 1, rough: 1,
    draw: (c, s, r) => {
      noiseFill(c, s, 0xbdb39b, 0.12, 4);
      c.strokeStyle = 'rgba(40,30,30,0.6)';
      for (let y = 20; y < s - 10; y += 9) {
        c.beginPath();
        c.moveTo(12, y);
        c.lineTo(12 + r.next() * (s - 30), y);
        c.stroke();
      }
    },
  },
};

function noiseOverlay(ctx: Ctx, size: number, color: string, seed: number) {
  const n = new TileNoise(128, seed);
  const img = ctx.getImageData(0, 0, size, size);
  const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(color)!;
  const cr = +m[1];
  const cg = +m[2];
  const cb = +m[3];
  const ca = +m[4];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = Math.max(0, n.fbm(x / size, y / size, 4, 4) - 0.5) * 2 * ca;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i] * (1 - v) + cr * v;
      img.data[i + 1] = img.data[i + 1] * (1 - v) + cg * v;
      img.data[i + 2] = img.data[i + 2] * (1 - v) + cb * v;
    }
  ctx.putImageData(img, 0, 0);
}

const texCache = new Map<string, THREE.CanvasTexture>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function tileSize(key: string): number {
  return GENS[key]?.tile ?? 2;
}

export function getTexture(key: string): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (t) return t;
  const gen = GENS[key] ?? GENS.plaster_dirty;
  const [c, ctx] = canvas(gen.size);
  gen.draw(ctx, gen.size, new Rng(hashString(key)));
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

/** Shared PBR-ish material for a texture key. */
export function getMat(key: string, tint = 0xffffff): THREE.MeshStandardMaterial {
  const ck = `${key}:${tint}`;
  let m = matCache.get(ck);
  if (m) return m;
  const gen = GENS[key] ?? GENS.plaster_dirty;
  const map = getTexture(key);
  m = new THREE.MeshStandardMaterial({
    map,
    color: tint,
    roughness: gen.rough,
    metalness: gen.metal ?? 0,
    bumpMap: gen.bump ? map : null,
    bumpScale: gen.bump ? gen.bump * 0.6 : 0,
    transparent: !!gen.transparent,
    alphaTest: gen.transparent ? 0.4 : 0,
    side: gen.transparent ? THREE.DoubleSide : THREE.FrontSide,
    emissive: gen.emissive ?? 0x000000,
    emissiveMap: gen.emissive ? map : null,
    emissiveIntensity: gen.emissive ? 2.2 : 0,
  });
  matCache.set(ck, m);
  return m;
}

/** Plain colour materials for small props. */
const plainCache = new Map<string, THREE.MeshStandardMaterial>();
export function plain(color: number, rough = 0.8, metal = 0, emissive = 0): THREE.MeshStandardMaterial {
  const k = `${color}:${rough}:${metal}:${emissive}`;
  let m = plainCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: emissive ? color : 0, emissiveIntensity: emissive });
    plainCache.set(k, m);
  }
  return m;
}

export const ALL_TEXTURE_KEYS = Object.keys(GENS);

/** Pre-generates every texture, yielding to the browser between them. */
export async function warmTextures(onProgress: (p: number) => void) {
  const keys = ALL_TEXTURE_KEYS;
  for (let i = 0; i < keys.length; i++) {
    getTexture(keys[i]);
    onProgress((i + 1) / keys.length);
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
  }
}

/** Eerie portrait for paintings (a few variants, generated once). */
const portraitCache: THREE.CanvasTexture[] = [];
export function portrait(i: number): THREE.CanvasTexture {
  const idx = i % 6;
  if (portraitCache[idx]) return portraitCache[idx];
  const [c, ctx] = canvas(256);
  const r = new Rng(9000 + idx);
  const bg = ctx.createRadialGradient(128, 110, 10, 128, 128, 180);
  bg.addColorStop(0, ['#3a2c1c', '#22302a', '#2c1c1c', '#1f2430', '#30281a', '#1a1a1a'][idx]);
  bg.addColorStop(1, '#070605');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);
  // shoulders
  ctx.fillStyle = '#0d0b09';
  ctx.beginPath();
  ctx.ellipse(128, 260, 110, 80, 0, 0, Math.PI * 2);
  ctx.fill();
  // face
  const skin = ['#8a7a64', '#7a6e5e', '#968a74'][idx % 3];
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(128, 120, 46, 62, 0, 0, Math.PI * 2);
  ctx.fill();
  // eyes: sometimes scratched out
  const scratched = idx % 2 === 0;
  ctx.fillStyle = '#0a0806';
  for (const ex of [108, 148]) {
    ctx.beginPath();
    ctx.ellipse(ex, 112, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (scratched) {
    ctx.strokeStyle = 'rgba(200,190,170,0.8)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 14; k++) {
      ctx.beginPath();
      const ex = k % 2 ? 108 : 148;
      ctx.moveTo(ex - 14 + r.next() * 6, 100 + r.next() * 8);
      ctx.lineTo(ex + 14 - r.next() * 6, 120 + r.next() * 8);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#3a2a20';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(112, 152);
  ctx.quadraticCurveTo(128, 146 + idx * 2, 144, 152);
  ctx.stroke();
  const img = ctx.getImageData(0, 0, 256, 256);
  for (let p = 0; p < img.data.length; p += 4) {
    const v = 0.75 + Math.random() * 0.3;
    img.data[p] *= v;
    img.data[p + 1] *= v * 0.97;
    img.data[p + 2] *= v * 0.9;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  portraitCache[idx] = t;
  return t;
}

/** Canvas text texture (signs, panel screen, labels). */
export function textTexture(lines: string[], opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string } = {}): THREE.CanvasTexture {
  const w = opts.w ?? 256;
  const h = opts.h ?? 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = opts.bg ?? '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = opts.fg ?? '#e33';
  ctx.font = opts.font ?? `bold ${Math.floor(h / (lines.length + 1))}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, ((i + 1) * h) / (lines.length + 1)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
