# Overpass Maps

Browser extension (Chrome + Firefox) that draws the results of an
[Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) query on top
of Google Maps. The overlay ignores clicks, so the map works exactly as it would
without the extension.

## Use

1. Open Google Maps.
2. Click the extension icon, write a query, then click **Run** (or press Ctrl/⌘+Enter).
   - `{{bbox}}` is replaced with the visible map area. If that area is smaller
     than **Minimum query area** (km, per side), it is grown around the centre
     first. This keeps a zoomed-in query from returning almost nothing.
   - `{{center}}` is replaced with `lat,lng` of the map centre.
   - Output is forced to JSON. Use `out geom;` for full shapes, or
     `out center;` for just points.
3. Results stay on the map, in every Google Maps tab, until you click **Clear**.
4. Click a highlighted feature to see its OSM tags, with a link to it on
   openstreetmap.org. Only clicks on a feature are taken over: Google's own
   place panel doesn't open, and drags that start on a feature still pan the
   map. Use ‹ › to step through overlapping features. Close the card with
   Esc, ✕, or by clicking elsewhere.
5. In Street View, results are drawn on the mini-map, both the small one and
   the half-screen expanded one. Running a query there uses the mini-map's area.

## Permissions and privacy

- **Permissions:** only `storage`, plus access to Google Maps pages through
  the content-script matches. There are no host permissions: Overpass servers
  allow cross-origin requests (CORS). If a server is down or rate-limiting,
  its error has no CORS headers, so you get a generic "couldn't reach the
  server" message.
- **What leaves the browser:** the query, the queried area (where you're
  looking) and your IP address go to the configured Overpass endpoint, which
  must be https. Nothing goes anywhere else.
- **What Google's page can see:** the overlays and the details card live in
  closed shadow roots, so page scripts can't read the drawn results or tag
  values. The page can still tell the extension is present: from the
  `<overpass-layer>`/`<overpass-card>` elements, the camera events, and the
  wrapped `Worker.postMessage`.
- **Inputs are untrusted:** camera events from the page are range-checked;
  OSM tag values are only ever inserted as text; only the popup's own page
  can start a query; results over 8 MB are refused rather than stored.

## Develop

```sh
npm install
npm run dev            # Chrome with live reload
npm run dev:firefox    # Firefox
npm run build          # .output/chrome-mv3
npm run build:firefox  # .output/firefox-mv2
npm test               # unit tests (projection, URL parsing, OSM → GeoJSON)
npm run compile        # type-check
```

To load a build by hand:
- **Chrome:** go to `chrome://extensions`, turn on Developer mode, click
  "Load unpacked" and pick `.output/chrome-mv3`.
- **Firefox:** go to `about:debugging` → This Firefox → "Load Temporary
  Add-on" and pick `.output/firefox-mv2/manifest.json`.

Reload any Google Maps tabs that were already open after installing.

## How the overlay lines up

Google Maps web has no API that extensions can use, so the overlay finds the
camera itself:

- **Projection:** Google Maps uses Web Mercator with a world 256·2^zoom px
  wide, so the centre, the zoom and the map canvas size give the exact pixel
  for any lat/long (`lib/mercator.ts`).
- **Camera, per frame:** Google draws the map in a worker thread
  (`OffscreenCanvas`), and on every frame the main thread posts the camera to
  that worker as a protobuf (`{command: 9, methodType: 8, payload}`).
  `lib/camera-hook.ts` runs in the page, wraps `Worker.postMessage`
  without changing anything, decodes lat/lng/zoom (`lib/camera-proto.ts`) and
  re-sends them as a DOM event. Chrome loads it as a MAIN-world content script;
  Firefox (MV2 has no MAIN world) injects it as a web-accessible `<script>`. The overlay redraws in that same frame, so it
  follows drags, momentum, zoom easing, buttons and fly-tos exactly.
- **Fallback:** until the first camera message arrives, or if Google changes
  that message format, the camera is read from the URL (`@lat,lng,zoomz`). In
  that case the overlay only updates once the map stops moving.
- **Placement:** the overlay canvas sits after Google's map canvases in the
  same container, so it is above the map but below Google's panels and buttons.
- **Street View mini-map:** this is a separate map made of `<img>` tiles
  rather than WebGL. Each tile URL encodes its tile x/y/zoom
  (`!1i15!2i32743!3i21794!4i128`), so one tile's on-screen rectangle gives the
  exact projection. It's re-read every frame while the mini-map is visible
  (`lib/minimap.ts`).
- **Clicks:** presses always go through to Google. On release, a short click
  that hits a feature has its `pointerup`/`mouseup`/`click` withheld from
  Google, because Google opens its place panel on `mouseup`.

Known limits:
- The camera message format is undocumented. Field paths were found by
  inspection, and fields 5/6 are assumed to be heading/tilt.
- 3D, tilted and rotated views hide the overlay. In Street View it's shown on the mini-map only.
- Features that cross the antimeridian, or repeat when the world wraps at low
  zoom, aren't handled.
