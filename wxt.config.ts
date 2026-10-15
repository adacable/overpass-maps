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
    ...(browser === 'firefox'
      ? {
          // Firefox MV2 has no MAIN-world content scripts, so its camera hook is
          // injected as a <script>; moz-extension:// URLs are random per install.
          web_accessible_resources: ['camera-hook.js'],
          browser_specific_settings: {
            gecko: {
              id: 'overpass-maps@thingsarebootwontfix.com',
              // The area of the map on screen goes to the chosen Overpass server
              // with each query (see PRIVACY.md). That's what the page shows, not
              // where the user is. Firefox shows this at install; it needs 140+.
              data_collection_permissions: { required: ['websiteContent'] },
              strict_min_version: '140.0',
            },
          },
        }
      : {}),
  }),
});
