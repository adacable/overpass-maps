import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCamera } from '../lib/camera-proto.ts';

// Minimal protobuf encoder to build payloads shaped like Google's.
const varint = (n: number) => { const o: number[] = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
const dbl = (f: number, v: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); return [...varint(f * 8 + 1), ...b]; };
const flt = (f: number, v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return [...varint(f * 8 + 5), ...b]; };
const msg = (f: number, body: number[]) => [...varint(f * 8 + 2), ...varint(body.length), ...body];
const vint = (f: number, v: number) => [...varint(f * 8), ...varint(v)];

const payload = (lat: number, lng: number, zoom: number, heading = 0, tilt = 0) =>
  new Uint8Array(msg(8, msg(2, [...msg(1, msg(3, [...dbl(1, lat), ...dbl(2, lng)])), ...dbl(2, zoom), ...dbl(5, heading), ...dbl(6, tilt), ...flt(8, 13.1), ...vint(11, 1)])));

test('decodes the camera', () => {
  assert.deepEqual(decodeCamera(payload(51.5045, -0.1275, 15.7083)), { lat: 51.5045, lng: -0.1275, zoom: 15.7083, rotated: false });
});

test('flags rotation and tilt', () => {
  assert.equal(decodeCamera(payload(51.5, 0, 16, 90))?.rotated, true);
  assert.equal(decodeCamera(payload(51.5, 0, 16, 0, 45))?.rotated, true);
});

test('works on a subarray view', () => {
  const p = payload(10, 20, 5);
  const padded = new Uint8Array(p.length + 4);
  padded.set(p, 2);
  assert.equal(decodeCamera(padded.subarray(2, 2 + p.length))?.lat, 10);
});

test('rejects other shapes and garbage', () => {
  assert.equal(decodeCamera(new Uint8Array([234, 1, 21, 18, 17, 29, 0, 0, 32, 68])), null);
  assert.equal(decodeCamera(new Uint8Array(msg(8, msg(2, dbl(2, 16))))), null);
  assert.equal(decodeCamera(new Uint8Array([0xff, 0xff, 0xff])), null);
  assert.equal(decodeCamera(new Uint8Array()), null);
});
