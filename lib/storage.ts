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
  | { state: 'running'; startedAt: number }
  | { state: 'done'; count: number; finishedAt: number }
  | { state: 'error'; message: string; finishedAt: number };

export const DEFAULT_QUERY = `// {{bbox}} is the visible map area, grown to the minimum size set below.
nwr["amenity"="cafe"]({{bbox}});
out geom;`;

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: { minBboxKm: 2, color: '#e8175d', endpoint: OVERPASS_ENDPOINTS[0], visible: true },
});

export const queryItem = storage.defineItem<string>('local:query', { fallback: DEFAULT_QUERY });

export const resultsItem = storage.defineItem<FeatureCollection | null>('local:results', { fallback: null });

export const statusItem = storage.defineItem<RunStatus>('local:status', { fallback: { state: 'idle' } });
