// Parse the camera out of a Google Maps URL, e.g.
//   /maps/@51.5007,-0.1246,15.5z
//   /maps/place/.../@51.5007,-0.1246,1234m/data=...   (satellite, 2D)
//   /maps/@51.5007,-0.1246,500a,35y,90h,45t           (3D globe view)

import { metersPerPixel } from './mercator.ts';

export interface Camera {
  lat: number;
  lng: number;
  /** Equivalent Web Mercator zoom; null if it couldn't be determined. */
  zoom: number | null;
  /** True when the map is rotated or tilted, so a flat overlay can't line up. */
  rotated: boolean;
}

const CAMERA_RE = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),([^/?#]*)/;

export function parseCamera(url: string, viewportHeight: number): Camera | null {
  const m = CAMERA_RE.exec(url);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let zoom: number | null = null;
  let rotated = false;
  for (const part of m[3].split(',')) {
    const pm = /^(-?\d+(?:\.\d+)?)([a-z])$/.exec(part);
    if (!pm) continue;
    const value = Number(pm[1]);
    switch (pm[2]) {
      case 'z':
        zoom = value;
        break;
      case 'm':
        // Satellite view reports the visible map height in metres instead of
        // a zoom level. This is an approximation; see README.
        if (value > 0 && viewportHeight > 0) {
          zoom = Math.log2(metersPerPixel(lat, 0) / (value / viewportHeight));
        }
        break;
      case 'a': // 3D camera altitude
        rotated = true;
        break;
      case 'h':
      case 't':
        if (value !== 0) rotated = true;
        break;
    }
  }
  return { lat, lng, zoom, rotated };
}
