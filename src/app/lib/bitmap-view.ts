/**
 * How Bitmap mode draws the original: the image over a checkerboard of two colors where it is
 * transparent, with the color selection tinted, shown on its own, or cut out of the rest. The
 * colors are the viewer's choice (Preferences → `bitmapView`), so a white logo can be checked on a
 * dark backdrop and a magenta photo can get a highlight that stands out from it.
 */
import type { RasterSource } from 'libopenlaser/cam';
import type { BitmapViewColors } from '$lib/storage/preferences';

export type OriginalShow = 'highlight' | 'selection' | 'rest';

type Rgb3 = [number, number, number];

/** How strongly a fully selected pixel takes the highlight color. */
export const HIGHLIGHT_STRENGTH = 0.6;

export interface BackdropPreset {
  name: string;
  colors: [string, string];
}

/** One-click backdrops. The first is the default; equal colors make a solid fill. */
export const BACKDROP_PRESETS: readonly BackdropPreset[] = [
  { name: 'Light checker', colors: ['#f5f5f5', '#cccccc'] },
  { name: 'Dark checker', colors: ['#474747', '#2e2e2e'] },
  { name: 'White', colors: ['#ffffff', '#ffffff'] },
  { name: 'Black', colors: ['#000000', '#000000'] },
  { name: 'Wood', colors: ['#ead2ab', '#d8b98b'] },
  { name: 'Blue checker', colors: ['#dce7ff', '#b4c8f0'] },
];

export const HIGHLIGHT_PRESETS: readonly { name: string; color: string }[] = [
  { name: 'Magenta', color: '#ff00aa' },
  { name: 'Cyan', color: '#00c8ff' },
  { name: 'Lime', color: '#66ff00' },
  { name: 'Orange', color: '#ff7a00' },
  { name: 'Red', color: '#ff1f1f' },
  { name: 'Blue', color: '#2050ff' },
];

/** `#rrggbb` → [r, g, b]; anything else is black. */
export function hexRgb(hex: string): Rgb3 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function sameColor(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function sameBackdrop(a: readonly [string, string], b: readonly [string, string]): boolean {
  return sameColor(a[0], b[0]) && sameColor(a[1], b[1]);
}

/** CSS background drawing a backdrop as a checkerboard of `cell` px squares (solid if equal). */
export function checkerCss([a, b]: readonly [string, string], cell = 6): string {
  return sameColor(a, b)
    ? a
    : `repeating-conic-gradient(${a} 0 25%, ${b} 0 50%) 0 0 / ${cell * 2}px ${cell * 2}px`;
}

/** Checker square size for an image: about 40 across the shorter side, at least 4 px. */
export function checkerCell(width: number, height: number): number {
  return Math.max(4, Math.round(Math.min(width, height) / 40));
}

/**
 * RGBA pixels of the original as shown: `weights` (0..255 per pixel) is the selection, `show`
 * what of it to draw. Fully opaque, since the backdrop fills whatever the image leaves.
 */
export function composeOriginal(
  source: RasterSource,
  weights: Uint8ClampedArray,
  show: OriginalShow,
  colors: BitmapViewColors,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, data } = source;
  const out = new Uint8ClampedArray(width * height * 4);
  const boxes = [hexRgb(colors.backdrop[0]), hexRgb(colors.backdrop[1])];
  const mark = hexRgb(colors.highlight);
  const cell = checkerCell(width, height);
  for (let y = 0, i = 0; y < height; y++) {
    const row = Math.floor(y / cell);
    for (let x = 0; x < width; x++, i++) {
      const p = i * 4;
      const box = boxes[(Math.floor(x / cell) + row) & 1];
      const weight = weights[i] / 255;
      let a = data[p + 3] / 255;
      if (show === 'selection') a *= weight;
      else if (show === 'rest') a *= 1 - weight;
      let r = data[p] * a + box[0] * (1 - a);
      let g = data[p + 1] * a + box[1] * (1 - a);
      let b = data[p + 2] * a + box[2] * (1 - a);
      if (show === 'highlight' && weight > 0) {
        const m = HIGHLIGHT_STRENGTH * weight;
        r = r * (1 - m) + mark[0] * m;
        g = g * (1 - m) + mark[1] * m;
        b = b * (1 - m) + mark[2] * m;
      }
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
    }
  }
  return out;
}
