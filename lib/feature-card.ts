import { shadowHost } from './dom.ts';
import type { Prepared } from './render.ts';

// A small card showing a feature's OSM tags, shown where the user clicked.
// Tag values come from OSM and are untrusted: only ever inserted as text, never as HTML.

// Same indigo-on-slate palette as the popup; the accent is the overlay colour.
const STYLE = `
  :host { all: initial; }
  .card {
    --paper: #f2f4f7; --ink: #1c2230; --muted: #646b7a; --rule: #d9dde5; --link: #3f3d96; --hover: #e4e8ef;
    --tint: color-mix(in srgb, var(--accent) 18%, transparent);
    position: fixed; z-index: 2147483647; width: 300px; max-height: 380px;
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--paper); color: var(--ink); border-radius: 10px;
    box-shadow: 0 0 0 1px rgb(26 41 46 / .08), 0 6px 20px rgb(26 41 46 / .22);
    font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  header { display: flex; align-items: flex-start; gap: 10px; padding: 12px 10px 10px 14px; }
  .key { flex: none; width: 14px; height: 14px; margin-top: 3px; border-radius: 4px; background: var(--tint); box-shadow: inset 0 0 0 2px var(--accent); }
  .titles { flex: 1; min-width: 0; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
  .sub { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  button { all: unset; cursor: pointer; border-radius: 6px; width: 24px; height: 24px; display: grid; place-items: center; color: var(--muted); font-size: 15px; }
  button:hover { background: var(--hover); color: var(--ink); }
  button:focus-visible { outline: 2px solid var(--link); outline-offset: 1px; }
  button:disabled { opacity: .35; cursor: default; background: none; }
  .tags { overflow: auto; padding: 0 14px 6px; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 4px 0; vertical-align: top; border-top: 1px solid var(--rule); overflow-wrap: anywhere; }
  td.k { color: var(--muted); padding-right: 12px; width: 40%; font: 12px/1.45 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }
  .empty { color: var(--muted); padding: 4px 0 8px; }
  footer { display: flex; align-items: center; gap: 4px; padding: 8px 10px 10px 14px; border-top: 1px solid var(--rule); }
  footer a { flex: 1; }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  a:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; border-radius: 2px; }
  .pager { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  @media (prefers-color-scheme: dark) {
    .card { --paper: #171a22; --ink: #e4e7ee; --muted: #9aa1af; --rule: #2c313c; --link: #a9abf2; --hover: #232836;
      --tint: color-mix(in srgb, var(--accent) 45%, #8a8fa0 25%);
      box-shadow: 0 0 0 1px rgb(255 255 255 / .06), 0 6px 20px rgb(0 0 0 / .5); }
  }
`;

const URL_KEYS = new Set(['website', 'url', 'contact:website', 'image']);
const PRIMARY_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'building', 'highway', 'railway', 'landuse', 'natural', 'historic', 'man_made', 'office', 'craft', 'boundary', 'place'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function link(href: string, text: string) {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: text });
}

function button(text: string, label: string, onclick: () => void, disabled = false) {
  return el('button', { textContent: text, title: label, ariaLabel: label, onclick, disabled });
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
  private readonly host: HTMLElement;
  private card = el('div', { className: 'card' });
  private features: Prepared[] = [];
  private index = 0;

  /** `onChange` runs whenever the feature shown changes, or the card closes. */
  constructor(private onChange: () => void = () => {}) {
    const { host, root } = shadowHost('overpass-card');
    this.host = host;
    this.card.setAttribute('role', 'dialog');
    root.append(el('style', { textContent: STYLE }), this.card);
    // Keep interactions with the card from bubbling up to Google's handlers.
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'contextmenu']) {
      this.card.addEventListener(t, (e) => e.stopPropagation());
    }
  }

  get isOpen(): boolean {
    return this.host.isConnected;
  }

  /** The feature on show, if the card is open. */
  get selected(): Prepared | null {
    return this.isOpen ? this.features[this.index] : null;
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
    if (!this.isOpen) return;
    this.host.remove();
    this.onChange();
  }

  private render(): void {
    const f = this.features[this.index];
    const rows = Object.entries(f.tags).map(([k, v]) => {
      const value = URL_KEYS.has(k) && /^https?:\/\//i.test(v) ? link(v, v) : v;
      return el('tr', {}, el('td', { className: 'k', textContent: k }), el('td', {}, value));
    });
    const tags = el('div', { className: 'tags' }, rows.length ? el('table', {}, ...rows) : el('div', { className: 'empty', textContent: 'No tags' }));

    const [type, id] = f.id.split('/');
    const footer = el('footer', {}, link(`https://www.openstreetmap.org/${type}/${id}`, 'View on OpenStreetMap'));
    const n = this.features.length;
    if (n > 1) {
      footer.append(
        button('‹', 'Previous feature', () => this.step(-1), this.index === 0),
        el('span', { className: 'pager', textContent: `${this.index + 1} of ${n}` }),
        button('›', 'Next feature', () => this.step(1), this.index === n - 1),
      );
    }

    this.card.replaceChildren(
      el('header', {}, el('span', { className: 'key' }), el('div', { className: 'titles' }, el('h1', { textContent: title(f) }), el('div', { className: 'sub', textContent: subtitle(f) })), button('✕', 'Close', () => this.close())),
      tags,
      footer,
    );
    this.onChange();
  }

  private step(d: number): void {
    this.index = Math.max(0, Math.min(this.features.length - 1, this.index + d));
    this.render();
  }
}
