import type { Prepared } from './render.ts';

// A small card showing a feature's OSM tags, shown where the user clicked.
// Lives in a shadow root so Google's styles can't touch it (and vice versa).
// Tag values come from OSM and are untrusted: only ever set via textContent.

const STYLE = `
  :host { all: initial; }
  .card {
    position: fixed; z-index: 2147483647; width: 300px; max-height: 380px;
    display: flex; flex-direction: column; overflow: hidden;
    background: #fff; color: #1f1f1f; border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,.25);
    font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  header { display: flex; align-items: flex-start; gap: 8px; padding: 12px 12px 8px 14px; border-top: 4px solid var(--accent); }
  .titles { flex: 1; min-width: 0; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
  .sub { color: #5f6368; font-size: 12px; overflow-wrap: anywhere; }
  button { all: unset; cursor: pointer; border-radius: 50%; width: 24px; height: 24px; display: grid; place-items: center; color: #5f6368; font-size: 16px; }
  button:hover { background: #f1f3f4; }
  button:focus-visible { outline: 2px solid var(--accent); }
  button:disabled { opacity: .35; cursor: default; background: none; }
  .tags { overflow: auto; padding: 0 14px 4px; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 3px 0; vertical-align: top; border-top: 1px solid #eee; overflow-wrap: anywhere; }
  td.k { color: #5f6368; padding-right: 10px; width: 40%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .empty { color: #5f6368; padding: 4px 0 8px; }
  footer { display: flex; align-items: center; gap: 6px; padding: 8px 10px 10px 14px; border-top: 1px solid #eee; }
  footer a { color: #1a73e8; text-decoration: none; flex: 1; }
  footer a:hover { text-decoration: underline; }
  .pager { color: #5f6368; font-size: 12px; }
  a { color: #1a73e8; }
  @media (prefers-color-scheme: dark) {
    .card { background: #202124; color: #e8eaed; }
    .sub, td.k, .pager, .empty, button { color: #9aa0a6; }
    button:hover { background: #3c4043; }
    td, footer { border-color: #3c4043; }
    footer a, a { color: #8ab4f8; }
  }
`;

const URL_KEYS = new Set(['website', 'url', 'contact:website', 'image']);
const PRIMARY_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'building', 'highway', 'railway', 'landuse', 'natural', 'historic', 'man_made', 'office', 'craft', 'boundary', 'place'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function title(f: Prepared): string {
  return f.tags.name ?? f.tags['name:en'] ?? f.tags.ref ?? f.id;
}

function subtitle(f: Prepared): string {
  const key = PRIMARY_KEYS.find((k) => f.tags[k]);
  const kind = f.id.split('/')[0];
  return key ? `${key}=${f.tags[key]} · ${kind}` : kind;
}

export class FeatureCard {
  private host = document.createElement('overpass-card'); // not a div: Google re-lays-out stray divs
  private root = this.host.attachShadow({ mode: 'closed' });
  private card = el('div', { className: 'card' });
  private features: Prepared[] = [];
  private index = 0;

  constructor() {
    this.card.setAttribute('role', 'dialog');
    this.root.append(el('style', { textContent: STYLE }), this.card);
    // Keep interactions with the card from bubbling up to Google's handlers.
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'contextmenu']) {
      this.card.addEventListener(t, (e) => e.stopPropagation());
    }
  }

  get isOpen(): boolean {
    return this.host.isConnected;
  }

  /** Whether an event happened inside the card. */
  contains(e: Event): boolean {
    return e.composedPath().includes(this.host);
  }

  show(features: Prepared[], clientX: number, clientY: number, color: string): void {
    this.features = features;
    this.index = 0;
    this.card.style.setProperty('--accent', color);
    if (!this.host.isConnected) document.documentElement.append(this.host);
    this.render();
    // Place beside the click, kept inside the window.
    const r = this.card.getBoundingClientRect();
    const gap = 12;
    let left = clientX + gap;
    let top = clientY + gap;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, clientX - gap - r.width);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - r.height);
    Object.assign(this.card.style, { left: `${left}px`, top: `${top}px` });
  }

  close(): void {
    this.host.remove();
  }

  private render(): void {
    const f = this.features[this.index];
    const close = el('button', { title: 'Close', ariaLabel: 'Close', textContent: '✕' });
    close.addEventListener('click', () => this.close());

    const rows = Object.entries(f.tags).map(([k, v]) => {
      const value: Node = URL_KEYS.has(k) && /^https?:\/\//i.test(v) ? el('a', { href: v, target: '_blank', rel: 'noopener noreferrer', textContent: v }) : document.createTextNode(v);
      return el('tr', {}, el('td', { className: 'k', textContent: k }), el('td', {}, value));
    });
    const tags = el('div', { className: 'tags' }, rows.length ? el('table', {}, ...rows) : el('div', { className: 'empty', textContent: 'No tags' }));

    const [type, id] = f.id.split('/');
    const footer = el('footer', {}, el('a', { href: `https://www.openstreetmap.org/${type}/${id}`, target: '_blank', rel: 'noopener noreferrer', textContent: 'View on OpenStreetMap' }));
    if (this.features.length > 1) {
      const prev = el('button', { title: 'Previous', ariaLabel: 'Previous feature', textContent: '‹', disabled: this.index === 0 });
      const next = el('button', { title: 'Next', ariaLabel: 'Next feature', textContent: '›', disabled: this.index === this.features.length - 1 });
      prev.addEventListener('click', () => this.step(-1));
      next.addEventListener('click', () => this.step(1));
      footer.append(prev, el('span', { className: 'pager', textContent: `${this.index + 1} of ${this.features.length}` }), next);
    }

    this.card.replaceChildren(
      el('header', {}, el('div', { className: 'titles' }, el('h1', { textContent: title(f) }), el('div', { className: 'sub', textContent: subtitle(f) })), close),
      tags,
      footer,
    );
  }

  private step(d: number): void {
    this.index = Math.max(0, Math.min(this.features.length - 1, this.index + d));
    this.render();
  }
}
