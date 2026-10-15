// Store screenshots, Firefox (via Puppeteer + WebDriver BiDi), replaying the storage chrome.mjs saved.
// Usage: node scripts/store-screenshots/firefox.mjs <search|card|streetview> [headless=true]
// The card scene clicks CLICK=x,y (the spot chrome.mjs logged); street view needs headless=false.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, cpSync, appendFileSync, rmSync, readdirSync } from 'node:fs';
// Paths: repo root from this file; Firefox from FIREFOX_PATH (macOS default below).
const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = `${ROOT}.output/store-screenshots/raw`;
const [scene, headless = 'true'] = process.argv.slice(2);
const extDir = `${ROOT}.output/firefox-mv2`, dir = OUT;
const FIREFOX = process.env.FIREFOX_PATH ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const { storage, url } = JSON.parse(readFileSync(`${dir}/${scene}-storage.json`, 'utf8'));
const popup = scene === 'search';

// A copy of the build that seeds storage and, for the popup scene, opens the popup in a tab.
const build = `${OUT}/firefox-build-${scene}`;
rmSync(build, { recursive: true, force: true });
cpSync(extDir, build, { recursive: true });
let bg = `\n;browser.storage.local.set(${JSON.stringify(storage)});\n`;
if (popup) {
  // Puppeteer can't see extension tabs, so the background captures the popup
  // itself and hands the image to the map page as an attribute.
  bg += `;setTimeout(async () => {
    const win = await browser.windows.create({ url: browser.runtime.getURL('popup.html'), type: 'popup', width: 400, height: 760 });
    await new Promise((r) => setTimeout(r, 4000));
    const shot = await browser.tabs.captureTab(win.tabs[0].id);
    const [maps] = await browser.tabs.query({ url: 'https://www.google.com/maps/*' });
    await browser.tabs.executeScript(maps.id, { code: 'document.documentElement.dataset.popupShot = ' + JSON.stringify(shot) });
  }, 20000);\n`;
  const mf = JSON.parse(readFileSync(`${build}/manifest.json`, 'utf8'));
  mf.permissions.push('<all_urls>', 'tabs');
  writeFileSync(`${build}/manifest.json`, JSON.stringify(mf));
  // In a tab, the popup's "current window" tab is itself: point it at the map tab.
  const chunk = readdirSync(`${build}/chunks`).find((f) => f.startsWith('popup-'));
  const p = `${build}/chunks/${chunk}`;
  writeFileSync(p, readFileSync(p, 'utf8').replace('currentWindow:!0', 'url:"https://www.google.com/maps/*"'));
}
appendFileSync(`${build}/background.js`, bg);

const browser = await puppeteer.launch({
  browser: 'firefox', executablePath: FIREFOX, headless: headless === 'true', args: ['--new-instance'],
  defaultViewport: { width: 1280, height: 800 },
  extraPrefsFirefox: { 'intl.accept_languages': 'en-GB', 'layout.css.prefers-color-scheme.content-override': 1 },
});
await browser.installExtension(build);
const page = await browser.newPage();
for (const p of await browser.pages()) if (p !== page) await p.close();
await page.goto(url, { waitUntil: 'domcontentloaded' });
try { const b = await page.waitForSelector('::-p-xpath(//button[.//text()[contains(., "Reject all")]])', { timeout: 10000 }); await b.click(); await page.waitForNavigation({ timeout: 15000 }).catch(() => {}); } catch {}
await page.waitForFunction(() => location.pathname.startsWith('/maps'), { timeout: 20000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(scene === 'streetview' ? 14000 : 9000);

if (scene === 'card') {
  // Same view and window size as the Chrome run, so the same spot.
  const [sx, sy] = process.env.CLICK.split(',').map(Number);
  await page.mouse.click(sx, sy); await wait(800); await page.mouse.move(sx + 1, sy + 1); await wait(400);
} else if (scene === 'streetview') {
  const box = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].filter((e) => /^expand$/i.test(e.getAttribute('aria-label'))).map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  const b = box.find(([x, y]) => x < 300 && y > 600);
  console.log('expand', JSON.stringify(box));
  if (b) { await page.mouse.click(...b); await wait(4000); await page.mouse.click(1245, 732); await wait(4000); }
  await page.mouse.move(640, 300); await page.evaluate(() => document.activeElement?.blur()); await wait(1500);
} else {
  await page.mouse.move(1270, 790); await wait(400);
}
await page.evaluate(() => {
  // Google's transient promo tooltip and area card have no close button: hide them.
  for (const [word, maxW, maxH] of [['Dua Lipa', 200, 70], ['Heavy traffic', 400, 140], ['Minimise', 110, 40]]) {
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
await page.screenshot({ path: `${dir}/ff-${scene}-map.png` });

if (popup) {
  const shot = await page.waitForFunction(() => document.documentElement.dataset.popupShot, { timeout: 60000, polling: 1000 }).then((h) => h.jsonValue());
  writeFileSync(`${dir}/ff-${scene}-popup-raw.png`, Buffer.from(shot.split(',')[1], 'base64'));
}
await browser.close();
