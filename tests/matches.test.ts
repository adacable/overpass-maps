import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHttpsUrl } from '../lib/matches.ts';

test('isHttpsUrl', () => {
  assert.equal(isHttpsUrl('https://overpass-api.de/api/interpreter'), true);
  assert.equal(isHttpsUrl('http://overpass-api.de/api/interpreter'), false);
  assert.equal(isHttpsUrl('overpass-api.de/api/interpreter'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
  assert.equal(isHttpsUrl(''), false);
});
