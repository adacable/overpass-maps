/**
 * A host element with a closed shadow root, for UI we put into Google's page:
 * page scripts can't reach into a closed root (to read back the overlay's
 * pixels, say, or the card's text), and Google's styles can't leak in.
 *
 * The host is a custom tag, not a <div>: Google's map container treats child
 * divs as its own and spins re-laying them out, freezing the page.
 */
export function shadowHost(tag: `overpass-${string}`): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement(tag);
  return { host, root: host.attachShadow({ mode: 'closed' }) };
}

/** The element covering the largest area on screen, if any covers more than `minArea` px². */
export function largest<T extends Element>(elements: Iterable<T>, minArea = 0): T | null {
  let best: T | null = null;
  for (const el of elements) {
    const { width, height } = el.getBoundingClientRect();
    if (width * height > minArea) {
      best = el;
      minArea = width * height;
    }
  }
  return best;
}
