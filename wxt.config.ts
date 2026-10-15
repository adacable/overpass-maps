import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'Overpass Maps',
    description: 'Overlay Overpass API query results on Google Maps.',
    // No host permissions: Overpass allows cross-origin requests (CORS), and
    // Google Maps access comes from the content-script matches.
    permissions: ['storage'],
    action: { default_title: 'Overpass Maps' },
    // Firefox MV2 has no MAIN-world content scripts, so its camera hook is
    // injected as a <script>; moz-extension:// URLs are random per install.
    ...(browser === 'firefox' ? { web_accessible_resources: ['camera-hook.js'] } : {}),
    browser_specific_settings: {
      gecko: { id: 'overpass-maps@extension' },
    },
  }),
});
