// Web Mercator helpers. World coordinates are normalised to [0, 1] on both
// axes; at zoom z the world is 256 * 2^z CSS pixels across, matching Google
// Maps' own tiling scheme.

export const TILE_SIZE = 256;
const MAX_LAT = 85.0511287798066;

export interface View {
  /** Map centre in normalised world coordinates. */
  cx: number;
  cy: number;
  zoom: number;
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

export function project(lng: number, lat: number): [number, number] {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const x = (lng + 180) / 360;
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return [x, y];
}

export function unproject(x: number, y: number): [number, number] {
  const lng = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lng, lat];
}

export function toScreen(view: View, x: number, y: number): [number, number] {
  const ws = worldSize(view.zoom);
  return [(x - view.cx) * ws + view.width / 2, (y - view.cy) * ws + view.height / 2];
}

export function fromScreen(view: View, sx: number, sy: number): [number, number] {
  const ws = worldSize(view.zoom);
  return [view.cx + (sx - view.width / 2) / ws, view.cy + (sy - view.height / 2) / ws];
}

export function viewBounds(view: View): Bounds {
  const [west, north] = unproject(...fromScreen(view, 0, 0));
  const [east, south] = unproject(...fromScreen(view, view.width, view.height));
  return { south, west, north, east };
}

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG_EQUATOR = 111.32;

/**
 * Grow `b` about its centre so each side spans at least `minKm` kilometres.
 * Bounds that are already big enough are returned unchanged.
 */
export function expandBounds(b: Bounds, minKm: number): Bounds {
  if (!(minKm > 0)) return b;
  const midLat = (b.south + b.north) / 2;
  const midLng = (b.west + b.east) / 2;
  const minLatSpan = minKm / KM_PER_DEG_LAT;
  const kmPerDegLng = KM_PER_DEG_LNG_EQUATOR * Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
  const minLngSpan = Math.min(360, minKm / kmPerDegLng);
  const latSpan = Math.max(b.north - b.south, minLatSpan);
  const lngSpan = Math.max(b.east - b.west, minLngSpan);
  return {
    south: Math.max(-90, midLat - latSpan / 2),
    north: Math.min(90, midLat + latSpan / 2),
    west: Math.max(-180, midLng - lngSpan / 2),
    east: Math.min(180, midLng + lngSpan / 2),
  };
}

/** Meters per CSS pixel at `lat` for a given zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
