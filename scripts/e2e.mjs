// End-to-end smoke test in real Chrome: two players create/join a lobby through the UI,
// start a match, see each other move, and the game renders without errors.
// Usage: npm run build && node scripts/e2e.mjs [--software] [--shots=dir]
// By default Chrome runs in a real (off-screen) window so WebGL uses the GPU; --software uses
// headless SwiftShader instead (works on CI but renders at only a few frames per second).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

// --url=http://host:port tests an already running deployment (e.g. the Docker image) instead
const external = (process.argv.find((a) => a.startsWith('--url=')) ?? '').slice(6).replace(/\/$/, '');
const PORT = 3077;
const BASE = external || `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/?debug`;
const software = process.argv.includes('--software');
const shots = (process.argv.find((a) => a.startsWith('--shots=')) ?? '--shots=test-results').slice(8);
mkdirSync(shots, { recursive: true });

const server = external ? null : spawn('node', ['server/dist/index.js'], { env: { ...process.env, PORT: String(PORT), STATIC_DIR: 'client/dist', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed = true;
};

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('server did not start');
}

/** Walks a player with real keyboard input (server-validated) towards a point, steering by yaw. */
async function walkTo(page, x, z, tol = 0.35) {
  await page.keyboard.down('KeyW');
  try {
    for (let i = 0; i < 160; i++) {
      const done = await page.evaluate(({ x, z, tol }) => {
        const g = window.__nower.gameRef.current;
        const dx = x - g.ctrl.x;
        const dz = z - g.ctrl.z;
        g.ctrl.yaw = Math.atan2(-dx, -dz);
        return Math.hypot(dx, dz) < tol;
      }, { x, z, tol });
      if (done) break;
      await sleep(60);
    }
  } finally {
    await page.keyboard.up('KeyW');
  }
  await sleep(300);
}

/** Renders the current camera view and returns mean luminance (0..255) and the share of non-black pixels. */
function viewStats(page) {
  return page.evaluate(() => {
    const g = window.__nower.gameRef.current;
    const r = g.renderer;
    const gl = r.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (g.post) g.post.renderFrame();
    else r.render(g.scene, g.camera);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    let lit = 0;
    const n = w * h;
    for (let i = 0; i < px.length; i += 16) {
      const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      sum += l;
      if (l > 12) lit++;
    }
    return { mean: Math.round((sum / (n / 4)) * 10) / 10, lit: Math.round((lit / (n / 4)) * 1000) / 1000 };
  });
}

async function main() {
  await waitHealthy();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: software,
    args: software
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
      : ['--window-position=-3000,0', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const errors = [];
  const mkPage = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${label} console: ${m.text()}`));
    await page.goto(URL);
    await page.click('text=CLICK ANYWHERE TO ENTER');
    return page;
  };
  const a = await mkPage('A');
  const b = await mkPage('B');

  await a.click('text=CREATE LOBBY');
  await a.fill('input', 'Raff');
  await a.click('button:has-text("CREATE")');
  await a.waitForSelector('.lobby-code');
  const code = (await a.textContent('.lobby-code')).trim();
  check(/^[A-Z2-9]{5}$/.test(code), `lobby created with code ${code}`);
  await a.screenshot({ path: `${shots}/1-lobby.png` });

  await b.click('text=JOIN LOBBY');
  await b.fill('input >> nth=0', 'Noer');
  await b.fill('.code-input', code);
  await b.click('button:has-text("JOIN")');
  await b.waitForSelector('.lobby-code');
  await a.waitForFunction(() => document.querySelectorAll('.players li .tag.host').length === 1 && document.body.innerText.includes('Noer'));
  check(true, 'second player joined and both see the lobby');

  // difficulty: MEDIUM by default; the host picks HARD; the guest sees it selected (read-only)
  const selected = (p) => p.evaluate(() => [...document.querySelectorAll('.diff-card[aria-checked="true"]')].map((e) => e.textContent));
  check((await selected(b))[0]?.includes('MEDIUM'), 'new lobby defaults to MEDIUM');
  await a.click('.diff-card:has-text("HARD")');
  await b.waitForFunction(() => document.querySelector('.diff-card[aria-checked="true"]')?.textContent?.includes('HARD'), null, { timeout: 5000 });
  const guestView = await b.evaluate(() => {
    const on = document.querySelector('.diff-card[aria-checked="true"]');
    return { text: on?.textContent ?? '', mark: on?.querySelector('.diff-mark')?.textContent, others: [...document.querySelectorAll('.diff-card:disabled')].length };
  });
  check(guestView.text.includes('SELECTED') && guestView.mark === '◆' && guestView.others === 3, 'guest sees HARD marked selected (glyph + label, not colour only) and cannot change it');
  await b.screenshot({ path: `${shots}/1b-lobby-guest-difficulty.png` });

  await b.click('button:has-text("READY")');
  await a.waitForSelector('button:has-text("START GAME"):not([disabled])');
  await a.click('button:has-text("START GAME")');
  const t0 = Date.now();
  await Promise.all([a.waitForSelector('.game-canvas', { timeout: 30000 }), b.waitForSelector('.game-canvas', { timeout: 30000 })]);
  try {
    await a.waitForFunction(() => !document.querySelector('.loading-bar'), null, { timeout: 90000 });
  } catch (e) {
    await a.screenshot({ path: `${shots}/fail-loading.png` });
    console.log('      loading text:', await a.evaluate(() => document.body.innerText.slice(0, 200)));
    for (const er of errors) console.log('      ' + er);
    throw e;
  }
  console.log(`      world built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await sleep(1500);
  await a.screenshot({ path: `${shots}/2-intro.png` });
  // skip the intro on both clients
  for (const p of [a, b]) await p.keyboard.press('Space');
  await sleep(5000); // countdown
  const st = (p) =>
    p.evaluate(() => {
      const g = window.__nower.gameRef.current;
      const w = g.world;
      return { phase: w.phase, me: w.you, pos: [g.ctrl.x, g.ctrl.y, g.ctrl.z], players: [...w.players.values()].map((p) => p.id), fps: window.__nower.store.getState().hud.fps };
    });
  const sa = await st(a);
  const sb = await st(b);
  const diffs = await Promise.all([a, b].map((p) => p.evaluate(() => window.__nower.gameRef.current.world.difficulty)));
  check(diffs[0] === 'hard' && diffs[1] === 'hard', `both clients play the host's choice (${diffs.join('/')})`);
  check(sa.phase === 'PLAYING' && sb.phase === 'PLAYING', `match is PLAYING on both clients (${sa.phase}/${sb.phase})`);
  check(sa.players.length === 2 && sb.players.length === 2, 'both clients know both players');
  await a.screenshot({ path: `${shots}/3-bedroom.png` });

  // A walks (real input, validated by the server) to the bedroom door; B must see it via snapshots
  const target = { x: 27.5, z: 28.3 };
  await a.evaluate((t) => {
    const g = window.__nower.gameRef.current;
    g.ctrl.yaw = Math.atan2(-(t.x - g.ctrl.x), -(t.z - g.ctrl.z));
    g.ctrl.pitch = 0;
  }, target);
  await a.keyboard.down('KeyW');
  for (let i = 0; i < 120; i++) {
    const p = await st(a);
    if (Math.hypot(p.pos[0] - target.x, p.pos[2] - target.z) < 0.6) break;
    await a.evaluate((t) => {
      const g = window.__nower.gameRef.current;
      g.ctrl.yaw = Math.atan2(-(t.x - g.ctrl.x), -(t.z - g.ctrl.z));
    }, target);
    await sleep(150);
  }
  await a.keyboard.up('KeyW');
  await sleep(1000);
  const sa2 = await st(a);
  const moved = Math.hypot(sa2.pos[0] - sa.pos[0], sa2.pos[2] - sa.pos[2]);
  check(moved > 3, `player A walked ${moved.toFixed(2)}m with keyboard input`);
  const seenByB = await b.evaluate((id) => {
    const p = window.__nower.gameRef.current.world.interpPlayer(id);
    return p ? [p.x, p.z] : null;
  }, sa2.me);
  const dist = seenByB ? Math.hypot(seenByB[0] - sa2.pos[0], seenByB[1] - sa2.pos[2]) : 99;
  check(dist < 0.6, `player B sees A at the server-validated position (error ${dist.toFixed(2)}m)`);
  await b.screenshot({ path: `${shots}/4-teammate.png` });

  // face the door and use the real interaction pipeline (prompt -> E -> server -> other client)
  const doorRes = await a.evaluate(async () => {
    const g = window.__nower.gameRef.current;
    const di = g.world.level.doors.findIndex((d) => d.spec.id === 'westbed_sewing');
    const d = g.world.level.doors[di];
    g.ctrl.yaw = Math.atan2(-(d.center[0] - g.ctrl.x), -(d.center[2] - g.ctrl.z));
    g.ctrl.pitch = -0.1;
    await new Promise((r) => setTimeout(r, 1500));
    return { di, prompt: window.__nower.store.getState().hud.prompt };
  });
  check(!!doorRes.prompt && doorRes.prompt.includes('OPEN'), `interaction prompt shown: "${doorRes.prompt}"`);
  await a.keyboard.press('KeyE');
  await sleep(1500);
  const doorOpenOnB = await b.evaluate((i) => window.__nower.gameRef.current.world.doors[i].open, doorRes.di);
  check(doorOpenOnB, 'door opened by A is open for B');
  await sleep(1000);
  await a.screenshot({ path: `${shots}/5-door.png` });

  // ---------------- hiding: wardrobe and under the bed, observed by the other player ----------------
  const hideFlow = async (kind, standX, standZ) => {
    await walkTo(a, 30.5, 26.0);
    await walkTo(a, standX, standZ, 0.25);
    const info = await a.evaluate((kind) => {
      const g = window.__nower.gameRef.current;
      const L = g.world.level;
      const h = L.hides.find((hh) => hh.kind === kind && L.rooms[hh.room].spec.id === 'westbed');
      const fu = L.furniture[h.furn];
      g.ctrl.yaw = Math.atan2(-(fu.center[0] - g.ctrl.x), -(fu.center[2] - g.ctrl.z));
      g.ctrl.pitch = kind === 'bed' ? -0.6 : 0;
      return { i: h.index };
    }, kind);
    await sleep(600);
    const prompt = await a.evaluate(() => window.__nower.store.getState().hud.prompt);
    check(!!prompt && prompt.includes('HIDE'), `${kind}: prompt "${prompt}"`);
    await a.keyboard.press('KeyE');
    await sleep(2800);
    const inside = await a.evaluate((i) => {
      const g = window.__nower.gameRef.current;
      const hv = g.static.hides[i];
      return { status: g.world.me.status, hide: g.world.me.hide, camErr: g.camera.position.distanceTo(hv.cam), fov: g.camera.fov };
    }, info.i);
    check(inside.status === 'hidden' && inside.hide === info.i, `${kind}: player A is hidden in spot ${info.i}`);
    check(inside.camErr < 0.02, `${kind}: camera sits at the in-furniture viewpoint (error ${inside.camErr.toFixed(3)}m, fov ${inside.fov})`);
    const view = await viewStats(a);
    check(view.mean >= 5 && view.lit >= 0.15, `${kind}: view is not black (mean luminance ${view.mean}, ${Math.round(view.lit * 100)}% lit pixels)`);
    await a.screenshot({ path: `${shots}/8-hide-${kind}.png` });
    const fromB = await b.evaluate(({ id, i }) => {
      const g = window.__nower.gameRef.current;
      return { occupant: g.world.hides[i], status: g.world.players.get(id).status, modelVisible: g.remotes.get(id).model.root.visible };
    }, { id: sa.me, i: info.i });
    check(fromB.occupant === sa.me && fromB.status === 'hidden' && !fromB.modelVisible, `${kind}: player B sees A hidden there (model concealed)`);
    // look limits: a huge mouse sweep is clamped to the hiding place's range
    const look = await a.evaluate(async (i) => {
      const g = window.__nower.gameRef.current;
      g.input.locked = true;
      g.input.dx = 5000;
      await new Promise((r) => setTimeout(r, 200));
      g.input.locked = document.pointerLockElement === g.renderer.domElement;
      return { yaw: g.hideLook.yaw, range: g.static.hides[i].yawRange };
    }, info.i);
    check(Math.abs(Math.abs(look.yaw) - look.range) < 1e-6, `${kind}: looking around is limited to ±${look.range} rad`);
    await a.keyboard.press('KeyE');
    await sleep(1500);
    const out = await a.evaluate(() => {
      const g = window.__nower.gameRef.current;
      return { status: g.world.me.status, eye: g.camera.position.y - g.ctrl.y };
    });
    const fromB2 = await b.evaluate((id) => {
      const g = window.__nower.gameRef.current;
      return { status: g.world.players.get(id).status, modelVisible: g.remotes.get(id).model.root.visible };
    }, sa.me);
    check(out.status === 'free' && out.eye > 1.3 && fromB2.status === 'free' && fromB2.modelVisible, `${kind}: leaving restores movement and the standing camera, on both clients`);
  };
  await hideFlow('wardrobe', 31.5, 27.5);
  await hideFlow('bed', 29.5, 26.4);

  // look around the house a little for screenshots
  await a.evaluate(() => {
    const g = window.__nower.gameRef.current;
    g.ctrl.yaw += Math.PI;
  });
  await sleep(1500);
  await a.screenshot({ path: `${shots}/6-turned.png` });
  if (process.env.E2E_DEBUG_BEAM)
    console.log(
      await a.evaluate(() => {
        const r = [...window.__nower.gameRef.current.remotes.values()][0];
        const m = r.model.beam.material;
        return JSON.stringify({ opacity: m.opacity, transparent: m.transparent, blending: m.blending, type: m.type, depthWrite: m.depthWrite, vis: r.model.beam.visible, scale: r.model.beam.scale });
      }),
    );
  const fps = (await st(a)).fps;
  console.log(`      client A fps (two game windows open): ${fps}`);

  // audio: unlocked by the menu click, music layer reacting to the game
  const au = await a.evaluate(() => ({ state: window.__nower.audio.ctx?.state, music: window.__nower.audio.music?.current }));
  check(au.state === 'running', `Web Audio running after the user gesture (${au.state}, music: ${au.music})`);

  // the enemy is server-simulated: both clients must agree on where he is and what he does
  const ea = await a.evaluate(() => window.__nower.gameRef.current.world.latest.e);
  const eb = await b.evaluate(() => window.__nower.gameRef.current.world.latest.e);
  const ed = Math.hypot(ea[0] - eb[0], ea[2] - eb[2]);
  check(ed < 1.0 && ea[4] === eb[4], `enemy state consistent across clients (Δ ${ed.toFixed(2)}m, state ${ea[4]}/${eb[4]})`);

  // journal (Tab) and pause (Esc) menus
  await a.keyboard.press('Tab');
  await sleep(300);
  check(await a.isVisible('text=JOURNAL'), 'journal opens with Tab');
  await a.keyboard.press('Escape');
  await sleep(300);
  await a.keyboard.press('Escape');
  await sleep(300);
  check(await a.isVisible('text=PAUSED'), 'pause menu opens with Esc');
  await a.screenshot({ path: `${shots}/7-pause.png` });
  await a.keyboard.press('Escape');

  check(errors.length === 0, `no page errors (${errors.length})`);
  for (const e of errors.slice(0, 10)) console.log('      ' + e);
  await browser.close();
}

main()
  .catch((e) => {
    console.error(e);
    failed = true;
  })
  .finally(() => {
    server?.kill('SIGTERM');
    process.exit(failed ? 1 : 0);
  });
