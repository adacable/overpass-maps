# Overpass Maps

Browser extension (Chrome + Firefox) that draws the results of an
[Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) query on top
of Google Maps. The map keeps working as normal: only clicks on a drawn
feature are taken over, to show its details.

## Use

1. Open Google Maps.
2. Click the extension icon, write a query, then click **Run query** (or press
   Ctrl/⌘+Enter). The line under the editor shows what the placeholders will
   be for the current map:
   - `{{bbox}}` is the map view. If that's smaller than the minimum in
     **Settings** (“Search at least … km across”), it is grown around the
     centre first, so a zoomed-in query doesn't come back almost empty.
   - `{{center}}` is the `lat,lng` of the map centre.
   - Output is forced to JSON. Use `out geom;` for full shapes, or
     `out center;` for just points.
3. While a query runs, the popup shows the server and the time taken, and the
   toolbar badge shows “…”; when it's done, the badge shows the feature count.
   If a server is busy or down, it's retried for about a minute, and the popup
   offers the next server in one click.
4. Results stay on the map, in every Google Maps tab, until you click
   **Clear**. **Hide** / **Show** toggles them, **Zoom to** moves the map to fit
   them (this reloads the page), and the colour swatch sets their colour.
5. Hovering over a feature outlines it. Click it to see its OSM tags, with a
   link to it on openstreetmap.org; it stays outlined while its card is open.
   Google's own place panel doesn't open, and drags that start on a feature
   still pan the map. Use ‹ › to step through overlapping features. Close the
   card with Esc, ✕, or by clicking elsewhere.
6. In Street View, results are drawn on the mini-map, both the small one and
   the half-screen expanded one. Running a query there uses the mini-map's area.

## Permissions and privacy

- **Permissions:** `storage`; access to Google Maps pages through the
  content-script matches; and the three built-in Overpass servers. Those
  servers allow cross-origin requests (CORS), but their busy and rate-limit
  replies don't, so the permission is what lets the extension read and show
  why a query failed. A custom server's error replies without CORS headers
  only show as "couldn't reach".
- **Busy servers:** when a server is busy, rate-limiting or unreachable, the
  query is retried on the same server after 4, 8, 16 and 32 s (or the
  server's `Retry-After`), as Overpass asks. The popup shows the server's
  reason and a countdown, with Cancel and a button to switch servers.
- **What leaves the browser:** the query, the queried area (where you're
  looking) and your IP address go to the configured Overpass endpoint, which
  must be https. Nothing goes anywhere else. See [PRIVACY.md](PRIVACY.md).
- **What Google's page can see:** the overlays and the details card live in
  closed shadow roots, so page scripts can't read the drawn results or tag
  values. The page can still tell the extension is present: from the
  `<overpass-layer>`/`<overpass-card>` elements, the camera events, and the
  wrapped `Worker.postMessage`.
- **Inputs are untrusted:** camera events from the page are range-checked;
  OSM tag values are only ever inserted as text; only the popup's own page
  can start a query; results over 8 MB are refused rather than stored.

## Build from source

This is how the store packages are made, and how to reproduce them.

Requirements: Node.js 22 or newer (built with 25.9) and npm 10 or newer, on
macOS, Linux or Windows.

```sh
npm ci                 # install the exact dependency versions in package-lock.json
npm run zip            # Chrome: .output/overpass-maps-<version>-chrome.zip
npm run zip:firefox    # Firefox: .output/overpass-maps-<version>-firefox.zip
                       #   and .output/overpass-maps-<version>-sources.zip
```

The unpacked builds end up in `.output/chrome-mv3` and `.output/firefox-mv2`.
The JavaScript is bundled and minified by [WXT](https://wxt.dev) (Vite) from
the TypeScript in `entrypoints/` and `lib/`; nothing is fetched or generated
at build time beyond the npm packages.

## Develop

```sh
npm install
npm run dev            # Chrome with live reload
npm run dev:firefox    # Firefox
npm run build          # .output/chrome-mv3
npm run build:firefox  # .output/firefox-mv2
npm test               # unit tests (projection, URL parsing, OSM → GeoJSON)
npm run compile        # type-check
npm run check          # all of the above plus both builds and Firefox's linter (what CI runs)
```

To load a build by hand:
- **Chrome:** go to `chrome://extensions`, turn on Developer mode, click
  "Load unpacked" and pick `.output/chrome-mv3`.
- **Firefox:** go to `about:debugging` → This Firefox → "Load Temporary
  Add-on" and pick `.output/firefox-mv2/manifest.json`.

Reload any Google Maps tabs that were already open after installing.

## Release

Releases are submitted from a maintainer's machine; CI only runs `npm run check`.
The store credentials are kept in `.env.submit.age`, encrypted to a YubiKey with
[age-plugin-fido2-hmac](https://github.com/olastor/age-plugin-fido2-hmac), and are
only ever decrypted into the submit process's memory.

```sh
scripts/secrets.sh init        # once: encrypt an empty credentials template
scripts/secrets.sh edit        # fill in or change the credentials
scripts/release.sh --dry-run   # check the credentials against both stores
scripts/release.sh             # submit package.json's version for review, then tag it
```

To release, bump the version (`npm version patch --no-git-tag-version`), commit,
sign and push, then run `scripts/release.sh`. It refuses to run unless what's
checked out is what's pushed. Both stores review each version before it goes
live.

The store screenshots and icon PNGs are made by scripts in `scripts/`: see
`scripts/store-screenshots/README.md` and `scripts/render-icons.mjs`.

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

## Licence

[GNU General Public License v3.0](LICENSE). Map data
© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
available under the Open Database Licence.
