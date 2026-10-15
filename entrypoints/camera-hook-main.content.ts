import { defineContentScript } from '#imports';
import { installCameraHook } from '@/lib/camera-hook.ts';
import { MAPS_MATCHES } from '@/lib/matches.ts';

// Chrome: run the camera hook directly in the page's JS context. Unlike an
// injected <script>, this needs no web-accessible resource, so pages can't
// probe for the extension by URL.
export default defineContentScript({
  matches: MAPS_MATCHES,
  world: 'MAIN',
  runAt: 'document_start',
  exclude: ['firefox'],
  main: installCameraHook,
});
