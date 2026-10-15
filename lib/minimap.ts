// The Street View mini-map (bottom-left, or half-screen when expanded) isn't
// the WebGL map: it's a grid of <img> tiles positioned with CSS transforms.
// Each tile URL encodes its tile coordinates, e.g.
//   /maps/vt/pb=!1m5!1m4!1i15!2i32743!3i21794!4i128...
// = zoom 15, x 32743, y 21794, 128px tiles. One tile's on-screen rectangle is
// enough to place the whole map exactly.

import { largest } from './dom.ts';
import { TILE_SIZE, type View } from './mercator.ts';

export interface Tile {
  zoom: number;
  x: number;
  y: number;
  size: number;
}

const TILE_RE = /!1i(\d+)!2i(\d+)!3i(\d+)!4i(\d+)/;

export function parseTileUrl(src: string): Tile | null {
  if (!src.includes('/maps/vt')) return null;
  const m = TILE_RE.exec(src);
  if (!m) return null;
  const [zoom, x, y, size] = m.slice(1).map(Number);
  return size > 0 ? { zoom, x, y, size } : null;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The view of a viewport rectangle, given a tile and where it's drawn on screen. */
export function viewFromTile(tile: Tile, tileRect: Rect, viewport: Rect): View {
  // Tiles smaller than 256px are indexed on a finer grid: 2^zoom * 256 / size per side.
  const tilesPerSide = (2 ** tile.zoom * TILE_SIZE) / tile.size;
  const worldPx = tileRect.width * tilesPerSide;
  const tileX = tile.x / tilesPerSide;
  const tileY = tile.y / tilesPerSide;
  return {
    cx: tileX + (viewport.left + viewport.width / 2 - tileRect.left) / worldPx,
    cy: tileY + (viewport.top + viewport.height / 2 - tileRect.top) / worldPx,
    zoom: Math.log2(worldPx / TILE_SIZE),
    width: viewport.width,
    height: viewport.height,
  };
}

/** Find the mini-map's input layer: the visible area the overlay should cover. */
export function findMinimapViewport(): HTMLElement | null {
  // Several elements carry minimap actions (e.g. a zero-size accessibility
  // button); the input layer is the visible one handling mouse presses.
  return largest(document.querySelectorAll<HTMLElement>('[jsaction*="mousedown:minimap.main"]'));
}

/** Read the mini-map's current view from any visible tile near the viewport. */
export function readMinimapView(viewport: HTMLElement): View | null {
  const vr = viewport.getBoundingClientRect();
  // Tiles live in a sibling branch; walk up until we find them.
  let scope: HTMLElement | null = viewport.parentElement;
  for (let i = 0; scope && i < 4; i++, scope = scope.parentElement) {
    let best: { tile: Tile; rect: DOMRect } | null = null;
    for (const img of scope.querySelectorAll<HTMLImageElement>('img[src*="/maps/vt"]')) {
      const tile = parseTileUrl(img.src);
      if (!tile) continue;
      const rect = img.getBoundingClientRect();
      if (!rect.width) continue;
      // During a zoom animation tiles of two zoom levels overlap, all placed
      // consistently; the highest zoom gives the most precise position.
      if (!best || tile.zoom > best.tile.zoom) best = { tile, rect };
    }
    if (best) return viewFromTile(best.tile, best.rect, vr);
  }
  return null;
}
