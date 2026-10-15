import { browser, defineContentScript, injectScript } from '#imports';
import { CAMERA_EVENT, parseCameraEvent, type MapCamera } from '@/lib/camera-proto.ts';
import { largest } from '@/lib/dom.ts';
import { FeatureCard } from '@/lib/feature-card.ts';
import { parseCamera } from '@/lib/gmaps-url.ts';
import { MAPS_MATCHES } from '@/lib/matches.ts';
import { project, TILE_SIZE, unproject, viewBounds, type View } from '@/lib/mercator.ts';
import type { TabRequest, TabResponse } from '@/lib/messages.ts';
import { findMinimapViewport, readMinimapView } from '@/lib/minimap.ts';
import { Overlay } from '@/lib/overlay.ts';
import { hitTest, prepare, type Prepared } from '@/lib/render.ts';
import { getSettings, resultsItem, watchSettings } from '@/lib/storage.ts';

const URL_POLL_MS = 100;
const MINIMAP_POLL_MS = 250;
/** A press/release closer than this (px, ms) counts as a click, not a drag. */
const CLICK_SLOP_PX = 5;
const CLICK_MAX_MS = 600;

/** How long after a feature click to withhold the mouseup / click / dblclick that follow. */
const SWALLOW_MS = 400;
/** How far the replayed release moves, past Google's click slop (Firefox only). */
const DRAG_NUDGE_PX = 20;

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
    // Repaint when the card changes feature, so the map highlights the one on show.
    const card = new FeatureCard(() => render());
    const haveSomethingToShow = () => settings.visible && features.length > 0;
    /** The feature under the pointer, outlined as a hint that it can be clicked. */
    let hovered: Prepared | null = null;
    const highlighted = () => [card.selected, hovered].filter((f, i, all): f is Prepared => !!f && all.indexOf(f) === i);

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

    const render = () => overlay.paint(mainVisible() ? view : null, features, settings.color, highlighted());

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
      mini.paint(miniVisible() ? miniView : null, features, settings.color, highlighted());
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

    function setHovered(f: Prepared | null) {
      if (f === hovered) return;
      hovered = f;
      render(); // the mini-map picks it up on its next frame
    }

    // Hit-test at most once a frame, against the latest pointer position.
    let lastMove: PointerEvent | null = null;
    let hoverFrame = 0;
    ctx.addEventListener(window, 'pointermove', (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      lastMove = e;
      hoverFrame ||= requestAnimationFrame(() => {
        hoverFrame = 0;
        const m = lastMove!;
        // Not while a button is down: that's a drag of the map.
        setHovered(m.buttons ? null : featuresAt(m.target, m.clientX, m.clientY)[0] ?? null);
      });
    }, { capture: true, passive: true });
    // Leaving the window: no relatedTarget.
    ctx.addEventListener(window, 'pointerout', (e: PointerEvent) => {
      if (!e.relatedTarget) setHovered(null);
    });

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

    for (const type of ['mouseup', 'click', 'dblclick'] as const) {
      ctx.addEventListener(window, type, (e: MouseEvent) => {
        if (!e.isTrusted || e.timeStamp >= swallowUntil || card.contains(e)) return;
        swallow(e);
        if (import.meta.env.FIREFOX && type === 'mouseup') endGoogleDrag(e);
      }, capture);
    }

    // In Firefox, Google's map follows the mouse from mousedown until a mouseup,
    // and opens its own panel on a mouseup that hasn't moved. Withholding the
    // mouseup left the map stuck to the cursor, so replay the release as the end
    // of a small drag: Google then lets go without opening its panel, and
    // doesn't pan. (In Chrome it uses pointer events and this would open the panel.)
    function endGoogleDrag(up: MouseEvent) {
      const fire = (type: string, buttons: number) => up.target?.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons,
        clientX: up.clientX + DRAG_NUDGE_PX, clientY: up.clientY, screenX: up.screenX + DRAG_NUDGE_PX, screenY: up.screenY,
      }));
      fire('mousemove', 1);
      fire('mouseup', 0);
    }

    ctx.addEventListener(window, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && card.isOpen) card.close();
    }, capture);

    // ===== Data & messages ==================================================

    // The mini-map repaints itself every frame; only the main map needs a nudge.
    const unwatchResults = resultsItem.watch((fc) => {
      features = prepare(fc);
      hovered = null;
      card.close();
      render();
    });
    const unwatchSettings = watchSettings((s) => {
      settings = s;
      render();
    });

    /** Move the map to fit the results. Google only takes a new camera by URL, so this reloads the page. */
    function zoomToResults(): boolean {
      if (!features.length) return false;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const f of features) {
        minX = Math.min(minX, f.minX);
        minY = Math.min(minY, f.minY);
        maxX = Math.max(maxX, f.maxX);
        maxY = Math.max(maxY, f.maxY);
      }
      const width = sceneSize.width || window.innerWidth;
      const height = sceneSize.height || window.innerHeight;
      // Leave a margin, and don't zoom further in than a street.
      const fit = Math.min((width * 0.8) / ((maxX - minX) * TILE_SIZE), (height * 0.8) / ((maxY - minY) * TILE_SIZE));
      const zoom = Math.max(2, Math.min(17, Math.log2(fit)));
      const [lng, lat] = unproject((minX + maxX) / 2, (minY + maxY) / 2);
      location.assign(`${location.origin}/maps/@${lat.toFixed(7)},${lng.toFixed(7)},${zoom.toFixed(2)}z${location.search}`);
      return true;
    }

    const onMessage = (msg: unknown, _sender: unknown, sendResponse: (r: TabResponse) => void) => {
      const type = (msg as Partial<TabRequest> | null)?.type;
      if (type === 'zoomToResults') {
        sendResponse({ ok: zoomToResults() });
        return;
      }
      if (type !== 'getView') return;
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
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      overlay.host.remove();
      mini.host.remove();
      card.close();
    });

    attach();
    watchMinimap();
  },
});
