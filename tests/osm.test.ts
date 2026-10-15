import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleRings, fillPlaceholders, normaliseQuery, osmToGeoJSON } from '../lib/osm.ts';

const g = (lon: number, lat: number) => ({ lon, lat });

test('tagged nodes become points', () => {
  const fc = osmToGeoJSON({ elements: [{ type: 'node', id: 1, lat: 51, lon: 0, tags: { amenity: 'cafe' } }] });
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry, { type: 'Point', coordinates: [0, 51] });
  assert.equal(fc.features[0].id, 'node/1');
});

test('out geom: closed building is a polygon, closed highway is a line', () => {
  const ring = [g(0, 0), g(1, 0), g(1, 1), g(0, 0)];
  const fc = osmToGeoJSON({
    elements: [
      { type: 'way', id: 1, tags: { building: 'yes' }, geometry: ring },
      { type: 'way', id: 2, tags: { highway: 'service' }, geometry: ring },
      { type: 'way', id: 3, tags: { highway: 'pedestrian', area: 'yes' }, geometry: ring },
    ],
  });
  assert.deepEqual(fc.features.map((f) => f.geometry.type), ['Polygon', 'LineString', 'Polygon']);
});

test('out body; >; out skel: resolves node ids and hides vertices', () => {
  const fc = osmToGeoJSON({
    elements: [
      { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
      { type: 'node', id: 1, lat: 0, lon: 0 },
      { type: 'node', id: 2, lat: 0, lon: 1 },
      { type: 'node', id: 3, lat: 1, lon: 1 },
    ],
  });
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry, { type: 'LineString', coordinates: [[0, 0], [1, 0], [1, 1]] });
});

test('out center gives points for ways', () => {
  const fc = osmToGeoJSON({ elements: [{ type: 'way', id: 1, center: { lat: 5, lon: 6 }, tags: { leisure: 'park' } }] });
  assert.deepEqual(fc.features[0].geometry, { type: 'Point', coordinates: [6, 5] });
});

test('multipolygon relation assembles split outer and inner rings', () => {
  const fc = osmToGeoJSON({
    elements: [
      {
        type: 'relation',
        id: 7,
        tags: { type: 'multipolygon', landuse: 'forest' },
        members: [
          { type: 'way', ref: 1, role: 'outer', geometry: [g(0, 0), g(10, 0), g(10, 10)] },
          { type: 'way', ref: 2, role: 'outer', geometry: [g(0, 0), g(0, 10), g(10, 10)] }, // reversed half
          { type: 'way', ref: 3, role: 'inner', geometry: [g(4, 4), g(6, 4), g(6, 6), g(4, 6), g(4, 4)] },
        ],
      },
    ],
  });
  assert.equal(fc.features.length, 1);
  const geom = fc.features[0].geometry;
  assert.equal(geom.type, 'Polygon');
  if (geom.type !== 'Polygon') return;
  assert.equal(geom.coordinates.length, 2);
  assert.equal(geom.coordinates[0].length, 5);
});

test('multipolygon with two disjoint outers is a MultiPolygon', () => {
  const sq = (o: number) => [g(o, 0), g(o + 1, 0), g(o + 1, 1), g(o, 1), g(o, 0)];
  const fc = osmToGeoJSON({
    elements: [{
      type: 'relation', id: 1, tags: { type: 'multipolygon', building: 'yes' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: sq(0) },
        { type: 'way', ref: 2, role: 'outer', geometry: sq(5) },
      ],
    }],
  });
  assert.equal(fc.features[0].geometry.type, 'MultiPolygon');
});

test('route relation becomes MultiLineString', () => {
  const fc = osmToGeoJSON({
    elements: [{
      type: 'relation', id: 1, tags: { type: 'route', route: 'bus' },
      members: [{ type: 'way', ref: 1, role: '', geometry: [g(0, 0), g(1, 1)] }, { type: 'node', ref: 5, role: 'stop', lat: 0, lon: 0 }],
    }],
  });
  assert.equal(fc.features[0].geometry.type, 'MultiLineString');
});

test('assembleRings closes an open ring', () => {
  const rings = assembleRings([[[0, 0], [1, 0]], [[1, 0], [1, 1]]]);
  assert.deepEqual(rings, [[[0, 0], [1, 0], [1, 1], [0, 0]]]);
});

test('normaliseQuery forces JSON output', () => {
  assert.equal(normaliseQuery('node(1);out;'), '[out:json][timeout:60];\nnode(1);out;');
  assert.equal(normaliseQuery('[out:xml][timeout:25];node(1);out;'), '[out:json][timeout:25];node(1);out;');
  assert.equal(normaliseQuery('[out:csv(::id, name; true)];node(1);out;'), '[out:json];node(1);out;');
});

test('fillPlaceholders', () => {
  const q = fillPlaceholders('node({{bbox}}); node(around:100,{{ center }});', { south: 1, west: 2, north: 3, east: 4 }, { lat: 5, lng: 6 });
  assert.equal(q, 'node(1.000000,2.000000,3.000000,4.000000); node(around:100,5.000000,6.000000);');
});
