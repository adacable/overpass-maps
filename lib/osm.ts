// Convert Overpass JSON output to GeoJSON. Handles the common output modes:
// `out geom` (inline geometry), `out body; >; out skel` (ids resolved against
// returned nodes/ways) and `out center` (centre point only).

export type Position = [number, number]; // [lng, lat]

export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

export interface Feature {
  type: 'Feature';
  id: string;
  properties: Record<string, string>;
  geometry: Geometry;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

interface LatLon {
  lat: number;
  lon: number;
}

interface Member {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
  lat?: number;
  lon?: number;
  geometry?: (LatLon | null)[];
}

interface Element {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: LatLon;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: (LatLon | null)[];
  members?: Member[];
}

export interface OverpassResponse {
  elements?: Element[];
  remark?: string;
}

// Tags that don't make an element interesting on their own.
const UNINTERESTING_TAGS = new Set(['source', 'source_ref', 'source:ref', 'history', 'attribution', 'created_by']);

function interesting(tags: Record<string, string> | undefined): boolean {
  return !!tags && Object.keys(tags).some((k) => !UNINTERESTING_TAGS.has(k));
}

const LINEAR_VALUES: Record<string, Set<string> | true> = {
  highway: true,
  barrier: true,
  railway: true,
  route: true,
  waterway: new Set(['river', 'stream', 'canal', 'drain', 'ditch', 'brook', 'tidal_channel']),
  natural: new Set(['coastline', 'cliff', 'ridge', 'arete', 'tree_row', 'earth_bank']),
  power: new Set(['line', 'minor_line', 'cable']),
  man_made: new Set(['embankment', 'dyke', 'breakwater', 'groyne', 'pipeline', 'cutline']),
};

/** Whether a closed way should be drawn as an area rather than a closed line. */
export function closedWayIsArea(tags: Record<string, string> | undefined): boolean {
  if (!tags) return true;
  if (tags.area === 'yes') return true;
  if (tags.area === 'no') return false;
  for (const [key, values] of Object.entries(LINEAR_VALUES)) {
    const v = tags[key];
    if (v === undefined) continue;
    if (values === true || values.has(v)) return false;
  }
  return true;
}

function toPositions(geom: (LatLon | null)[] | undefined): Position[] {
  if (!geom) return [];
  return geom.filter((p): p is LatLon => !!p).map((p) => [p.lon, p.lat]);
}

function samePos(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function isClosed(ring: Position[]): boolean {
  return ring.length >= 4 && samePos(ring[0], ring[ring.length - 1]);
}

/** Join way segments end-to-end into closed rings. */
export function assembleRings(segments: Position[][]): Position[][] {
  const pool = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings: Position[][] = [];
  while (pool.length) {
    let ring = pool.shift()!;
    let joined = true;
    while (!isClosed(ring) && joined) {
      joined = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        const head = ring[0];
        const tail = ring[ring.length - 1];
        if (samePos(tail, s[0])) ring = ring.concat(s.slice(1));
        else if (samePos(tail, s[s.length - 1])) ring = ring.concat(s.slice(0, -1).reverse());
        else if (samePos(head, s[s.length - 1])) ring = s.slice(0, -1).concat(ring);
        else if (samePos(head, s[0])) ring = s.slice(1).reverse().concat(ring);
        else continue;
        pool.splice(i, 1);
        joined = true;
        break;
      }
    }
    // Rings left open (e.g. a relation with missing members) are closed off.
    if (!isClosed(ring) && ring.length >= 3) ring = ring.concat([ring[0]]);
    if (isClosed(ring)) rings.push(ring);
  }
  return rings;
}

export function pointInRing(p: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function buildMultipolygon(outers: Position[][], inners: Position[][]): Geometry | null {
  const outerRings = assembleRings(outers);
  if (!outerRings.length) return null;
  const polygons: Position[][][] = outerRings.map((r) => [r]);
  for (const inner of assembleRings(inners)) {
    const owner = polygons.find((poly) => pointInRing(inner[0], poly[0]));
    if (owner) owner.push(inner);
  }
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

export function osmToGeoJSON(data: OverpassResponse): FeatureCollection {
  const elements = data.elements ?? [];
  const nodes = new Map<number, Position>();
  const ways = new Map<number, Position[]>();
  const nodesInWays = new Set<number>();
  const membersOfRelations = new Set<string>();

  for (const el of elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) nodes.set(el.id, [el.lon, el.lat]);
    if (el.type === 'way') el.nodes?.forEach((id) => nodesInWays.add(id));
    if (el.type === 'relation') el.members?.forEach((m) => membersOfRelations.add(`${m.type}/${m.ref}`));
  }
  for (const el of elements) {
    if (el.type !== 'way') continue;
    const coords = el.geometry
      ? toPositions(el.geometry)
      : (el.nodes ?? []).map((id) => nodes.get(id)).filter((p): p is Position => !!p);
    if (coords.length) ways.set(el.id, coords);
  }

  const features: Feature[] = [];
  const push = (el: Element, geometry: Geometry) =>
    features.push({ type: 'Feature', id: `${el.type}/${el.id}`, properties: el.tags ?? {}, geometry });

  for (const el of elements) {
    const key = `${el.type}/${el.id}`;
    if (el.type === 'node') {
      const pos = nodes.get(el.id);
      if (!pos) continue;
      // Untagged nodes are usually just way vertices from a `>` recursion.
      if (interesting(el.tags) || (!nodesInWays.has(el.id) && !membersOfRelations.has(key))) {
        push(el, { type: 'Point', coordinates: pos });
      }
    } else if (el.type === 'way') {
      const coords = ways.get(el.id);
      if (!coords) {
        if (el.center) push(el, { type: 'Point', coordinates: [el.center.lon, el.center.lat] });
        continue;
      }
      if (!interesting(el.tags) && membersOfRelations.has(key)) continue;
      if (coords.length === 1) push(el, { type: 'Point', coordinates: coords[0] });
      else if (isClosed(coords) && closedWayIsArea(el.tags)) push(el, { type: 'Polygon', coordinates: [coords] });
      else push(el, { type: 'LineString', coordinates: coords });
    } else if (el.type === 'relation') {
      const memberWays = (el.members ?? [])
        .filter((m) => m.type === 'way')
        .map((m) => ({ role: m.role, coords: m.geometry ? toPositions(m.geometry) : ways.get(m.ref) ?? [] }))
        .filter((m) => m.coords.length >= 2);
      const kind = el.tags?.type;
      let geometry: Geometry | null = null;
      if ((kind === 'multipolygon' || kind === 'boundary') && memberWays.length) {
        geometry = buildMultipolygon(
          memberWays.filter((m) => m.role !== 'inner').map((m) => m.coords),
          memberWays.filter((m) => m.role === 'inner').map((m) => m.coords),
        );
      } else if (memberWays.length) {
        geometry = { type: 'MultiLineString', coordinates: memberWays.map((m) => m.coords) };
      }
      if (!geometry && el.center) geometry = { type: 'Point', coordinates: [el.center.lon, el.center.lat] };
      if (geometry) push(el, geometry);
    }
  }
  return { type: 'FeatureCollection', features };
}

const OUT_SETTING = /\[out:\w+[^\]]*\]/;

/**
 * Make sure the query asks for JSON: adds a settings block if the query has no
 * `[out:...]`, and rewrites `[out:xml]`/`[out:csv(...)]` to `[out:json]`.
 */
export function normaliseQuery(query: string): string {
  const q = query.trim();
  if (OUT_SETTING.test(q)) return q.replace(OUT_SETTING, '[out:json]');
  return `[out:json][timeout:60];\n${q}`;
}

/** Fill in `{{bbox}}` and `{{center}}` placeholders, Overpass Turbo style. */
export function fillPlaceholders(
  query: string,
  bbox: { south: number; west: number; north: number; east: number },
  center: { lat: number; lng: number },
): string {
  const f = (n: number) => n.toFixed(6);
  return query
    .replace(/\{\{\s*bbox\s*\}\}/g, `${f(bbox.south)},${f(bbox.west)},${f(bbox.north)},${f(bbox.east)}`)
    .replace(/\{\{\s*center\s*\}\}/g, `${f(center.lat)},${f(center.lng)}`);
}
