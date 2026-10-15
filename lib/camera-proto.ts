// Google Maps renders the map in a worker (OffscreenCanvas). Every frame the
// main thread posts the camera to that worker as a protobuf, in a message like
//   { command: 9, methodType: 8, payload: Uint8Array }
// with the payload laid out as (field numbers, found by inspection):
//   8 { 2 { 1 { 3 { 1: lat, 2: lng } }, 2: zoom, 5: ?, 6: ? , 8: fov, ... } }
// Fields 5/6 are 0 in flat 2D views; assumed to be heading/tilt.
// This is undocumented and may change; callers must tolerate null.

export interface MapCamera {
  lat: number;
  lng: number;
  zoom: number;
  /** True when the camera looks rotated or tilted. */
  rotated: boolean;
}

type Field = { field: number; wire: number; num?: number; start?: number; end?: number };

/** Read the top-level fields of a protobuf message in bytes[start, end). */
function readFields(b: Uint8Array, start: number, end: number): Field[] | null {
  const out: Field[] = [];
  let i = start;
  const varint = (): number | null => {
    let x = 0;
    let mul = 1;
    for (let n = 0; n < 10; n++) {
      if (i >= end) return null;
      const c = b[i++];
      x += (c & 0x7f) * mul;
      if (c < 0x80) return x;
      mul *= 128;
    }
    return null;
  };
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (i < end) {
    const key = varint();
    if (key === null) return null;
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      const v = varint();
      if (v === null) return null;
      out.push({ field, wire, num: v });
    } else if (wire === 1) {
      if (i + 8 > end) return null;
      out.push({ field, wire, num: view.getFloat64(i, true) });
      i += 8;
    } else if (wire === 5) {
      if (i + 4 > end) return null;
      out.push({ field, wire, num: view.getFloat32(i, true) });
      i += 4;
    } else if (wire === 2) {
      const len = varint();
      if (len === null || i + len > end) return null;
      out.push({ field, wire, start: i, end: i + len });
      i += len;
    } else {
      return null;
    }
  }
  return out;
}

function sub(b: Uint8Array, fields: Field[] | null, n: number): Field[] | null {
  const f = fields?.find((x) => x.field === n && x.wire === 2);
  return f ? readFields(b, f.start!, f.end!) : null;
}

function num(fields: Field[] | null, n: number): number | undefined {
  const f = fields?.find((x) => x.field === n && (x.wire === 1 || x.wire === 5));
  return f?.num;
}

export function decodeCamera(payload: Uint8Array): MapCamera | null {
  const cam = sub(payload, sub(payload, readFields(payload, 0, payload.length), 8), 2);
  const latLng = sub(payload, sub(payload, cam, 1), 3);
  const camera = {
    lat: num(latLng, 1),
    lng: num(latLng, 2),
    zoom: num(cam, 2),
    rotated: (num(cam, 5) ?? 0) !== 0 || (num(cam, 6) ?? 0) !== 0,
  };
  return isValidCamera(camera) ? camera : null;
}

/** Whether `c` is a camera with a plausible position and zoom. */
function isValidCamera(c: unknown): c is MapCamera {
  const cam = c as Partial<MapCamera> | null;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  return (
    !!cam && finite(cam.lat) && finite(cam.lng) && finite(cam.zoom) && typeof cam.rotated === 'boolean' &&
    Math.abs(cam.lat) <= 90 && Math.abs(cam.lng) <= 360 && cam.zoom >= 0 && cam.zoom <= 30
  );
}

/**
 * The hook (camera-hook.ts) re-broadcasts each camera as a DOM event with a
 * JSON string detail: a string crosses into the content script's world in
 * every browser.
 */
export const CAMERA_EVENT = 'overpass-maps:camera';

/** Read a CAMERA_EVENT's detail. Any script on the page can send one, so only a sane camera is accepted. */
export function parseCameraEvent(detail: unknown): MapCamera | null {
  if (typeof detail !== 'string') return null;
  try {
    const cam: unknown = JSON.parse(detail);
    return isValidCamera(cam) ? cam : null;
  } catch {
    return null;
  }
}
