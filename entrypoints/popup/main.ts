import { browser } from '#imports';
import { OVERPASS_ENDPOINTS } from '@/lib/matches.ts';
import { expandBounds } from '@/lib/mercator.ts';
import type { GetViewResponse } from '@/lib/messages.ts';
import { fillPlaceholders } from '@/lib/osm.ts';
import { queryItem, resultsItem, settingsItem, statusItem, type RunStatus, type Settings } from '@/lib/storage.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const queryEl = $<HTMLTextAreaElement>('query');
const runBtn = $<HTMLButtonElement>('run');
const cancelBtn = $<HTMLButtonElement>('cancel');
const clearBtn = $<HTMLButtonElement>('clear');
const statusEl = $<HTMLParagraphElement>('status');
const minBboxEl = $<HTMLInputElement>('minBboxKm');
const colorEl = $<HTMLInputElement>('color');
const visibleEl = $<HTMLInputElement>('visible');
const endpointEl = $<HTMLInputElement>('endpoint');

for (const url of OVERPASS_ENDPOINTS) {
  const opt = document.createElement('option');
  opt.value = url;
  $('endpoints').append(opt);
}

let settings: Settings = { ...settingsItem.fallback, ...(await settingsItem.getValue()) };
queryEl.value = await queryItem.getValue();
minBboxEl.value = String(settings.minBboxKm);
colorEl.value = settings.color;
visibleEl.checked = settings.visible;
endpointEl.value = settings.endpoint;

async function saveSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  await settingsItem.setValue(settings);
}

minBboxEl.addEventListener('change', () => {
  const v = Number(minBboxEl.value);
  if (Number.isFinite(v) && v >= 0) void saveSettings({ minBboxKm: v });
});
colorEl.addEventListener('input', () => void saveSettings({ color: colorEl.value }));
visibleEl.addEventListener('change', () => void saveSettings({ visible: visibleEl.checked }));
const isHttps = (v: string) => URL.canParse(v) && new URL(v).protocol === 'https:';
endpointEl.addEventListener('change', () => {
  // https only: queries reveal where you're looking on the map.
  const ok = isHttps(endpointEl.value);
  endpointEl.setCustomValidity(ok ? '' : 'Use an https:// Overpass endpoint.');
  endpointEl.reportValidity();
  if (ok) void saveSettings({ endpoint: endpointEl.value });
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
queryEl.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void queryItem.setValue(queryEl.value), 300);
});
queryEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runBtn.click();
  }
});

function showStatus(s: RunStatus, error?: string) {
  statusEl.classList.toggle('error', !!error || s.state === 'error');
  runBtn.disabled = s.state === 'running';
  cancelBtn.hidden = s.state !== 'running';
  if (error) statusEl.textContent = error;
  else if (s.state === 'running') statusEl.textContent = 'Running query…';
  else if (s.state === 'done') statusEl.textContent = `${s.count} feature${s.count === 1 ? '' : 's'} on the map.`;
  else if (s.state === 'error') statusEl.textContent = s.message;
  else statusEl.textContent = '';
}

showStatus(await statusItem.getValue());
statusItem.watch((s) => showStatus(s));

runBtn.addEventListener('click', async () => {
  clearTimeout(saveTimer);
  const raw = queryEl.value;
  void queryItem.setValue(raw);

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let view: GetViewResponse;
  try {
    view = await browser.tabs.sendMessage(tab.id!, { type: 'getView' });
    if (!view) throw new Error();
  } catch {
    return showStatus(
      { state: 'idle' },
      'Open Google Maps in this tab first. If it is already open, reload the page (needed after installing the extension).',
    );
  }
  if (!view.ok) return showStatus({ state: 'idle' }, view.error);

  const bbox = expandBounds(view.bounds, settings.minBboxKm);
  const query = fillPlaceholders(raw, bbox, view.center);
  await browser.runtime.sendMessage({ type: 'runQuery', query });
});

cancelBtn.addEventListener('click', () => void browser.runtime.sendMessage({ type: 'cancelQuery' }));

clearBtn.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'cancelQuery' });
  await resultsItem.setValue(null);
  await statusItem.setValue({ state: 'idle' });
});
