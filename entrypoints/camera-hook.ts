import { defineUnlistedScript } from '#imports';
import { installCameraHook } from '@/lib/camera-hook.ts';

// Firefox only: injected into the page by maps.content.ts as a
// web-accessible <script>. (Chrome uses camera-hook-main.content.ts.)
export default defineUnlistedScript({
  include: ['firefox'],
  main: installCameraHook,
});
