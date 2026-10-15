import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installCameraHook } from '../lib/camera-hook.ts';

test('installing the hook twice wraps postMessage only once', () => {
  const sent: unknown[] = [];
  class FakeWorker {
    postMessage(m: unknown) {
      sent.push(m);
    }
  }
  const g = globalThis as Record<string, unknown>;
  const saved = { Worker: g.Worker, document: g.document };
  g.Worker = FakeWorker;
  g.document = { dispatchEvent: () => true };
  try {
    installCameraHook();
    const wrapped = FakeWorker.prototype.postMessage;
    installCameraHook(); // e.g. Firefox re-running content scripts after an update
    assert.equal(FakeWorker.prototype.postMessage, wrapped);
    new FakeWorker().postMessage('hi');
    assert.deepEqual(sent, ['hi']);
  } finally {
    Object.assign(g, saved);
  }
});
