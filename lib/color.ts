/** Black or white, whichever reads better on `hex` (#rrggbb). */
export function inkOn(hex: string): '#000' | '#fff' {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#fff';
  // WCAG relative luminance.
  const [r, g, b] = m.slice(1).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  // WCAG's ratio flips to black at 0.18, but white text on saturated
  // mid-tones (e.g. the default pink) reads better than that suggests;
  // 0.36 is closer to where perceptual measures like APCA cross over.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#000' : '#fff';
}
