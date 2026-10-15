# Store screenshots

Six 1280×800 screenshots, three per browser, of three London scenes:

- `1-search`: parks around Hyde Park, with the popup open
- `2-feature`: cafés in Soho, with a feature's card open
- `3-streetview`: street trees on the Street View mini-map

They drive live Google Maps and run real Overpass queries, so they're run by
hand, not in CI. Expect Google's UI to drift; check each image before using it.

## Setup

The scripts need two packages the extension doesn't, so install them without
adding them to `package.json`:

```sh
npm i --no-save playwright puppeteer-core
npx playwright install chromium   # or set CHROME_PATH to Chrome for Testing
```

Firefox is your installed one (`FIREFOX_PATH`, default `/Applications/Firefox.app`).
`compose.py` needs Pillow (`pip install pillow`).

## Run

```sh
npm run zip && npm run zip:firefox        # fresh builds in .output/
node scripts/store-screenshots/chrome.mjs # runs the queries; logs the card's click spot
node scripts/store-screenshots/chrome-streetview.mjs
node scripts/store-screenshots/firefox.mjs search
CLICK=551,395 node scripts/store-screenshots/firefox.mjs card
node scripts/store-screenshots/firefox.mjs streetview false
python3 scripts/store-screenshots/compose.py
```

Results are in `.output/store-screenshots/`, with intermediate files in `raw/`.

- **Firefox replays Chrome's results.** `chrome.mjs` saves each scene's
  storage, and `firefox.mjs` seeds a copy of the Firefox build with it, so both
  browsers show the same data and view.
- **The Firefox popup is captured by the extension itself.** WebDriver BiDi
  can't see extension pages, so the seeded build opens the popup in a small
  window, captures it with `tabs.captureTab` (granted only in that copy) and
  hands the image to the map page.
- **Street View runs in a visible window.** Headless browsers render the
  panorama black.
- **Some of Google's UI is hidden.** A promo tooltip, the "Heavy traffic" area
  card and a "Minimise" tooltip have no close button, so the scripts hide them
  before each capture.
