import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandBounds, fromScreen, project, toScreen, unproject, viewBounds, type View } from '../lib/mercator.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('project/unproject round-trip', () => {
  for (const [lng, lat] of [[0, 0], [-0.1246, 51.5007], [139.69, 35.68], [-179.9, -80]]) {
    const [x, y] = project(lng, lat);
    const [lng2, lat2] = unproject(x, y);
    close(lng2, lng);
    close(lat2, lat);
  }
});

test('project matches known tile coordinates', () => {
  // Greenwich at zoom 0 sits at x = 128px of a 256px world.
  const [x, y] = project(0, 0);
  close(x, 0.5);
  close(y, 0.5);
});

test('screen centre maps to view centre', () => {
  const [cx, cy] = project(-0.1246, 51.5007);
  const v: View = { cx, cy, zoom: 15.5, width: 1200, height: 800 };
  const [sx, sy] = toScreen(v, cx, cy);
  close(sx, 600);
  close(sy, 400);
  const [x, y] = fromScreen(v, 100, 50);
  const [sx2, sy2] = toScreen(v, x, y);
  close(sx2, 100);
  close(sy2, 50);
});

test('viewBounds at zoom 0 with a 256px viewport covers the world', () => {
  const b = viewBounds({ cx: 0.5, cy: 0.5, zoom: 0, width: 256, height: 256 });
  close(b.west, -180);
  close(b.east, 180);
  close(b.north, 85.0511287798066, 1e-6);
});

test('expandBounds grows small boxes and leaves big ones', () => {
  const small = { south: 51.5, west: -0.13, north: 51.501, east: -0.129 };
  const grown = expandBounds(small, 2);
  close((grown.north - grown.south) * 110.574, 2, 1e-6);
  close((grown.east - grown.west) * 111.32 * Math.cos((51.5005 * Math.PI) / 180), 2, 1e-6);
  close((grown.north + grown.south) / 2, 51.5005);
  const big = { south: 51, west: -1, north: 52, east: 1 };
  assert.deepEqual(expandBounds(big, 2), big);
  assert.deepEqual(expandBounds(small, 0), small);
});
