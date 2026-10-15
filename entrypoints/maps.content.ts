import { browser, defineContentScript, injectScript } from '#imports';
import { CAMERA_EVENT, type MapCamera } from '@/lib/camera-proto.ts';
import { FeatureCard } from '@/lib/feature-card.ts';
import { parseCamera } from '@/lib/gmaps-url.ts';
import { MAPS_MATCHES } from '@/lib/matches.ts';
import { project, unproject, viewBounds, type View } from '@/lib/mercator.ts';
import type { GetViewRequest, GetViewResponse } from '@/lib/messages.ts';
import { findMinimapViewport, readMinimapView } from '@/lib/minimap.ts';
import { draw, hitTest, prepare } from '@/lib/render.ts';
import { resultsItem, settingsItem, type Settings } from '@/lib/storage.ts';

const URL_POLL_MS = 100;
const MINIMAP_POLL_MS = 250;
/** A press/release closer than this (px, ms) counts as a click, not a drag. */
const CLICK_SLOP_PX = 5;
const CLICK_MAX_MS = 600;

function makeOverlay(id: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.id = id;
  c.setAttribute('aria-hidden', 'true');
  Object.assign(c.style, { position: 'absolute', pointerEvents: 'none' });
  return c;
}

/** Match a canvas's position, size and pixel density to `target`. */
function fitTo(canvas: HTMLCanvasElement, target: HTMLElement) {
  const w = target.clientWidth;
  const h = target.clientHeight;
  Object.assign(canvas.style, { left: `${target.offsetLeft}px`, top: `${target.offsetTop}px`, width: `${w}px`, height: `${h}px` });
  // Resizing a canvas clears it, so only do it when the size really changed.
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
}

export default defineContentScript({
  matches: MAPS_MATCHES,
  runAt: 'document_idle',

  async main(ctx) {
    let settings: Settings = { ...settingsItem.fallback, ...(await settingsItem.getValue()) };
    let features = prepare(await resultsItem.getValue());
    const card = new FeatureCard();

    // ===== Main map =========================================================

    const overlay = makeOverlay('overpass-maps-overlay');
    const g2d = overlay.getContext('2d')!;
    let scene: HTMLCanvasElement | null = null;

    // Where the map is looking. Google's per-frame camera messages (see
    // camera-hook.ts) are exact, including during animations; the URL is the
    // fallback until the first message arrives, or if the hook stops matching
    // Google's code.
    let camera: { lat: number; lng: number; zoom: number } | null = null;
    let haveLiveCamera = false;
    let cameraRotated = false;
    let urlRotated = false;
    let view: View | null = null;

    const mainVisible = () => !!view && !cameraRotated && !urlRotated && settings.visible && features.length > 0;

    function updateView() {
      const width = scene?.clientWidth ?? 0;
      const height = scene?.clientHeight ?? 0;
      if (!camera || !width || !height) {
        view = null;
        return;
      }
      const [cx, cy] = project(camera.lng, camera.lat);
      view = { cx, cy, zoom: camera.zoom, width, height };
    }

    let frame = 0;
    function render() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const show = mainVisible();
      overlay.style.display = show ? '' : 'none';
      if (show) draw(g2d, view!, features, settings.color);
    }
    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };

    function findSceneCanvas(): HTMLCanvasElement | null {
      // Google's class names are obfuscated and change, so go by size: the map
      // is the largest canvas, covering most of the window.
      let best: HTMLCanvasElement | null = null;
      let bestArea = window.innerWidth * window.innerHeight * 0.5;
      for (const c of document.querySelectorAll('canvas')) {
        if (c === overlay) continue;
        const r = c.getBoundingClientRect();
        if (r.width * r.height > bestArea) {
          best = c;
          bestArea = r.width * r.height;
        }
      }
      return best;
    }

    const resizeObserver = new ResizeObserver(() => layout());

    function attach() {
      const found = findSceneCanvas();
      if (found !== scene) {
        if (scene) resizeObserver.unobserve(scene);
        scene = found;
        if (scene) resizeObserver.observe(scene);
      }
      if (!scene) return;
      // Google stacks several canvases in the map container; sit above the
      // last of them so we're over the map but under Google's panels and controls.
      const canvases = [...scene.parentElement!.querySelectorAll(':scope > canvas')].filter((c) => c !== overlay);
      const anchor = canvases[canvases.length - 1] ?? scene;
      if (overlay.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement('afterend', overlay);
        layout();
      }
    }

    function layout() {
      if (!scene) return;
      fitTo(overlay, scene);
      syncFromUrl();
      updateView();
      render();
    }

    let lastHref = '';

    function syncFromUrl() {
      lastHref = location.href;
      const cam = parseCamera(location.href, scene?.clientHeight ?? 0);
      // 3D / Street View / rotated views are flagged in the URL; hide for those
      // even when camera messages are flowing.
      urlRotated = !!cam?.rotated;
      if (!haveLiveCamera && cam && cam.zoom !== null) {
        camera = { lat: cam.lat, lng: cam.lng, zoom: cam.zoom };
      }
    }

    ctx.setInterval(() => {
      if (location.href === lastHref) return;
      syncFromUrl();
      updateView();
      redraw();
    }, URL_POLL_MS);
    // Google re-renders parts of the page; re-attach if our canvas gets dropped
    // or another canvas gets stacked above it.
    ctx.setInterval(attach, 1000);
    ctx.addEventListener(window, 'resize', () => layout());

    const onCamera = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (typeof detail !== 'string') return;
      const cam = JSON.parse(detail) as MapCamera;
      haveLiveCamera = true;
      camera = cam;
      cameraRotated = cam.rotated;
      updateView();
      // Draw immediately rather than on the next animation frame: the message
      // is sent from Google's own frame callback, so this keeps us in step.
      render();
    };
    document.addEventListener(CAMERA_EVENT, onCamera);
    void injectScript('/camera-hook.js');

    // ===== Street View mini-map =============================================
    // A separate, tile-based map; we read its position from the tiles every
    // frame while it's on screen (see lib/minimap.ts).

    const mini = makeOverlay('overpass-maps-minimap');
    const mini2d = mini.getContext('2d')!;
    let miniViewport: HTMLElement | null = null;
    let miniView: View | null = null;
    let miniKey = '';
    let miniFrame = 0;

    const miniVisible = () => !!miniViewport && !!miniView && settings.visible && features.length > 0;

    function miniTick() {
      miniFrame = 0;
      if (!miniViewport?.isConnected) return watchMinimap();
      if (mini.nextElementSibling !== miniViewport) placeMini(miniViewport);
      fitTo(mini, miniViewport);
      // Tiles can be briefly unreadable while Google swaps them; keep the last
      // view rather than blinking out.
      miniView = readMinimapView(miniViewport) ?? miniView;
      const show = miniVisible();
      mini.style.display = show ? '' : 'none';
      // Only redraw when something moved; reading the tiles is cheap, drawing less so.
      const key = show ? `${miniView!.cx},${miniView!.cy},${miniView!.zoom},${mini.width},${mini.height},${settings.color}` : '';
      if (show && key !== miniKey) draw(mini2d, miniView!, features, settings.color);
      miniKey = key;
      miniFrame = requestAnimationFrame(miniTick);
    }

    function placeMini(vp: HTMLElement) {
      // Just under the mini-map's input layer: sharing its z-index but earlier in
      // the DOM puts us above the tiles and below pegman and the controls.
      vp.insertAdjacentElement('beforebegin', mini);
      mini.style.zIndex = getComputedStyle(vp).zIndex;
      miniKey = ''; // force a redraw
    }

    // Google re-renders the mini-map's DOM while it moves (pan, zoom, rotating
    // Street View), dropping our canvas each time. Put it back as soon as that
    // happens: observer callbacks run before the next paint, so it never blinks.
    const miniObserver = new MutationObserver(() => {
      if (miniViewport?.isConnected && mini.nextElementSibling !== miniViewport) placeMini(miniViewport);
      else if (miniViewport && !miniViewport.isConnected) watchMinimap();
    });

    function watchMinimap() {
      const vp = findMinimapViewport();
      if (vp === miniViewport) return;
      miniViewport = vp;
      miniObserver.disconnect();
      if (miniFrame) cancelAnimationFrame(miniFrame);
      miniFrame = 0;
      if (!vp) {
        mini.remove();
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
      const surfaces: [boolean, HTMLElement | null | undefined, HTMLCanvasElement, View | null][] = [
        [miniVisible(), miniViewport, mini, miniView],
        [mainVisible(), scene?.parentElement, overlay, view],
      ];
      for (const [visible, container, canvas, v] of surfaces) {
        // Must be on the map itself, not one of Google's panels floating over it.
        if (!visible || !v || !container?.contains(target)) continue;
        const r = canvas.getBoundingClientRect();
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
      e.stopImmediatePropagation();
      e.preventDefault();
      // Also withhold the mouseup / click / dblclick that follow this release.
      swallowUntil = e.timeStamp + 400;
      card.show(hits, e.clientX, e.clientY, settings.color);
    }, capture);

    for (const type of ['mouseup', 'click', 'dblclick']) {
      ctx.addEventListener(window, type, (e: Event) => {
        if (e.timeStamp < swallowUntil && !card.contains(e)) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      }, capture);
    }

    ctx.addEventListener(window, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && card.isOpen) card.close();
    }, capture);

    // ===== Data & messages ==================================================

    const refreshAll = () => {
      miniKey = '';
      redraw();
    };
    const unwatchResults = resultsItem.watch((fc) => {
      features = prepare(fc);
      card.close();
      refreshAll();
    });
    const unwatchSettings = settingsItem.watch((s) => {
      settings = { ...settingsItem.fallback, ...s };
      refreshAll();
    });

    const onMessage = (msg: GetViewRequest, _sender: unknown, sendResponse: (r: GetViewResponse) => void) => {
      if (msg?.type !== 'getView') return;
      syncFromUrl();
      updateView();
      // In Street View, query around what the mini-map shows.
      const v = urlRotated && miniView ? miniView : view;
      if (!v || (v === view && (!camera || urlRotated))) {
        sendResponse({ ok: false, error: "Couldn't read the map position. Switch out of 3D and try again." });
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
      overlay.remove();
      mini.remove();
      card.close();
    });

    attach();
    watchMinimap();
  },
});
