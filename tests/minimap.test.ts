import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTileUrl, viewFromTile } from '../lib/minimap.ts';
import { toScreen, unproject } from '../lib/mercator.ts';

const SRC = 'https://www.google.com/maps/vt/pb=!1m5!1m4!1i15!2i32743!3i21794!4i128!2m2!1e0!3i799999999!2m8!1e2!2ssvv';

test('parses tile URLs', () => {
  assert.deepEqual(parseTileUrl(SRC), { zoom: 15, x: 32743, y: 21794, size: 128 });
  assert.equal(parseTileUrl('https://example.com/foo.png'), null);
});

test('128px tiles are indexed on a grid twice as fine as their zoom', () => {
  // Captured from Google at the pegman (@51.497799,-0.1339792): the tile's
  // north-west corner must sit just north-west of it.
  const view = viewFromTile(parseTileUrl(SRC)!, { left: 0, top: 0, width: 128, height: 128 }, { left: 0, top: 0, width: 0, height: 0 });
  assert.ok(Math.abs(view.zoom - 15) < 1e-9, `zoom ${view.zoom}`);
  const [lng, lat] = unproject(view.cx, view.cy);
  assert.ok(lat > 51.497799 && lat - 51.497799 < 0.01, `lat ${lat}`);
  assert.ok(lng < -0.1339792 && -0.1339792 - lng < 0.01, `lng ${lng}`);
});

test('tile corner maps back to the tile rectangle', () => {
  const tile = { zoom: 10, x: 511, y: 340, size: 256 };
  const rect = { left: 200.5, top: -30, width: 512, height: 512 }; // drawn at 2x scale mid-zoom
  const vp = { left: 100, top: 50, width: 800, height: 600 };
  const view = viewFromTile(tile, rect, vp);
  assert.ok(Math.abs(view.zoom - 11) < 1e-9);
  const [sx, sy] = toScreen(view, tile.x / 1024, tile.y / 1024);
  assert.ok(Math.abs(sx + vp.left - rect.left) < 1e-6 && Math.abs(sy + vp.top - rect.top) < 1e-6);
});
