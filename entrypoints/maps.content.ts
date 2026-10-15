import { browser, defineContentScript, injectScript } from '#imports';
import { CAMERA_EVENT, parseCameraEvent, type MapCamera } from '@/lib/camera-proto.ts';
import { largest } from '@/lib/dom.ts';
import { FeatureCard } from '@/lib/feature-card.ts';
import { parseCamera } from '@/lib/gmaps-url.ts';
import { MAPS_MATCHES } from '@/lib/matches.ts';
import { project, unproject, viewBounds, type View } from '@/lib/mercator.ts';
import type { GetViewRequest, GetViewResponse } from '@/lib/messages.ts';
import { findMinimapViewport, readMinimapView } from '@/lib/minimap.ts';
import { Overlay } from '@/lib/overlay.ts';
import { hitTest, prepare } from '@/lib/render.ts';
import { getSettings, resultsItem, watchSettings } from '@/lib/storage.ts';

const URL_POLL_MS = 100;
const MINIMAP_POLL_MS = 250;
/** A press/release closer than this (px, ms) counts as a click, not a drag. */
const CLICK_SLOP_PX = 5;
const CLICK_MAX_MS = 600;

/** How long after a feature click to withhold the mouseup / click / dblclick that follow. */
const SWALLOW_MS = 400;

function swallow(e: Event) {
  e.stopImmediatePropagation();
  e.preventDefault();
}

export default defineContentScript({
  matches: MAPS_MATCHES,
  runAt: 'document_idle',

  async main(ctx) {
    let settings = await getSettings();
    let features = prepare(await resultsItem.getValue());
    const card = new FeatureCard();
    const haveSomethingToShow = () => settings.visible && features.length > 0;

    // ===== Main map =========================================================

    const overlay = new Overlay();
    let scene: HTMLCanvasElement | null = null;
    // Measured in layout(), not per frame: reading it in a camera event could
    // force a layout in the middle of Google's frame.
    let sceneSize = { width: 0, height: 0 };

    // Where the map is looking. Google's per-frame camera messages (see
    // camera-hook.ts) are exact, including during animations; the URL is the
    // fallback until the first message arrives, or if the hook stops matching
    // Google's code.
    let camera: MapCamera | null = null;
    let haveLiveCamera = false;
    let urlRotated = false;
    let view: View | null = null;

    const mainVisible = () => !!view && !camera?.rotated && !urlRotated && haveSomethingToShow();

    function updateView() {
      const { width, height } = sceneSize;
      if (!camera || !width || !height) {
        view = null;
        return;
      }
      const [cx, cy] = project(camera.lng, camera.lat);
      view = { cx, cy, zoom: camera.zoom, width, height };
    }

    const render = () => overlay.paint(mainVisible() ? view : null, features, settings.color);

    const resizeObserver = new ResizeObserver(() => layout());

    function attach() {
      // Google's class names are obfuscated and change, so go by size: the map
      // is the largest canvas, covering most of the window.
      const found = largest(document.querySelectorAll('canvas'), window.innerWidth * window.innerHeight * 0.5);
      if (found !== scene) {
        if (scene) resizeObserver.unobserve(scene);
        scene = found;
        if (scene) resizeObserver.observe(scene);
        else sceneSize = { width: 0, height: 0 };
      }
      if (!scene) return;
      // Google stacks several canvases in the map container; sit above the
      // last of them so we're over the map but under Google's panels and controls.
      const canvases = scene.parentElement!.querySelectorAll(':scope > canvas');
      const anchor = canvases[canvases.length - 1] ?? scene;
      if (overlay.host.previousElementSibling !== anchor) {
        anchor.after(overlay.host);
        layout();
      }
    }

    function layout() {
      if (!scene) return;
      sceneSize = { width: scene.clientWidth, height: scene.clientHeight };
      overlay.fitTo(scene);
      syncFromUrl();
      render();
    }

    let lastHref = '';

    function syncFromUrl() {
      lastHref = location.href;
      const cam = parseCamera(location.href, sceneSize.height);
      // 3D / Street View / rotated views are flagged in the URL; hide for those
      // even when camera messages are flowing.
      urlRotated = !!cam?.rotated;
      if (!haveLiveCamera && cam && cam.zoom !== null) {
        camera = { lat: cam.lat, lng: cam.lng, zoom: cam.zoom, rotated: cam.rotated };
      }
      updateView();
    }

    ctx.setInterval(() => {
      if (location.href === lastHref) return;
      syncFromUrl();
      render();
    }, URL_POLL_MS);
    // Google re-renders parts of the page; re-attach if our canvas gets dropped
    // or another canvas gets stacked above it.
    ctx.setInterval(attach, 1000);
    ctx.addEventListener(window, 'resize', () => layout());

    const onCamera = (e: Event) => {
      const cam = parseCameraEvent((e as CustomEvent<unknown>).detail);
      if (!cam) return;
      haveLiveCamera = true;
      camera = cam;
      updateView();
      // Draw immediately rather than on the next animation frame: the message
      // is sent from Google's own frame callback, so this keeps us in step.
      render();
    };
    document.addEventListener(CAMERA_EVENT, onCamera);
    // Chrome runs the hook as a MAIN-world content script; Firefox MV2 can't.
    if (import.meta.env.FIREFOX) void injectScript('/camera-hook.js');

    // ===== Street View mini-map =============================================
    // A separate, tile-based map; we read its position from the tiles every
    // frame while it's on screen (see lib/minimap.ts).

    const mini = new Overlay();
    let miniViewport: HTMLElement | null = null;
    let miniView: View | null = null;
    let miniFrame = 0;

    const miniVisible = () => !!miniViewport && !!miniView && haveSomethingToShow();

    function miniTick() {
      miniFrame = 0;
      if (!miniViewport?.isConnected) return watchMinimap();
      if (mini.host.nextElementSibling !== miniViewport) placeMini(miniViewport);
      if (haveSomethingToShow()) {
        // Read the tiles before fitTo writes, so there's at most one layout per frame.
        miniView = readMiniView();
        mini.fitTo(miniViewport);
      }
      // Reading the tiles every frame is cheap; paint only redraws when something moved.
      mini.paint(miniVisible() ? miniView : null, features, settings.color);
      miniFrame = requestAnimationFrame(miniTick);
    }

    // Tiles can be briefly unreadable while Google swaps them; keep the last
    // view rather than blinking out.
    const readMiniView = () => (miniViewport && readMinimapView(miniViewport)) ?? miniView;

    function placeMini(vp: HTMLElement) {
      // Just under the mini-map's input layer: sharing its z-index but earlier in
      // the DOM puts us above the tiles and below pegman and the controls.
      vp.before(mini.host);
      mini.host.style.zIndex = getComputedStyle(vp).zIndex;
      mini.invalidate();
    }

    // Google re-renders the mini-map's DOM while it moves (pan, zoom, rotating
    // Street View), dropping our canvas each time. Put it back as soon as that
    // happens: observer callbacks run before the next paint, so it never blinks.
    const miniObserver = new MutationObserver(() => {
      if (miniViewport?.isConnected && mini.host.nextElementSibling !== miniViewport) placeMini(miniViewport);
      else if (miniViewport && !miniViewport.isConnected) watchMinimap();
    });

    function watchMinimap() {
      // Only in Street View (flagged by the URL): the Layers button's preview
      // thumbnail is also a tile mini-map, and must be left alone.
      const vp = urlRotated ? findMinimapViewport() : null;
      if (vp === miniViewport) return;
      miniViewport = vp;
      miniObserver.disconnect();
      if (miniFrame) cancelAnimationFrame(miniFrame);
      miniFrame = 0;
      if (!vp) {
        mini.host.remove();
        miniView = null;
        return;
      }
      placeMini(vp);
      // Watch a couple of levels up so we also notice the input layer itself being replaced.
      miniObserver.observe(vp.parentElement?.parentElement ?? vp.parentElement!, { childList: true, subtree: true });
      miniTick();
    }
    ctx.setInterval(watchMinimap, MINIMAP_POLL_MS);

    // ===== Clicking features ================================================
    // A click on a feature shows our card instead of Google's. Presses always
    // go through (so drags starting on a feature still pan the map); only the
    // release of a click that hits a feature is withheld from Google.

    function featuresAt(target: EventTarget | null, x: number, y: number) {
      if (!(target instanceof Node)) return [];
      const surfaces = [
        [miniVisible() ? miniView : null, miniViewport, mini],
        [mainVisible() ? view : null, scene?.parentElement, overlay],
      ] as const;
      for (const [v, container, o] of surfaces) {
        // Must be on the map itself, not one of Google's panels floating over it.
        if (!v || !container?.contains(target)) continue;
        const r = o.host.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        return hitTest(v, features, x - r.left, y - r.top);
      }
      return [];
    }

    let press: { id: number; x: number; y: number; t: number } | null = null;
    let swallowUntil = 0;
    const capture = { capture: true };

    ctx.addEventListener(window, 'pointerdown', (e: PointerEvent) => {
      if (card.contains(e)) return;
      if (card.isOpen) card.close();
      press = e.isPrimary && e.button === 0 && !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
        ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }
        : null;
    }, capture);

    ctx.addEventListener(window, 'pointerup', (e: PointerEvent) => {
      const p = press;
      press = null;
      if (!p || p.id !== e.pointerId || card.contains(e)) return;
      const isClick = Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_SLOP_PX && e.timeStamp - p.t <= CLICK_MAX_MS;
      if (!isClick) return;
      const hits = featuresAt(e.target, e.clientX, e.clientY);
      if (!hits.length) return;
      swallow(e);
      swallowUntil = e.timeStamp + SWALLOW_MS;
      card.show(hits, e.clientX, e.clientY, settings.color);
    }, capture);

    for (const type of ['mouseup', 'click', 'dblclick']) {
      ctx.addEventListener(window, type, (e: Event) => {
        if (e.timeStamp < swallowUntil && !card.contains(e)) swallow(e);
      }, capture);
    }

    ctx.addEventListener(window, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && card.isOpen) card.close();
    }, capture);

    // ===== Data & messages ==================================================

    // The mini-map repaints itself every frame; only the main map needs a nudge.
    const unwatchResults = resultsItem.watch((fc) => {
      features = prepare(fc);
      card.close();
      render();
    });
    const unwatchSettings = watchSettings((s) => {
      settings = s;
      render();
    });

    const onMessage = (msg: unknown, _sender: unknown, sendResponse: (r: GetViewResponse) => void) => {
      if ((msg as Partial<GetViewRequest> | null)?.type !== 'getView') return;
      syncFromUrl();
      // In Street View, query around what the mini-map shows. A tilted or
      // rotated main map has no north-up rectangle to query.
      const v = urlRotated ? readMiniView() : camera?.rotated ? null : view;
      if (!v) {
        sendResponse({ ok: false, error: "Couldn't read the map position. Leave 3D or reset the map's tilt and rotation, then try again." });
        return;
      }
      const [lng, lat] = unproject(v.cx, v.cy);
      sendResponse({ ok: true, bounds: viewBounds(v), center: { lat, lng } });
    };
    browser.runtime.onMessage.addListener(onMessage);

    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage);
      document.removeEventListener(CAMERA_EVENT, onCamera);
      unwatchResults();
      unwatchSettings();
      resizeObserver.disconnect();
      miniObserver.disconnect();
      if (miniFrame) cancelAnimationFrame(miniFrame);
      overlay.host.remove();
      mini.host.remove();
      card.close();
    });

    attach();
    watchMinimap();
  },
});
