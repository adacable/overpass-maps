// Store screenshot, Chrome Street View: replays the storage chrome.mjs saved. Runs headed:
// headless Chrome renders the panorama black.
import { chromium } from 'playwright';
import { readFileSync, rmSync } from 'node:fs';
// Paths: repo root from this file; Chrome from CHROME_PATH, else Playwright's Chromium
// (branded Chrome 137+ ignores --load-extension).
const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = `${ROOT}.output/store-screenshots/raw`;
const extDir = `${ROOT}.output/chrome-mv3`, outDir = OUT, exe = process.env.CHROME_PATH, headless = 'false';
const { storage, url } = JSON.parse(readFileSync(`${outDir}/streetview-storage.json`, 'utf8'));
const profile = `${OUT}/profile-sv`; rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { executablePath: exe, headless: headless === 'true', viewport: { width: 1280, height: 800 }, locale: 'en-GB', args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--enable-gpu', '--use-angle=metal'] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
await sw.evaluate((s) => chrome.storage.local.set(s), storage);
const page = await ctx.newPage();
for (const p of ctx.pages()) if (p !== page) await p.close();
await page.goto(url, { waitUntil: 'domcontentloaded' });
const consent = page.getByRole('button', { name: /reject all/i }).first();
if (await consent.waitFor({ timeout: 10000 }).then(() => true, () => false)) { await consent.click(); await page.waitForURL(/google.com\/maps/, { timeout: 15000 }); }
await page.waitForTimeout(12000);
const box = await page.evaluate(() => { const els = [...document.querySelectorAll('button[aria-label], [role=button][aria-label]')].filter((e) => /expand/i.test(e.getAttribute('aria-label'))); return els.map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label'), r.x + r.width / 2, r.y + r.height / 2]; }); });
console.log('expand buttons', JSON.stringify(box));
const b = box.find(([, x, y]) => x < 300 && y > 600);
if (b) { await page.mouse.click(b[1], b[2]); await page.waitForTimeout(4000); await page.mouse.click(1245, 732); await page.waitForTimeout(4000); }
await page.mouse.move(640, 300); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/streetview-map.png` });
await ctx.close();
