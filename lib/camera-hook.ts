import { CAMERA_EVENT, decodeCamera } from './camera-proto.ts';

/**
 * Runs in the page's own JS context. Watches the camera updates Google Maps
 * posts to its render worker and re-broadcasts them as DOM events. It only
 * reads the messages; they're always passed on unchanged.
 *
 * Chrome loads this as a MAIN-world content script; Firefox (MV2 has no MAIN
 * world) injects it as a <script> from maps.content.ts.
 */
/**
 * Marks our wrapper, so a second install is skipped: Firefox re-runs content
 * scripts in open tabs when the extension updates, and the old wrapper is
 * still in place and still working. (The wrapper is visible to the page
 * anyway, so the mark gives nothing away.)
 */
const HOOKED = Symbol.for('overpass-maps.hook');

export function installCameraHook(): void {
  const proto = Worker.prototype;
  const original = proto.postMessage;
  if (HOOKED in original) return;
  proto.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
    try {
      const m = message as { command?: unknown; methodType?: unknown; payload?: unknown } | null;
      if (m && m.command === 9 && m.methodType === 8) {
        const p = m.payload;
        const bytes = p instanceof Uint8Array ? p : p instanceof ArrayBuffer ? new Uint8Array(p) : null;
        const cam = bytes && decodeCamera(bytes);
        if (cam) document.dispatchEvent(new CustomEvent(CAMERA_EVENT, { detail: JSON.stringify(cam) }));
      }
    } catch {
      // Never let the overlay interfere with the map.
    }
    return (original as (...a: unknown[]) => void).call(this, message, ...rest);
  } as Worker['postMessage'];
  Object.defineProperty(proto.postMessage, HOOKED, { value: true });
}
