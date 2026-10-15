import { defineUnlistedScript } from '#imports';
import { CAMERA_EVENT, decodeCamera } from '@/lib/camera-proto.ts';

// Runs in the page's own JS context (injected by maps.content.ts). Watches the
// camera updates Google Maps posts to its render worker and re-broadcasts them
// as DOM events. It only reads the messages; they're always passed on unchanged.
export default defineUnlistedScript(() => {
  const proto = Worker.prototype as Worker & { __overpassMapsHooked?: boolean };
  if (proto.__overpassMapsHooked) return; // already hooked (e.g. extension reloaded)
  proto.__overpassMapsHooked = true;

  const original = proto.postMessage;
  proto.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
    try {
      const m = message as { command?: unknown; methodType?: unknown; payload?: unknown } | null;
      if (m && m.command === 9 && m.methodType === 8) {
        const p = m.payload;
        const bytes = p instanceof Uint8Array ? p : p instanceof ArrayBuffer ? new Uint8Array(p) : null;
        const cam = bytes && decodeCamera(bytes);
        // A string detail crosses into the content script's world in every browser.
        if (cam) document.dispatchEvent(new CustomEvent(CAMERA_EVENT, { detail: JSON.stringify(cam) }));
      }
    } catch {
      // Never let the overlay interfere with the map.
    }
    return (original as (...a: unknown[]) => void).call(this, message, ...rest);
  } as Worker['postMessage'];
});
