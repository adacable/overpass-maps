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

/**
 * A lat/lng box with longitudes in [-180, 180]. `west > east` means it
 * crosses the antimeridian, which is also how Overpass reads such a bbox.
 */
export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Screen position = world position * scale + offset, for `view`. */
export function screenTransform(view: View): { scale: number; ox: number; oy: number } {
  const scale = TILE_SIZE * 2 ** view.zoom;
  return { scale, ox: view.width / 2 - view.cx * scale, oy: view.height / 2 - view.cy * scale };
}

export function project(lng: number, lat: number): [number, number] {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const x = (lng + 180) / 360;
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return [x, y];
}

/** Inverse of project. `x` may be outside [0, 1] (a neighbouring copy of the world); the longitude is wrapped into [-180, 180). */
export function unproject(x: number, y: number): [number, number] {
  const lng = (x - Math.floor(x)) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lng, lat];
}

export function toScreen(view: View, x: number, y: number): [number, number] {
  const { scale, ox, oy } = screenTransform(view);
  return [x * scale + ox, y * scale + oy];
}

export function fromScreen(view: View, sx: number, sy: number): [number, number] {
  const { scale, ox, oy } = screenTransform(view);
  return [(sx - ox) / scale, (sy - oy) / scale];
}

/**
 * Bounds starting at `west` and spanning `lngSpan` degrees eastward, with the
 * longitudes wrapped into range: the view may be panned past ±180 or show
 * several copies of the world.
 */
function wrapBounds(south: number, north: number, west: number, lngSpan: number): Bounds {
  if (lngSpan >= 360) return { south, west: -180, north, east: 180 };
  const east = west + lngSpan;
  return {
    south,
    west: west - 360 * Math.floor((west + 180) / 360), // into [-180, 180)
    north,
    east: east - 360 * Math.ceil((east - 180) / 360), // into (-180, 180]
  };
}

export function viewBounds(view: View): Bounds {
  const [x0, y0] = fromScreen(view, 0, 0);
  const [x1, y1] = fromScreen(view, view.width, view.height);
  const [west, north] = unproject(x0, y0);
  const [, south] = unproject(x1, y1);
  return wrapBounds(south, north, west, (x1 - x0) * 360);
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
  const minLatSpan = minKm / KM_PER_DEG_LAT;
  const kmPerDegLng = KM_PER_DEG_LNG_EQUATOR * Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
  const latSpan = Math.max(b.north - b.south, minLatSpan);
  const oldLngSpan = b.west > b.east ? b.east + 360 - b.west : b.east - b.west;
  const lngSpan = Math.max(oldLngSpan, minKm / kmPerDegLng);
  return wrapBounds(
    Math.max(-90, midLat - latSpan / 2),
    Math.min(90, midLat + latSpan / 2),
    b.west + oldLngSpan / 2 - lngSpan / 2,
    lngSpan,
  );
}

/** Meters per CSS pixel at `lat` for a given zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
