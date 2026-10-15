import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkOn } from '../lib/color.ts';

test('inkOn picks the more readable of black and white', () => {
  assert.equal(inkOn('#e8175d'), '#fff');
  assert.equal(inkOn('#1a292e'), '#fff');
  assert.equal(inkOn('#ffeb3b'), '#000');
  assert.equal(inkOn('#ffffff'), '#000');
  assert.equal(inkOn('nonsense'), '#fff');
});
