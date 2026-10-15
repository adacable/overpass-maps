// Turns OSM tag values into links for the feature card.
// Values are untrusted: every href is built from a validated value, never passed through as is.

export interface TagLink {
  href: string;
  text: string;
}

const WEB_KEYS = new Set(['website', 'url', 'contact:website', 'image']);
const PHONE_KEYS = new Set(['phone', 'contact:phone', 'mobile', 'contact:mobile', 'fax', 'contact:fax']);
const EMAIL_KEYS = new Set(['email', 'contact:email']);

// MediaWiki titles use underscores for spaces; keep '/' and ':' readable.
function wikiPath(title: string): string {
  return encodeURIComponent(title.trim().replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':');
}

function web(v: string): TagLink | null {
  return /^https?:\/\/\S+$/i.test(v) ? { href: v, text: v } : null;
}

// wikipedia=en:Title, or wikipedia:de=Title.
function wikipedia(k: string, v: string): TagLink | null {
  const lang = k === 'wikipedia' ? /^([a-z][a-z-]{1,11}):(.+)$/.exec(v)?.[1] : k.slice('wikipedia:'.length);
  const title = k === 'wikipedia' ? v.slice((lang?.length ?? 0) + 1) : v;
  if (!lang || !/^[a-z][a-z-]{1,11}$/.test(lang) || !title.trim()) return null;
  return { href: `https://${lang}.wikipedia.org/wiki/${wikiPath(title)}`, text: v };
}

function wikidata(v: string): TagLink | null {
  return /^Q[1-9]\d*$/.test(v) ? { href: `https://www.wikidata.org/wiki/${v}`, text: v } : null;
}

function commons(v: string): TagLink | null {
  return /^(File|Category):\S/.test(v) ? { href: `https://commons.wikimedia.org/wiki/${wikiPath(v)}`, text: v } : null;
}

function phone(v: string): TagLink | null {
  const number = v.replace(/[^\d+]/g, '');
  return /^\+?\d{3,}$/.test(number) ? { href: `tel:${number}`, text: v } : null;
}

function email(v: string): TagLink | null {
  return /^[^\s@?&#/:]+@[^\s@?&#/:]+\.[^\s@?&#/:]+$/.test(v) ? { href: `mailto:${v}`, text: v } : null;
}

function one(k: string, v: string): TagLink | null {
  if (WEB_KEYS.has(k)) return web(v);
  if (PHONE_KEYS.has(k)) return phone(v);
  if (EMAIL_KEYS.has(k)) return email(v);
  if (k === 'wikipedia' || k.startsWith('wikipedia:')) return wikipedia(k, v);
  if (k === 'wikidata' || k.endsWith(':wikidata')) return wikidata(v);
  if (k === 'wikimedia_commons') return commons(v);
  return null;
}

/**
 * Links for a tag's value, one per ';'-separated part (or one for the whole value,
 * e.g. a URL containing ';'), or null if it doesn't parse: the card then shows plain text.
 */
export function tagLinks(k: string, v: string): TagLink[] | null {
  const parts = v.split(';').map((part) => one(k, part.trim()));
  if (parts.every((l) => l)) return parts as TagLink[];
  const whole = one(k, v.trim());
  return whole ? [whole] : null;
}
