import { browser } from '#imports';
import { inkOn } from '@/lib/color.ts';
import { isHttpsUrl, OVERPASS_ENDPOINTS } from '@/lib/matches.ts';
import { boundsSizeKm, expandBounds } from '@/lib/mercator.ts';
import { requestView, sendToBackground, zoomToResults, type GetViewResponse } from '@/lib/messages.ts';
import { fillPlaceholders } from '@/lib/osm.ts';
import { getSettings, queryItem, resultsItem, settingsItem, statusItem, type RunStatus, type Settings } from '@/lib/storage.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const queryEl = $<HTMLTextAreaElement>('query');
const highlightsEl = $('highlights');
const tokensEl = $('tokens');
const runBtn = $<HTMLButtonElement>('run');
const activityEl = $('activity');
const colorEl = $<HTMLInputElement>('color');
const resultsEl = $('results');
const zoomBtn = $<HTMLButtonElement>('zoom');
const toggleBtn = $<HTMLButtonElement>('toggle');
const clearBtn = $<HTMLButtonElement>('clear');
const settingsEl = $<HTMLDetailsElement>('settings');
const minBboxEl = $<HTMLInputElement>('minBboxKm');
const serverEl = $<HTMLSelectElement>('server');
const customRow = $('custom-row');
const endpointEl = $<HTMLInputElement>('endpoint');

const CUSTOM = 'custom';
const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : url);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) =>
  Object.assign(document.createElement(tag), props);

$('shortcut').textContent = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘↵' : 'Ctrl+↵';

// ===== Settings =====

let settings = await getSettings();

async function saveSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  await settingsItem.setValue(settings);
}

for (const url of OVERPASS_ENDPOINTS) serverEl.append(el('option', { value: url, textContent: hostOf(url) }));
serverEl.append(el('option', { value: CUSTOM, textContent: 'Custom…' }));

function showSettings() {
  minBboxEl.value = String(settings.minBboxKm);
  colorEl.value = settings.color;
  const known = OVERPASS_ENDPOINTS.includes(settings.endpoint);
  serverEl.value = known ? settings.endpoint : CUSTOM;
  customRow.hidden = known;
  if (!known) endpointEl.value = settings.endpoint;
  // The overlay colour is the popup's only accent, so it always matches the map.
  document.documentElement.style.setProperty('--accent', settings.color);
  document.documentElement.style.setProperty('--on-accent', inkOn(settings.color));
}
showSettings();

minBboxEl.addEventListener('change', () => {
  const v = Number(minBboxEl.value);
  if (Number.isFinite(v) && v >= 0) void saveSettings({ minBboxKm: v }).then(previewArea);
});
colorEl.addEventListener('input', () => {
  void saveSettings({ color: colorEl.value });
  showSettings();
});
serverEl.addEventListener('change', () => {
  customRow.hidden = serverEl.value !== CUSTOM;
  if (serverEl.value === CUSTOM) endpointEl.focus();
  else void saveSettings({ endpoint: serverEl.value });
});
endpointEl.addEventListener('change', () => {
  // https only: queries reveal where you're looking on the map.
  const ok = isHttpsUrl(endpointEl.value);
  endpointEl.setCustomValidity(ok ? '' : 'Use an https:// Overpass server address.');
  endpointEl.reportValidity();
  if (ok) void saveSettings({ endpoint: endpointEl.value });
});

// Remember whether Settings was left open. A convenience only, so failures are ignored.
try {
  settingsEl.open = localStorage.getItem('settingsOpen') === '1';
} catch {}
settingsEl.addEventListener('toggle', () => {
  try {
    localStorage.setItem('settingsOpen', settingsEl.open ? '1' : '0');
  } catch {}
});

// ===== Query editor =====

const TOKEN = /\{\{\s*(?:bbox|center)\s*\}\}/g;

/** Mirror the query into the backdrop, wrapping {{tokens}} in <mark>. Text only, never HTML. */
function highlight() {
  const text = queryEl.value;
  const nodes: (Node | string)[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    nodes.push(text.slice(last, m.index), el('mark', { textContent: m[0] }));
    last = m.index + m[0].length;
  }
  // A trailing newline needs something after it to take up a line.
  nodes.push(`${text.slice(last)} `);
  highlightsEl.replaceChildren(...nodes);
  syncBackdrop();
}

function syncBackdrop() {
  // Match the textarea's wrapping width (its scrollbar narrows it) and its scroll position.
  highlightsEl.parentElement!.style.paddingRight = `${16 + queryEl.offsetWidth - queryEl.clientWidth}px`;
  highlightsEl.style.transform = `translateY(${-queryEl.scrollTop}px)`;
}

queryEl.value = await queryItem.getValue();
highlight();
// Saved on every keystroke: the popup can close at any moment, taking any pending timer with it.
queryEl.addEventListener('input', () => {
  highlight();
  void queryItem.setValue(queryEl.value);
});
queryEl.addEventListener('scroll', syncBackdrop);
new ResizeObserver(syncBackdrop).observe(queryEl);
queryEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runBtn.click();
  }
});

// ===== The map in this tab =====

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

async function getView(): Promise<GetViewResponse | undefined> {
  try {
    return tab?.id === undefined ? undefined : await requestView(tab.id);
  } catch {
    return undefined; // no content script in this tab
  }
}

const NOT_MAPS = 'Open Google Maps in this tab to run a query. If it’s already open, reload the page (needed after installing).';
let haveMap = false;

/** Say what {{bbox}} will be, and disable Run when there's no map to query. */
async function previewArea() {
  const view = await getView();
  haveMap = !!view?.ok;
  updateRunButton();
  if (!view?.ok) {
    tokensEl.replaceChildren(view ? view.error : NOT_MAPS);
    return;
  }
  const { width, height } = boundsSizeKm(expandBounds(view.bounds, settings.minBboxKm));
  const km = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString());
  const code = (t: string) => el('code', { textContent: t });
  tokensEl.replaceChildren(code('{{bbox}}'), ` is ${km(width)} × ${km(height)} km around the map view, and `, code('{{center}}'), ' its centre.');
}

// ===== Running =====

let currentStatus: RunStatus = await statusItem.getValue();
let ticker: ReturnType<typeof setInterval> | undefined;

function updateRunButton() {
  runBtn.disabled = !haveMap || currentStatus.state === 'running';
}

function nextServer(): string {
  const i = OVERPASS_ENDPOINTS.indexOf(settings.endpoint);
  return OVERPASS_ENDPOINTS[(i + 1) % OVERPASS_ENDPOINTS.length];
}

function showActivity(s: RunStatus) {
  currentStatus = s;
  clearInterval(ticker);
  updateRunButton();
  activityEl.classList.toggle('error', s.state === 'error');
  if (s.state === 'running') {
    const elapsed = el('span', { className: 'elapsed' });
    const tick = () => {
      const secs = Math.max(0, Math.round((Date.now() - s.startedAt) / 1000));
      elapsed.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    };
    tick();
    ticker = setInterval(tick, 1000);
    const cancel = el('button', { className: 'text', textContent: 'Cancel', onclick: () => void sendToBackground({ type: 'cancelQuery' }) });
    activityEl.replaceChildren(`Searching ${hostOf(s.endpoint)}… `, elapsed, ' ', cancel);
  } else if (s.state === 'error') {
    activityEl.replaceChildren(s.message);
    if (s.unreachable) {
      const next = nextServer();
      const retry = el('button', {
        className: 'text',
        textContent: `Try ${hostOf(next)}`,
        onclick: async () => {
          await saveSettings({ endpoint: next });
          showSettings();
          runBtn.click();
        },
      });
      activityEl.append(' ', retry);
    }
  } else {
    activityEl.replaceChildren();
  }
}

showActivity(currentStatus);
statusItem.watch((s) => showActivity(s));

runBtn.addEventListener('click', async () => {
  const view = await getView();
  if (!view?.ok) return void previewArea();
  const bbox = expandBounds(view.bounds, settings.minBboxKm);
  await sendToBackground({ type: 'runQuery', query: fillPlaceholders(queryEl.value, bbox, view.center) });
});

// ===== Legend: what's on the map =====

let resultCount = (await resultsItem.getValue())?.features.length ?? null;

function showResults() {
  const has = resultCount !== null;
  resultsEl.classList.toggle('empty', !has);
  resultsEl.textContent = !has
    ? 'Nothing on the map yet.'
    : `${resultCount!.toLocaleString()} feature${resultCount === 1 ? '' : 's'}${settings.visible ? ' on the map' : ', hidden'}`;
  zoomBtn.hidden = toggleBtn.hidden = clearBtn.hidden = !has;
  zoomBtn.disabled = !resultCount || !settings.visible;
  toggleBtn.textContent = settings.visible ? 'Hide' : 'Show';
}

showResults();
resultsItem.watch((fc) => {
  resultCount = fc?.features.length ?? null;
  showResults();
});
settingsItem.watch(async () => {
  settings = await getSettings();
  showResults();
});

zoomBtn.addEventListener('click', () => {
  if (tab?.id !== undefined) void zoomToResults(tab.id).catch(() => {});
});
toggleBtn.addEventListener('click', () => void saveSettings({ visible: !settings.visible }).then(showResults));
clearBtn.addEventListener('click', async () => {
  await sendToBackground({ type: 'cancelQuery' });
  await resultsItem.setValue(null);
  await statusItem.setValue({ state: 'idle' });
});

await previewArea();
