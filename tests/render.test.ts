import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, type View } from '../lib/mercator.ts';
import type { Feature, FeatureCollection, Geometry, Position } from '../lib/osm.ts';
import { hitTest, prepare } from '../lib/render.ts';

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
