import { browser, defineBackground } from '#imports';
import type { BackgroundRequest } from '@/lib/messages.ts';
import { normaliseQuery, osmToGeoJSON, type OverpassResponse } from '@/lib/osm.ts';
import { resultsItem, settingsItem, statusItem } from '@/lib/storage.ts';

/** Stay well inside Chrome's 10 MB storage.local quota (no unlimitedStorage). */
const MAX_RESULT_BYTES = 8 * 1024 * 1024;

export default defineBackground(() => {
  let current: AbortController | null = null;

  async function run(query: string) {
    current?.abort();
    const controller = (current = new AbortController());
    await statusItem.setValue({ state: 'running', startedAt: Date.now() });
    try {
      const settings = { ...settingsItem.fallback, ...(await settingsItem.getValue()) };
      if (new URL(settings.endpoint).protocol !== 'https:') throw new Error('The Overpass endpoint must use https://.');
      const res = await fetch(settings.endpoint, {
        credentials: 'omit',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: normaliseQuery(query) }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Overpass returned ${res.status}: ${extractError(await res.text())}`);
      const data = (await res.json()) as OverpassResponse;
      // Overpass reports timeouts and memory limits as a remark on a 200 response.
      if (data.remark && /error/i.test(data.remark)) throw new Error(data.remark.trim());
      const fc = osmToGeoJSON(data);
      if (controller.signal.aborted) return;
      const size = JSON.stringify(fc).length;
      if (size > MAX_RESULT_BYTES) {
        throw new Error(`Too much data (${(size / 1048576).toFixed(1)} MB, ${fc.features.length} features). Zoom in, lower the minimum query area, or narrow the query.`);
      }
      await resultsItem.setValue(fc);
      await statusItem.setValue({ state: 'done', count: fc.features.length, finishedAt: Date.now() });
    } catch (err) {
      if (controller.signal.aborted) return;
      // Without host permissions, responses lacking CORS headers (gateway
      // errors, rate limiting) surface only as an opaque network error.
      const message =
        err instanceof TypeError
          ? "Couldn't reach the Overpass server. It may be busy or down: try again shortly, or pick another endpoint in Settings."
          : err instanceof Error
            ? err.message
            : String(err);
      await statusItem.setValue({ state: 'error', message, finishedAt: Date.now() });
    } finally {
      if (current === controller) current = null;
    }
  }

  browser.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
    // Only our own pages (the popup) drive queries; content scripts report the
    // web page's URL as sender.url, so they're ignored.
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/'))) return;
    if (msg?.type === 'runQuery' && typeof msg.query === 'string') {
      void run(msg.query);
      sendResponse({ ok: true });
    } else if (msg?.type === 'cancelQuery') {
      current?.abort();
      current = null;
      void statusItem.setValue({ state: 'idle' });
      sendResponse({ ok: true });
    }
  });
});

/** Overpass errors come back as an HTML page; pull out the message text. */
function extractError(body: string): string {
  const matches = [...body.matchAll(/<strong[^>]*>\s*Error\s*<\/strong>:?\s*([^<]+)/gi)].map((m) => m[1].trim());
  if (matches.length) return matches.join('; ');
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}
