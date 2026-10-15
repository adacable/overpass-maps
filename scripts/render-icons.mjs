// Render assets/icon*.svg to public/icon/*.png. 128 is padded per Chrome's store guidelines (96px art).
// Usage: node scripts/render-icons.mjs  (needs playwright: see scripts/store-screenshots/README.md)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
// about:blank can't load file:// URLs, so embed the SVG.
const svg = (path) => 'data:image/svg+xml;base64,' + readFileSync(path).toString('base64');
const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
// The tile spans 120 of the SVG's 128 units.
const jobs = [[16, 'icon-16.svg', 16], [32, 'icon.svg', 32], [48, 'icon.svg', 48], [96, 'icon.svg', 96], [128, 'icon.svg', 96 * 128 / 120]];
for (const [size, src, img] of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const off = (size - img) / 2;
  await p.setContent(`<body style="margin:0;background:transparent"><img src="${svg(`${repo}/assets/${src}`)}" style="position:absolute;left:${off}px;top:${off}px;width:${img}px;height:${img}px">`);
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${repo}/public/icon/${size}.png`, omitBackground: true });
  await p.close();
}
await b.close();
