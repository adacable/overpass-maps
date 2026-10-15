import { browser, defineBackground } from '#imports';
import { inkOn } from '@/lib/color.ts';
import { isHttpsUrl } from '@/lib/matches.ts';
import { normaliseQuery, osmToGeoJSON, overpassErrorText, type OverpassResponse } from '@/lib/osm.ts';
import { getSettings, resultsItem, statusItem, watchSettings, type RunStatus } from '@/lib/storage.ts';

/** Stay well inside Chrome's 10 MB storage.local quota (no unlimitedStorage). */
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
/**
 * Chrome stops an idle service worker after 30s, even mid-fetch, and Overpass
 * sends nothing until the query finishes. Any extension API call resets that
 * timer, so make one regularly while a query runs.
 */
const KEEP_ALIVE_MS = 20_000;

/**
 * Waits before each retry when a server is busy or unreachable. Overpass's own
 * busy reply asks clients to back off exponentially. About a minute in all.
 */
const RETRY_DELAYS_MS = [4_000, 8_000, 16_000, 32_000];
/** Upper bound on a server's own Retry-After. */
const MAX_RETRY_AFTER_MS = 60_000;

/** The server never gave a usable response (down, overloaded, rate limiting). */
class UnreachableError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

const hostOf = (url: string) => new URL(url).host;

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
}

/** One request to Overpass. Busy and failing servers throw UnreachableError. */
async function request(endpoint: string, query: string, signal: AbortSignal): Promise<OverpassResponse> {
  const res = await fetch(endpoint, {
    credentials: 'omit',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: normaliseQuery(query) }),
    signal,
  }).catch((err) => {
    if (signal.aborted) throw err;
    // The built-in servers' replies are always readable (host permissions), so
    // this is a real network failure there. A custom server's error replies
    // without CORS headers also end up here.
    throw new UnreachableError(`Couldn't reach ${hostOf(endpoint)}. It may be busy or down.`);
  });
  if (!res.ok) {
    const message = `${hostOf(endpoint)} returned ${res.status}: ${overpassErrorText(await res.text())}`;
    const retryAfter = Number(res.headers.get('Retry-After'));
    // Busy or failing servers; a 400 is a problem with the query itself.
    if (res.status === 429 || res.status >= 500) throw new UnreachableError(message, retryAfter > 0 ? retryAfter * 1000 : undefined);
    throw new Error(message);
  }
  const data = (await res.json()) as OverpassResponse;
  // Overpass reports timeouts and memory limits as a remark on a 200 response.
  if (data.remark && /error/i.test(data.remark)) throw new Error(data.remark.trim());
  return data;
}

const tooMuchData = (detail: string) => `Too much data (${detail}). Zoom in, lower the minimum query area, or narrow the query.`;

// MV3 calls the toolbar button `action`, MV2 `browserAction`.
const toolbar = browser.action ?? browser.browserAction;

/** Toolbar badge: … while running, the feature count when done, ! on error. */
async function showBadge() {
  const [status, { color }] = await Promise.all([statusItem.getValue(), getSettings()]);
  const text = { idle: '', running: '…', done: status.state === 'done' ? compactCount(status.count) : '', error: '!' }[status.state];
  const background = status.state === 'error' ? '#b3261e' : status.state === 'running' ? '#646b7a' : color;
  await toolbar.setBadgeText({ text });
  await toolbar.setBadgeBackgroundColor({ color: background });
  await toolbar.setBadgeTextColor?.({ color: status.state === 'done' ? inkOn(color) : '#fff' });
}

function compactCount(n: number): string {
  return n < 1000 ? String(n) : n < 100_000 ? `${Math.floor(n / 1000)}k` : '99k+';
}

export default defineBackground(() => {
  let current: AbortController | null = null;

  void showBadge();
  statusItem.watch(() => void showBadge());
  watchSettings(() => void showBadge());

  // A status still "running" at startup belongs to a query that died with the
  // previous background instance (e.g. the browser was closed mid-query).
  void statusItem.getValue().then((s) => {
    if (s.state === 'running' && !current) {
      void statusItem.setValue({ state: 'error', message: 'The query was interrupted. Run it again.', finishedAt: Date.now() });
    }
  });

  async function run(query: string) {
    current?.abort();
    const controller = (current = new AbortController());
    // Cancel / Clear / a newer query may arrive during any await below.
    const superseded = () => current !== controller;
    const keepAlive = setInterval(() => void browser.runtime.getPlatformInfo(), KEEP_ALIVE_MS);
    const { endpoint } = await getSettings();
    const startedAt = Date.now();
    await statusItem.setValue({ state: 'running', startedAt, endpoint });
    try {
      if (!isHttpsUrl(endpoint)) throw new Error('The Overpass endpoint must be an https:// URL.');
      const attempts = RETRY_DELAYS_MS.length + 1;
      let data: OverpassResponse;
      for (let attempt = 1; ; attempt++) {
        try {
          data = await request(endpoint, query, controller.signal);
          break;
        } catch (err) {
          if (superseded()) return;
          if (!(err instanceof UnreachableError)) throw err;
          console.warn(`Overpass Maps: try ${attempt} of ${attempts} failed:`, err.message);
          if (attempt === attempts) throw new UnreachableError(`${err.message.replace(/\.?$/, '.')} Gave up after ${attempts} tries.`);
          const wait = Math.min(err.retryAfterMs ?? RETRY_DELAYS_MS[attempt - 1], MAX_RETRY_AFTER_MS);
          await statusItem.setValue({ state: 'running', startedAt, endpoint, attempt: attempt + 1, attempts, retryAt: Date.now() + wait, problem: err.message });
          await sleep(wait, controller.signal);
        }
      }
      const fc = osmToGeoJSON(data);
      const bytes = new TextEncoder().encode(JSON.stringify(fc)).length;
      if (bytes > MAX_RESULT_BYTES) throw new Error(tooMuchData(`${(bytes / 1048576).toFixed(1)} MB, ${fc.features.length} features`));
      if (superseded()) return;
      await resultsItem.setValue(fc).catch(() => {
        throw new Error(tooMuchData('over the storage limit'));
      });
      if (superseded()) return;
      await statusItem.setValue({ state: 'done', count: fc.features.length, finishedAt: Date.now() });
    } catch (err) {
      if (superseded()) return;
      const message = err instanceof Error ? err.message : String(err);
      await statusItem.setValue({ state: 'error', message, finishedAt: Date.now(), unreachable: err instanceof UnreachableError });
    } finally {
      clearInterval(keepAlive);
      if (current === controller) current = null;
    }
  }

  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    // Only our own pages (the popup) drive queries; content scripts report the
    // web page's URL as sender.url, so they're ignored.
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/'))) return;
    const req = msg as { type?: unknown; query?: unknown } | null;
    if (req?.type === 'runQuery' && typeof req.query === 'string') {
      void run(req.query);
      sendResponse({ ok: true });
    } else if (req?.type === 'cancelQuery') {
      current?.abort();
      current = null;
      void statusItem.setValue({ state: 'idle' });
      sendResponse({ ok: true });
    }
  });
});
