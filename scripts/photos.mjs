// Visual tour: loads a solo match and photographs key areas with the debug camera.
// Usage: npm run build && node scripts/photos.mjs [--shots=dir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 3079;
const shots = (process.argv.find((a) => a.startsWith('--shots=')) ?? '--shots=test-results/tour').slice(8);
mkdirSync(shots, { recursive: true });
const server = spawn('node', ['server/dist/index.js'], { env: { ...process.env, PORT: String(PORT), STATIC_DIR: 'client/dist', LOG_LEVEL: 'warn' }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SETS = {};
SETS.tour = [
  ['front-exterior', 48.5, 1.8, 76, 0, 0.12],
  ['entrance-hall', 44, 5.6, 42.5, -2.4, -0.35],
  ['grand-stair', 48.5, 1.7, 55, 0, 0.05],
  ['library', 26, 1.7, 26.5, 0.4, -0.05],
  ['kitchen', 55, 1.7, 33, -2.6, -0.1],
  ['dining', 60, 1.7, 53, -2.3, -0.12],
  ['the-nower', 40.5, -2.35, 31.4, Math.PI, -0.05],
  ['holding-cells', 41.8, -2.4, 34.5, 0.9, -0.15],
  ['garage-car', 87.5, 1.9, 44, 0.75, -0.25],
  ['basement-workshop', 64, -2.4, 34.5, -0.6, -0.15],
  ['sewer-channel', 73, -6.4, 58, 1.57, -0.1],
  ['flooded-cistern', 39, -6.3, 58, 1.57, -0.2],
  ['attic', 44, 9.7, 33, -0.9, -0.1],
  ['back-garden', 40, 1.8, 6, -2.6, 0.05],
];
// stairwells and floor openings (where floors meet)
SETS.stairs = [
  ['cellar-stair-mid-west', 50.0, -0.6, 29.0, Math.PI / 2, 0.0],
  ['cellar-stair-mid-east', 49.6, -0.6, 29.0, -Math.PI / 2, 0.0],
  ['cellar-stair-top-down', 49.9, 1.2, 33.4, 0, -0.35],
  ['cellar-stair-bottom-up', 49.9, -2.4, 23.4, Math.PI, 0.35],
  ['back-stair-mid', 71, 3.6, 30.0, 0, 0.0],
  ['attic-stair-mid', 46.9, 7.6, 30.0, Math.PI / 2, 0.0],
  ['hall-look-up', 44, 1.6, 50, 0, 0.75],
  ['grand-stair-mid-side', 48.4, 3.4, 48.0, Math.PI / 2, 0.0],
  ['sewer-stair-mid', 70.9, -5.2, 44.0, Math.PI / 2, 0.0],
  ['garage-stair-mid', 88.9, -1.0, 35.5, Math.PI / 2, 0.0],
];
// broad audit of areas that are easy to get wrong
SETS.audit = [
  ['gallery-balustrade', 44.5, 5.6, 43.0, -2.2, -0.35],
  ['hall-from-door', 48.5, 1.6, 54.8, 0, 0.15],
  ['window-reveal-living', 22.2, 1.6, 52.0, 2.2, 0.05],
  ['front-door-locks', 48.9, 1.6, 52.5, Math.PI, 0.0],
  ['library-bookcase', 31.0, 1.6, 21.5, -1.3, -0.05],
  ['boiler-brick-door', 35.4, -2.4, 22.0, 1.2, -0.05],
  ['servants-panel', 58.5, 5.6, 26.0, 0, 0.0],
  ['attic-dusty', 34, 9.5, 36, 0.3, -0.12],
  ['attic-stair-top', 46.9, 9.6, 24.2, Math.PI, -0.5],
  ['garage-shutter', 83, 1.7, 41, Math.PI, 0.05],
  ['valve-chamber', 32, -6.4, 46, 0, 0.05],
  ['sewer-niche', 13, -6.5, 40, 1.57, 0],
  ['outfall', 11.5, -6.4, 9.5, 0, 0.25],
  ['conservatory', 70, 1.6, 26.5, -0.6, 0.1],
];
const VIEWS = SETS[(process.argv.find((a) => a.startsWith('--set=')) ?? '--set=tour').slice(6)];

async function main() {
  await sleep(1200);
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=-3000,0', '--ignore-gpu-blocklist', '--mute-audio'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/?debug`);
  await page.click('text=CLICK ANYWHERE TO ENTER');
  await page.click('text=PLAY');
  await page.waitForSelector('.game-canvas');
  await page.waitForFunction(() => !document.querySelector('.loading-bar'), null, { timeout: 90000 });
  await page.keyboard.press('Space');
  await sleep(1500);
  await page.addStyleTag({ content: '.hud, .click-to-play { display: none !important; }' });
  for (const [name, x, y, z, yaw, pitch] of VIEWS) {
    await page.evaluate((c) => {
      const g = window.__nower.gameRef.current;
      g.debugCam = c;
    }, { x, y, z, yaw, pitch });
    await sleep(900);
    await page.screenshot({ path: `${shots}/${name}.png` });
    console.log('shot', name);
  }
  await browser.close();
}
main()
  .catch((e) => console.error(e))
  .finally(() => {
    server.kill('SIGTERM');
    process.exit(0);
  });
