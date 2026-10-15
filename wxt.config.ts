import { defineConfig } from 'wxt';
import { MAPS_MATCHES, OVERPASS_HOST_PERMISSIONS } from './lib/matches.ts';

// web_accessible_resources only accepts origin-level patterns (path must be /*).
const MAPS_ORIGINS = [...new Set(MAPS_MATCHES.map((m) => `${new URL(m.replace('*', '')).origin}/*`))];

// Requested at runtime only if you configure a custom Overpass endpoint.
const OPTIONAL_HOSTS = ['https://*/*'];

export default defineConfig({
  manifest: ({ manifestVersion }) => ({
    name: 'Overpass Maps',
    description: 'Overlay Overpass API query results on Google Maps.',
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: OVERPASS_HOST_PERMISSIONS,
    // WXT doesn't translate optional host permissions down to MV2 (Firefox).
    ...(manifestVersion === 3 ? { optional_host_permissions: OPTIONAL_HOSTS } : { optional_permissions: OPTIONAL_HOSTS }),
    action: { default_title: 'Overpass Maps' },
    // The camera hook is injected into the Maps page as a <script src>.
    web_accessible_resources:
      manifestVersion === 3 ? [{ resources: ['camera-hook.js'], matches: MAPS_ORIGINS }] : ['camera-hook.js'],
    browser_specific_settings: {
      gecko: { id: 'overpass-maps@extension' },
    },
  }),
});
