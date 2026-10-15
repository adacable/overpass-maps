import type { Bounds } from './mercator.ts';

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

/**
 * Inline geometry as runs of consecutive positions. Geometry cropped with
 * `out geom(bbox)` has null for each vertex outside the box; joining across
 * those gaps would draw edges that aren't there, so each gap starts a new run.
 */
function toRuns(geom: (LatLon | null)[]): Position[][] {
  const runs: Position[][] = [[]];
  for (const p of geom) {
    if (p) runs[runs.length - 1].push([p.lon, p.lat]);
    else if (runs[runs.length - 1].length) runs.push([]);
  }
  return runs.filter((r) => r.length);
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

function pointInRing(p: Position, ring: Position[]): boolean {
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

function centerPoint(el: Element): Geometry | null {
  return el.center ? { type: 'Point', coordinates: [el.center.lon, el.center.lat] } : null;
}

export function osmToGeoJSON(data: OverpassResponse): FeatureCollection {
  const elements = data.elements ?? [];
  const nodes = new Map<number, Position>();
  /** Each way's geometry, as runs (more than one if it was cropped). */
  const ways = new Map<number, Position[][]>();
  /** Ways whose geometry was cropped by `out geom(bbox)`. */
  const cropped = new Set<number>();
  const nodesInWays = new Set<number>();
  const membersOfRelations = new Set<string>();

  for (const el of elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) nodes.set(el.id, [el.lon, el.lat]);
    if (el.type === 'way') el.nodes?.forEach((id) => nodesInWays.add(id));
    if (el.type === 'relation') el.members?.forEach((m) => membersOfRelations.add(`${m.type}/${m.ref}`));
  }
  for (const el of elements) {
    if (el.type !== 'way') continue;
    if (el.geometry?.includes(null)) cropped.add(el.id);
    const runs = el.geometry
      ? toRuns(el.geometry)
      : [(el.nodes ?? []).map((id) => nodes.get(id)).filter((p): p is Position => !!p)].filter((r) => r.length);
    if (runs.length) ways.set(el.id, runs);
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
      const runs = ways.get(el.id);
      if (!runs) {
        const center = centerPoint(el);
        if (center) push(el, center);
        continue;
      }
      if (!interesting(el.tags) && membersOfRelations.has(key)) continue;
      const [coords] = runs;
      if (runs.length > 1) push(el, { type: 'MultiLineString', coordinates: runs });
      else if (coords.length === 1) push(el, { type: 'Point', coordinates: coords[0] });
      // A cropped outline can't be filled correctly, so it's drawn as a line.
      else if (isClosed(coords) && closedWayIsArea(el.tags) && !cropped.has(el.id)) push(el, { type: 'Polygon', coordinates: [coords] });
      else push(el, { type: 'LineString', coordinates: coords });
    } else if (el.type === 'relation') {
      const wayMembers = (el.members ?? []).filter((m) => m.type === 'way');
      const memberWays = wayMembers
        .flatMap((m) => (m.geometry ? toRuns(m.geometry) : ways.get(m.ref) ?? []).map((coords) => ({ role: m.role, coords })))
        .filter((m) => m.coords.length >= 2);
      // As for ways, a cropped area is drawn as its outline.
      const isCropped = wayMembers.some((m) => m.geometry?.includes(null) || cropped.has(m.ref));
      const isArea = (el.tags?.type === 'multipolygon' || el.tags?.type === 'boundary') && !isCropped;
      let geometry: Geometry | null = null;
      if (memberWays.length) {
        geometry = isArea
          ? buildMultipolygon(
              memberWays.filter((m) => m.role !== 'inner').map((m) => m.coords),
              memberWays.filter((m) => m.role === 'inner').map((m) => m.coords),
            )
          : { type: 'MultiLineString', coordinates: memberWays.map((m) => m.coords) };
      }
      geometry ??= centerPoint(el);
      if (geometry) push(el, geometry);
    }
  }
  return { type: 'FeatureCollection', features };
}

const OUT_SETTING = /\[out:\w+[^\]]*\]/;
/** Leading whitespace and comments, before the first statement. */
const PREAMBLE = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/;

/**
 * Make sure the query asks for JSON: rewrites `[out:xml]`/`[out:csv(...)]` to
 * `[out:json]`, adds `[out:json]` to a settings statement that lacks it, or
 * adds a settings statement if there's none (a query can only have one).
 */
export function normaliseQuery(query: string): string {
  const q = query.trim();
  if (OUT_SETTING.test(q)) return q.replace(OUT_SETTING, '[out:json]');
  const start = PREAMBLE.exec(q)![0].length;
  if (q[start] === '[') return `${q.slice(0, start)}[out:json]${q.slice(start)}`;
  return `[out:json][timeout:60];\n${q}`;
}

/**
 * Overpass errors come back as an HTML page; pull out the message text. Its
 * proxy's busy replies are Markdown-style plain text: keep the first paragraph
 * that isn't a heading.
 */
export function overpassErrorText(body: string): string {
  const matches = [...body.matchAll(/<strong[^>]*>\s*Error\s*<\/strong>:?\s*([^<]+)/gi)].map((m) => m[1].trim());
  if (matches.length) return matches.join('; ');
  if (!body.includes('<')) {
    const para = body.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith('#'));
    if (para) body = para;
  }
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Fill in `{{bbox}}` and `{{center}}` placeholders, Overpass Turbo style. */
export function fillPlaceholders(query: string, bbox: Bounds, center: { lat: number; lng: number }): string {
  const f = (n: number) => n.toFixed(6);
  return query
    .replace(/\{\{\s*bbox\s*\}\}/g, `${f(bbox.south)},${f(bbox.west)},${f(bbox.north)},${f(bbox.east)}`)
    .replace(/\{\{\s*center\s*\}\}/g, `${f(center.lat)},${f(center.lng)}`);
}
