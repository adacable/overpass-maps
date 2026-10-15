import { shadowHost } from './dom.ts';
import type { View } from './mercator.ts';
import { draw, type Prepared } from './render.ts';

/** A canvas drawn over one of Google's maps, hidden from the page in a closed shadow root. */
export class Overlay {
  readonly host: HTMLElement;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  /** What's on the canvas now, so unchanged frames aren't redrawn. */
  private drawnKey = '';
  private drawnFeatures: Prepared[] | null = null;
  private drawnHighlighted: readonly Prepared[] = [];
  private placement = '';

  constructor() {
    const { host, root } = shadowHost('overpass-layer');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, { position: 'absolute', pointerEvents: 'none' });
    Object.assign(this.canvas.style, { display: 'block', width: '100%', height: '100%' });
    root.append(this.canvas);
    this.host = host;
  }

  /** Match position, size and pixel density to `target`. Writes to the DOM only when something changed. */
  fitTo(target: HTMLElement): void {
    const w = target.clientWidth;
    const h = target.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const placement = `${target.offsetLeft},${target.offsetTop},${w},${h},${dpr}`;
    if (placement === this.placement) return;
    this.placement = placement;
    Object.assign(this.host.style, { left: `${target.offsetLeft}px`, top: `${target.offsetTop}px`, width: `${w}px`, height: `${h}px` });
    // Resizing a canvas clears it, so only do it when the size really changed.
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  /** Draw `features` as seen in `view`, or hide if `view` is null. Skips the draw when nothing changed. */
  paint(view: View | null, features: Prepared[], color: string, highlighted: readonly Prepared[] = []): void {
    this.host.style.display = view ? '' : 'none';
    if (!view) return;
    const { width, height } = this.canvas;
    const key = `${view.cx},${view.cy},${view.zoom},${view.width},${view.height},${width},${height},${color}`;
    const sameHighlights = highlighted.length === this.drawnHighlighted.length && highlighted.every((f, i) => f === this.drawnHighlighted[i]);
    if (key === this.drawnKey && features === this.drawnFeatures && sameHighlights) return;
    this.drawnKey = key;
    this.drawnFeatures = features;
    this.drawnHighlighted = highlighted;
    draw(this.ctx, view, features, color, highlighted);
  }

  /** Make the next paint draw even if nothing changed. */
  invalidate(): void {
    this.drawnKey = '';
  }
}
