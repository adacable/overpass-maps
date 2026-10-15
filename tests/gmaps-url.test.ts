import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCamera } from '../lib/gmaps-url.ts';
import { metersPerPixel } from '../lib/mercator.ts';

test('parses map view zoom', () => {
  const c = parseCamera('https://www.google.com/maps/@51.5007,-0.1246,15.5z?entry=ttu', 800);
  assert.deepEqual(c, { lat: 51.5007, lng: -0.1246, zoom: 15.5, rotated: false });
});

test('parses place URLs', () => {
  const c = parseCamera('https://www.google.com/maps/place/Big+Ben/@51.5007292,-0.1246254,17z/data=!3m1!4b1', 800);
  assert.equal(c?.zoom, 17);
  assert.equal(c?.lat, 51.5007292);
});

test('converts satellite metres to zoom', () => {
  const c = parseCamera('https://www.google.com/maps/@51.5,-0.12,2000m/data=!3m1!1e3', 800)!;
  assert.ok(Math.abs(metersPerPixel(51.5, c.zoom!) - 2000 / 800) < 1e-9);
  assert.equal(c.rotated, false);
});

test('flags 3D and rotated views', () => {
  assert.equal(parseCamera('https://www.google.com/maps/@51.5,-0.12,500a,35y,90h,45t/data=!3m1!1e3', 800)?.rotated, true);
  assert.equal(parseCamera('https://www.google.com/maps/@51.5,-0.12,15z,30h', 800)?.rotated, true);
  assert.equal(parseCamera('https://www.google.com/maps/@51.5,-0.12,15z,0h,0t', 800)?.rotated, false);
});

test('returns null without a camera', () => {
  assert.equal(parseCamera('https://www.google.com/maps', 800), null);
});
