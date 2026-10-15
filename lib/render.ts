import { project, worldSize, type View } from './mercator.ts';
import type { FeatureCollection, Position } from './osm.ts';

// Features pre-projected into normalised world coordinates so each frame only
// needs a scale + translate.
export interface Prepared {
  /** OSM id, e.g. "way/123". */
  id: string;
  tags: Record<string, string>;
  kind: 'point' | 'line' | 'polygon';
  /** Flat [x0, y0, x1, y1, ...] arrays: one per ring / line part / point. */
  parts: Float64Array[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function flatten(coords: Position[]): Float64Array {
  const out = new Float64Array(coords.length * 2);
  coords.forEach(([lng, lat], i) => {
    const [x, y] = project(lng, lat);
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  });
  return out;
}

export function prepare(fc: FeatureCollection | null): Prepared[] {
  if (!fc) return [];
  const out: Prepared[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    let kind: Prepared['kind'];
    let parts: Float64Array[];
    switch (g.type) {
      case 'Point':
        kind = 'point';
        parts = [flatten([g.coordinates])];
        break;
      case 'LineString':
        kind = 'line';
        parts = [flatten(g.coordinates)];
        break;
      case 'MultiLineString':
        kind = 'line';
        parts = g.coordinates.map(flatten);
        break;
      case 'Polygon':
        kind = 'polygon';
        parts = g.coordinates.map(flatten);
        break;
      case 'MultiPolygon':
        kind = 'polygon';
        parts = g.coordinates.flat().map(flatten);
        break;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of parts) {
      for (let i = 0; i < p.length; i += 2) {
        if (p[i] < minX) minX = p[i];
        if (p[i] > maxX) maxX = p[i];
        if (p[i + 1] < minY) minY = p[i + 1];
        if (p[i + 1] > maxY) maxY = p[i + 1];
      }
    }
    out.push({ id: f.id, tags: f.properties, kind, parts, minX, minY, maxX, maxY });
  }
  // Draw areas first so lines and points stay on top.
  const order = { polygon: 0, line: 1, point: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

const POINT_RADIUS = 5;
/** Areas/lines smaller than this on screen are drawn as a dot so they stay visible. */
const MIN_SHAPE_PX = 4;

export function draw(ctx: CanvasRenderingContext2D, view: View, features: Prepared[], color: string): void {
  const dpr = ctx.canvas.width / Math.max(1, view.width);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!features.length) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ws = worldSize(view.zoom);
  const ox = view.width / 2 - view.cx * ws;
  const oy = view.height / 2 - view.cy * ws;
  const margin = POINT_RADIUS * 2;
  // Visible world rectangle, padded so strokes and point markers at the edges still draw.
  const vMinX = (-margin - ox) / ws;
  const vMaxX = (view.width + margin - ox) / ws;
  const vMinY = (-margin - oy) / ws;
  const vMaxY = (view.height + margin - oy) / ws;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const dots: [number, number][] = [];

  for (const f of features) {
    if (f.maxX < vMinX || f.minX > vMaxX || f.maxY < vMinY || f.minY > vMaxY) continue;
    if (f.kind !== 'point' && (f.maxX - f.minX) * ws < MIN_SHAPE_PX && (f.maxY - f.minY) * ws < MIN_SHAPE_PX) {
      dots.push([((f.minX + f.maxX) / 2) * ws + ox, ((f.minY + f.maxY) / 2) * ws + oy]);
      continue;
    }
    if (f.kind === 'point') {
      dots.push([f.parts[0][0] * ws + ox, f.parts[0][1] * ws + oy]);
      continue;
    }
    ctx.beginPath();
    for (const p of f.parts) {
      ctx.moveTo(p[0] * ws + ox, p[1] * ws + oy);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * ws + ox, p[i + 1] * ws + oy);
      if (f.kind === 'polygon') ctx.closePath();
    }
    if (f.kind === 'polygon') {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.fill('evenodd');
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
    } else {
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3;
    }
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  for (const [x, y] of dots) {
    ctx.beginPath();
    ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

const HIT_TOLERANCE_PX = 6;

function segmentDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/**
 * Features under screen point (sx, sy), best match first: points, then lines,
 * then areas from smallest to largest (so nested areas stay clickable).
 */
export function hitTest(view: View, features: Prepared[], sx: number, sy: number): Prepared[] {
  const ws = worldSize(view.zoom);
  const ox = view.width / 2 - view.cx * ws;
  const oy = view.height / 2 - view.cy * ws;
  // Work in world units: the click position and tolerances.
  const px = (sx - ox) / ws;
  const py = (sy - oy) / ws;
  const tol = HIT_TOLERANCE_PX / ws;
  const dotR = (POINT_RADIUS + 3) / ws;
  const hits: { f: Prepared; rank: number; size: number }[] = [];

  for (const f of features) {
    const pad = Math.max(tol, dotR);
    if (px < f.minX - pad || px > f.maxX + pad || py < f.minY - pad || py > f.maxY + pad) continue;
    const w = f.maxX - f.minX;
    const h = f.maxY - f.minY;
    const drawnAsDot = f.kind === 'point' || (w * ws < MIN_SHAPE_PX && h * ws < MIN_SHAPE_PX);
    if (drawnAsDot) {
      const cx = f.kind === 'point' ? f.parts[0][0] : (f.minX + f.maxX) / 2;
      const cy = f.kind === 'point' ? f.parts[0][1] : (f.minY + f.maxY) / 2;
      if ((px - cx) ** 2 + (py - cy) ** 2 <= dotR * dotR) hits.push({ f, rank: 0, size: 0 });
      continue;
    }
    let nearEdge = false;
    let inside = false;
    for (const p of f.parts) {
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1];
        if (!nearEdge && segmentDistSq(px, py, ax, ay, bx, by) <= tol * tol) nearEdge = true;
        if (f.kind === 'polygon' && ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
      }
    }
    if (f.kind === 'line' && nearEdge) hits.push({ f, rank: 1, size: 0 });
    else if (f.kind === 'polygon' && (inside || nearEdge)) hits.push({ f, rank: 2, size: w * h });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.size - b.size).map((h) => h.f);
}
