import { storage } from '#imports';
import type { FeatureCollection } from './osm.ts';
import { OVERPASS_ENDPOINTS } from './matches.ts';

export interface Settings {
  /** Minimum width/height of the {{bbox}} sent to Overpass, in km. */
  minBboxKm: number;
  color: string;
  endpoint: string;
  visible: boolean;
}

export type RunStatus =
  | { state: 'idle' }
  | { state: 'running'; startedAt: number; endpoint: string }
  | { state: 'done'; count: number; finishedAt: number }
  /** `unreachable`: no usable response from the server, so another server may do better. */
  | { state: 'error'; message: string; finishedAt: number; unreachable?: boolean };

const DEFAULT_QUERY = `// Cafés around the map view.
nwr["amenity"="cafe"]({{bbox}});
out geom;`;

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: { minBboxKm: 2, color: '#3f3d96', endpoint: OVERPASS_ENDPOINTS[0], visible: true },
});

/** The default colour before the indigo scheme; still stored by earlier installs. */
const OLD_DEFAULT_COLOR = '#e8175d';

/**
 * Stored settings over the defaults, so settings saved by an older version get
 * any new keys, and the old default colour moves to the new one.
 */
function withDefaults(s: Partial<Settings> | null): Settings {
  const merged = { ...settingsItem.fallback, ...s };
  return merged.color === OLD_DEFAULT_COLOR ? { ...merged, color: settingsItem.fallback.color } : merged;
}

export const getSettings = async () => withDefaults(await settingsItem.getValue());

export const watchSettings = (cb: (s: Settings) => void) => settingsItem.watch((s) => cb(withDefaults(s)));

export const queryItem = storage.defineItem<string>('local:query', { fallback: DEFAULT_QUERY });

export const resultsItem = storage.defineItem<FeatureCollection | null>('local:results', { fallback: null });

export const statusItem = storage.defineItem<RunStatus>('local:status', { fallback: { state: 'idle' } });
