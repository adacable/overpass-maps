import { defineConfig } from 'wxt';
import { OVERPASS_HOST_PERMISSIONS } from './lib/matches.ts';

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'Overpass Maps',
    description: 'Overlay Overpass API query results on Google Maps.',
    // Google Maps access comes from the content-script matches. The Overpass
    // servers allow cross-origin requests, so host permissions are only needed
    // to read their error replies (see matches.ts).
    permissions: ['storage'],
    host_permissions: OVERPASS_HOST_PERMISSIONS,
    action: { default_title: 'Overpass Maps' },
    // Firefox MV2 has no MAIN-world content scripts, so its camera hook is
    // injected as a <script>; moz-extension:// URLs are random per install.
    ...(browser === 'firefox' ? { web_accessible_resources: ['camera-hook.js'] } : {}),
    browser_specific_settings: {
      gecko: { id: 'overpass-maps@thingsarebootwontfix.com' },
    },
  }),
});
