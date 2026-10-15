// Store screenshots, Chrome: run real queries through the real popup, capture the
// map (with the card) and the popup, and save each scene's storage for firefox.mjs.
// Usage: node scripts/store-screenshots/chrome.mjs [scene,scene]
import { chromium } from 'playwright';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
// Paths: repo root from this file; Chrome from CHROME_PATH, else Playwright's Chromium
// (branded Chrome 137+ ignores --load-extension).
const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = `${ROOT}.output/store-screenshots/raw`;
const [only] = process.argv.slice(2);
const extDir = `${ROOT}.output/chrome-mv3`, outDir = OUT, exe = process.env.CHROME_PATH;
const { project, toScreen } = await import(`${ROOT}lib/mercator.ts`);
mkdirSync(outDir, { recursive: true });

const SV_URL = 'https://www.google.com/maps/@51.497799,-0.1339792,3a,75y,93.77h,90t/data=!3m6!1e1!3m4!1sFbJwHjVXLBcq2MzGgekxBg!2e0!7i16384!8i8192?hl=en';
const SCENES = [
  {
    id: 'search',
    url: 'https://www.google.com/maps/@51.5065,-0.1640,15z?hl=en',
    query: '// Parks and gardens around the map view.\n[out:json][timeout:60];\nnwr[leisure~"^(park|garden)$"]({{bbox}});\nout geom;',
    pick: null, popup: true,
  },
  {
    id: 'card',
    url: 'https://www.google.com/maps/@51.5130,-0.1310,17z?hl=en',
    query: '// Cafés around the map view.\n[out:json][timeout:25];\nnwr[amenity=cafe]({{bbox}});\nout center;',
    pick: (f) => f.geometry.type === 'Point' && f.properties['brand:wikidata'] && Object.keys(f.properties).length > 7,
    popup: false,
  },
  {
    id: 'streetview',
    url: 'https://www.google.com/maps/@51.497799,-0.1339792,17z?hl=en',
    query: '// Street trees around the map view.\n[out:json][timeout:25];\nnode[natural=tree]({{bbox}});\nout;',
    pick: null, popup: false, then: SV_URL,
  },
];

const profile = `${outDir}/profile`;
rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { executablePath: exe, headless: true, viewport: { width: 1280, height: 800 }, locale: 'en-GB', args: ['--remote-debugging-port=9336', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const page = await ctx.newPage();
for (const p of ctx.pages()) if (p !== page) await p.close();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));

async function openPopup() {
  await page.bringToFront();
  await sw.evaluate(() => chrome.action.openPopup()).catch((e) => console.log('openPopup failed:', e.message));
  let target;
  for (let i = 0; i < 20 && !target; i++) {
    await new Promise((r) => setTimeout(r, 250));
    target = (await (await fetch('http://127.0.0.1:9336/json/list')).json()).find((t) => t.url.endsWith('/popup.html'));
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0;
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = ++n;
    ws.addEventListener('message', function on(m) { const d = JSON.parse(m.data); if (d.id === id) { ws.removeEventListener('message', on); resolve(d.result); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async (expression) => (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
  await new Promise((r) => setTimeout(r, 1000));
  return { call, js, close: async () => { await js('window.close()').catch(() => {}); ws.close(); await new Promise((r) => setTimeout(r, 600)); } };
}

let first = true;
for (const s of SCENES.filter((s) => !only || only.split(',').includes(s.id))) {
  await page.goto(s.url, { waitUntil: 'domcontentloaded' });
  if (first) {
    const consent = page.getByRole('button', { name: /reject all|accept all/i }).first();
    if (await consent.isVisible({ timeout: 8000 }).catch(() => false)) await consent.click();
    first = false;
  }
  await page.waitForTimeout(7000);
  await sw.evaluate(async ({ query, color }) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ query, results: null, status: { state: 'idle' }, settings: { minBboxKm: 2, endpoint: 'https://overpass-api.de/api/interpreter', visible: true, ...settings, color } });
  }, { query: s.query, color: '#3f3d96' });

  // Run the query from the popup, as a user would.
  // If a server is busy, try the next one, like the popup's "Try …" button.
  let p, status;
  for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    await sw.evaluate((endpoint) => chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, endpoint } })), endpoint);
    p = await openPopup();
    await p.js(`document.getElementById('run').click()`);
    for (let i = 0; i < 200; i++) {
      await page.waitForTimeout(1000);
      status = await sw.evaluate(() => chrome.storage.local.get('status').then((r) => r.status));
      if (status.state !== 'running') break;
    }
    console.log(s.id, endpoint, JSON.stringify(status));
    await p.close();
    if (status.state === 'done') break;
  }
  await sw.evaluate(() => chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, endpoint: 'https://overpass-api.de/api/interpreter' } })));
  await page.waitForTimeout(1500);
  const dump = await sw.evaluate(() => chrome.storage.local.get(null));
  writeFileSync(`${outDir}/${s.id}-storage.json`, JSON.stringify({ storage: dump, url: s.then ?? page.url() }));
  if (s.then) { await page.goto(s.then, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(9000); }

  // The card, on a feature found by projecting it with the URL's camera.
  const fc = await sw.evaluate(() => chrome.storage.local.get('results').then((r) => r.results));
  const m = page.url().match(/@(-?[\d.]+),(-?[\d.]+),([\d.]+)z/);
  const [cx, cy] = m ? project(Number(m[2]), Number(m[1])) : [0, 0];
  const view = { cx, cy, zoom: m ? Number(m[3]) : 0, width: 1280, height: 800 };
  // Mean of the vertices: inside any roughly convex shape.
  const screenOf = (f) => {
    const nums = [f.geometry.coordinates].flat(Infinity);
    const mean = (k) => nums.filter((_, i) => i % 2 === k).reduce((a, b) => a + b, 0) / (nums.length / 2);
    return toScreen(view, ...project(mean(0), mean(1)));
  };
  // Clear of Google's panels, with room for the card beside it.
  const central = ([x, y]) => x > 480 && x < 860 && y > 220 && y < 520;
  const cands = (s.pick && fc?.features.filter((f) => s.pick(f) && central(screenOf(f)))) || [];
  console.log(s.id, 'card candidates', cands.length);
  const f = s.pick && fc?.features.find((f) => s.pick(f) && central(screenOf(f)));
  if (f) {
    const [sx, sy] = screenOf(f);
    console.log(s.id, 'card on', f.properties.name, Math.round(sx), Math.round(sy));
    await page.mouse.click(sx, sy);
    await page.waitForTimeout(800);
    await page.mouse.move(sx + 1, sy + 1);
    await page.waitForTimeout(400);
  } else {
    await page.mouse.move(1270, 790);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => {
  // Google's transient promo tooltip and area card have no close button: hide them.
  for (const [word, maxW, maxH] of [['Dua Lipa', 200, 70], ['Heavy traffic', 400, 140]]) {
    const els = [...document.querySelectorAll('body *')].filter((e) => e.textContent.includes(word));
    let box = els[els.length - 1];
    if (!box) continue;
    while (box.parentElement) {
      const r = box.parentElement.getBoundingClientRect();
      if (!r.width || r.width > maxW || r.height > maxH) break;
      box = box.parentElement;
    }
    box.style.visibility = 'hidden';
  }
});
  await page.screenshot({ path: `${outDir}/${s.id}-map.png` });

  if (!s.popup) continue;
  // The popup after the run.
  p = await openPopup();
  await p.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await new Promise((r) => setTimeout(r, 500));
  writeFileSync(`${outDir}/${s.id}-popup.png`, Buffer.from((await p.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await p.close();
  await page.keyboard.press('Escape');
}
console.log('page errors:', errors);
await ctx.close();
