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

test('unproject wraps longitudes from neighbouring copies of the world', () => {
  close(unproject(1.25, 0.5)[0], -90);
  close(unproject(-0.25, 0.5)[0], 90);
});

test('viewBounds across the antimeridian has west > east', () => {
  // Centred on 180°, 2 degrees wide.
  const [cx, cy] = project(180, -17);
  const ws = 256 * 2 ** 8;
  const b = viewBounds({ cx, cy, zoom: 8, width: (2 / 360) * ws, height: 100 });
  close(b.west, 179, 1e-9);
  close(b.east, -179, 1e-9);
  // Panned past 180°: the centre's x is beyond 1.
  const past = viewBounds({ cx: cx + 1 / 360, cy, zoom: 8, width: (2 / 360) * ws, height: 100 });
  close(past.west, -180, 1e-9);
  close(past.east, -178, 1e-9);
});

test('viewBounds showing more than one world covers all longitudes', () => {
  const b = viewBounds({ cx: 0.3, cy: 0.5, zoom: 0, width: 1000, height: 256 });
  assert.equal(b.west, -180);
  assert.equal(b.east, 180);
});

test('expandBounds keeps a box that crosses the antimeridian crossing it', () => {
  const b = expandBounds({ south: -17.01, west: 179.995, north: -17, east: -179.995 }, 10);
  assert.ok(b.west > 179 && b.west < 180, `west ${b.west}`);
  assert.ok(b.east < -179 && b.east > -180, `east ${b.east}`);
  close(b.east + 360 - b.west, 10 / (111.32 * Math.cos((-17.005 * Math.PI) / 180)), 1e-9);
  // Growing a box that ends at 180° pushes it across the line.
  const edge = expandBounds({ south: 0, west: 179.99, north: 0.01, east: 180 }, 10);
  assert.ok(edge.west < 179.99 && edge.east < 0, JSON.stringify(edge));
  // A huge minimum covers the whole world.
  assert.deepEqual([expandBounds({ south: 0, west: 0, north: 1, east: 1 }, 1e6).west, expandBounds({ south: 0, west: 0, north: 1, east: 1 }, 1e6).east], [-180, 180]);
});
