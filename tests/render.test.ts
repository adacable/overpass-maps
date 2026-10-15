import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, type View } from '../lib/mercator.ts';
import type { Feature, FeatureCollection, Geometry, Position } from '../lib/osm.ts';
import { draw, hitTest, prepare } from '../lib/render.ts';

// A 1000px view at zoom 16, centred on (0, 51.5).
const [cx, cy] = project(0, 51.5);
const view: View = { cx, cy, zoom: 16, width: 1000, height: 1000 };
const D = 0.001; // about 70 x 110 m: ~180 px wide at this zoom

const feature = (id: string, geometry: Geometry): Feature => ({ type: 'Feature', id, properties: {}, geometry });
const fc = (...features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
const square = (lng: number, lat: number, size: number): Position[][] => [
  [[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]],
];
/** Screen position of a lng/lat in `view`. */
const at = (lng: number, lat: number): [number, number] => {
  const [x, y] = project(lng, lat);
  const s = 256 * 2 ** view.zoom;
  return [(x - cx) * s + view.width / 2, (y - cy) * s + view.height / 2];
};
const ids = (hits: { id: string }[]) => hits.map((h) => h.id);

test('prepare orders areas, then lines, then points, and computes bounds', () => {
  const prepared = prepare(fc(
    feature('node/1', { type: 'Point', coordinates: [0, 51.5] }),
    feature('way/2', { type: 'LineString', coordinates: [[0, 51.5], [D, 51.5]] }),
    feature('way/3', { type: 'Polygon', coordinates: square(0, 51.5, D) }),
  ));
  assert.deepEqual(prepared.map((p) => p.kind), ['polygon', 'line', 'point']);
  const [x0, y0] = project(0, 51.5 + D);
  const [x1, y1] = project(D, 51.5);
  assert.deepEqual([prepared[0].minX, prepared[0].minY, prepared[0].maxX, prepared[0].maxY], [x0, y0, x1, y1]);
  assert.deepEqual(prepare(null), []);
});

test('hitTest ranks points, then lines, then areas smallest first', () => {
  const prepared = prepare(fc(
    feature('way/big', { type: 'Polygon', coordinates: square(-2 * D, 51.5 - 2 * D, 4 * D) }),
    feature('way/small', { type: 'Polygon', coordinates: square(-D, 51.5 - D, 2 * D) }),
    feature('way/line', { type: 'LineString', coordinates: [[-D, 51.5], [D, 51.5]] }),
    feature('node/pt', { type: 'Point', coordinates: [0, 51.5] }),
  ));
  assert.deepEqual(ids(hitTest(view, prepared, ...at(0, 51.5))), ['node/pt', 'way/line', 'way/small', 'way/big']);
  // Inside both areas, away from the line and point.
  assert.deepEqual(ids(hitTest(view, prepared, ...at(0.5 * D, 51.5 + 0.5 * D))), ['way/small', 'way/big']);
  // Outside everything.
  assert.deepEqual(ids(hitTest(view, prepared, ...at(10 * D, 51.5 + 10 * D))), []);
});

test('hitTest: a hole is not part of the area, but its edge is', () => {
  const outer = square(-2 * D, 51.5 - 2 * D, 4 * D)[0];
  const hole = square(-D, 51.5 - D, 2 * D)[0];
  const prepared = prepare(fc(feature('way/ring', { type: 'Polygon', coordinates: [outer, hole] })));
  assert.deepEqual(ids(hitTest(view, prepared, ...at(0, 51.5))), []);
  assert.deepEqual(ids(hitTest(view, prepared, ...at(-1.5 * D, 51.5))), ['way/ring']);
  assert.deepEqual(ids(hitTest(view, prepared, ...at(-D, 51.5))), ['way/ring']);
});

test('hitTest: shapes too small to see are hit as dots', () => {
  const tiny = D / 1000; // well under a pixel
  const prepared = prepare(fc(feature('way/tiny', { type: 'Polygon', coordinates: square(0, 51.5, tiny) })));
  const [x, y] = at(0, 51.5);
  assert.deepEqual(ids(hitTest(view, prepared, x + 6, y)), ['way/tiny']);
  assert.deepEqual(ids(hitTest(view, prepared, x + 20, y)), []);
});

/** A canvas context that records where dots (arcs) are drawn. */
function recordingContext(width: number, height: number) {
  const arcs: [number, number][] = [];
  const ctx = new Proxy({ canvas: { width, height }, arc: (x: number, y: number) => arcs.push([x, y]) } as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : () => {}),
    set: () => true,
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs };
}

const points = (...lngs: number[]) =>
  prepare(fc(...lngs.map((lng, i) => feature(`node/${i}`, { type: 'Point', coordinates: [lng, -17] }))));

test('draw: features either side of the antimeridian both show when the view straddles it', () => {
  const [x, y] = project(180, -17);
  const v: View = { cx: x, cy: y, zoom: 10, width: 1000, height: 500 };
  const { ctx, arcs } = recordingContext(1000, 500);
  draw(ctx, v, points(179.9, -179.9), 'red');
  assert.equal(arcs.length, 2);
  const [west, east] = arcs.map(([ax]) => ax).sort((a, b) => a - b);
  assert.ok(west < 500 && east > 500, `${west}, ${east}`);
});

test('draw: zoomed far out, every copy of the world in view is drawn', () => {
  const { ctx, arcs } = recordingContext(1000, 256);
  // At zoom 0 the world is 256px wide: copies of a point at the centre fall at
  // x = 500 ± 256k, of which 244, 500 and 756 are on screen.
  draw(ctx, { cx: 0.5, cy: 0.5, zoom: 0, width: 1000, height: 256 }, points(0), 'red');
  assert.deepEqual(arcs.map(([x]) => x), [244, 500, 756]);
});

test('hitTest finds a feature across the antimeridian', () => {
  const [x, y] = project(180, -17);
  const v: View = { cx: x, cy: y, zoom: 10, width: 1000, height: 500 };
  const prepared = points(-179.9);
  const s = 256 * 2 ** v.zoom;
  const [px, py] = project(-179.9, -17);
  // The point drawn east of the line, in the copy to the right of the centre.
  const sx = (px + 1 - x) * s + v.width / 2;
  const sy = (py - y) * s + v.height / 2;
  assert.deepEqual(ids(hitTest(v, prepared, sx, sy)), ['node/0']);
  // The point exactly on the seam, clicked from either side.
  const seam = points(180);
  assert.deepEqual(ids(hitTest(v, seam, v.width / 2 - 3, v.height / 2)), ['node/0']);
  assert.deepEqual(ids(hitTest(v, seam, v.width / 2 + 3, v.height / 2)), ['node/0']);
});
