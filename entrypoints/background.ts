import { browser, defineBackground } from '#imports';
import type { BackgroundRequest } from '@/lib/messages.ts';
import { normaliseQuery, osmToGeoJSON, type OverpassResponse } from '@/lib/osm.ts';
import { resultsItem, settingsItem, statusItem } from '@/lib/storage.ts';

export default defineBackground(() => {
  let current: AbortController | null = null;

  async function run(query: string) {
    current?.abort();
    const controller = (current = new AbortController());
    await statusItem.setValue({ state: 'running', startedAt: Date.now() });
    try {
      const settings = { ...settingsItem.fallback, ...(await settingsItem.getValue()) };
      const res = await fetch(settings.endpoint, {
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
      await resultsItem.setValue(fc);
      await statusItem.setValue({ state: 'done', count: fc.features.length, finishedAt: Date.now() });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      await statusItem.setValue({ state: 'error', message, finishedAt: Date.now() });
    } finally {
      if (current === controller) current = null;
    }
  }

  browser.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
    if (msg?.type === 'runQuery') {
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
