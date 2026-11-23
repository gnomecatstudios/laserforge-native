import { describe, expect, it } from 'vitest';
import type { RasterSource } from 'libopenlaser/cam';
import {
  BACKDROP_PRESETS,
  HIGHLIGHT_STRENGTH,
  checkerCss,
  composeOriginal,
  hexRgb,
  sameBackdrop,
} from '$app/lib/bitmap-view';
import {
  DEFAULT_BITMAP_VIEW,
  defaultPreferences,
  normalizeBitmapView,
  normalizePreferences,
} from '$lib/storage/preferences';

/** 8 × 8, fully transparent except an opaque red pixel at (0, 0). */
function source(): RasterSource {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  data.set([255, 0, 0, 255], 0);
  return { width: 8, height: 8, data };
}

const px = (out: Uint8ClampedArray, x: number, y: number, width = 8) => [
  ...out.slice((y * width + x) * 4, (y * width + x) * 4 + 4),
];

describe('Bitmap view colors', () => {
  it('draws transparent areas as a checkerboard of the two backdrop colors', () => {
    const colors = { backdrop: ['#102030', '#a0b0c0'] as [string, string], highlight: '#ff00aa' };
    const out = composeOriginal(source(), new Uint8ClampedArray(64), 'highlight', colors);
    // Cells are 4 px on an 8 px image: (4, 0) and (0, 4) take the second color, (4, 4) the first.
    expect(px(out, 4, 0)).toEqual([160, 176, 192, 255]);
    expect(px(out, 0, 4)).toEqual([160, 176, 192, 255]);
    expect(px(out, 4, 4)).toEqual([16, 32, 48, 255]);
    // Opaque pixels are the image itself.
    expect(px(out, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it('keeps the original gray checkerboard by default', () => {
    const out = composeOriginal(source(), new Uint8ClampedArray(64), 'highlight', DEFAULT_BITMAP_VIEW);
    expect(px(out, 4, 4)).toEqual([245, 245, 245, 255]);
    expect(px(out, 4, 0)).toEqual([204, 204, 204, 255]);
  });

  it('tints the selection in the chosen highlight color', () => {
    const weights = new Uint8ClampedArray(64);
    weights[0] = 255;
    const out = composeOriginal(source(), weights, 'highlight', {
      ...DEFAULT_BITMAP_VIEW,
      highlight: '#00ff00',
    });
    const m = HIGHLIGHT_STRENGTH;
    expect(px(out, 0, 0)).toEqual([Math.round(255 * (1 - m)), Math.round(255 * m), 0, 255]);
  });

  it('shows the backdrop where Selection hides the unselected image', () => {
    const colors = { backdrop: ['#000000', '#000000'] as [string, string], highlight: '#ff00aa' };
    const out = composeOriginal(source(), new Uint8ClampedArray(64), 'selection', colors);
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it('parses hex and describes presets as CSS', () => {
    expect(hexRgb('#FF8000')).toEqual([255, 128, 0]);
    expect(hexRgb('nope')).toEqual([0, 0, 0]);
    expect(checkerCss(['#ffffff', '#ffffff'])).toBe('#ffffff');
    expect(checkerCss(['#ffffff', '#000000'], 4)).toContain('repeating-conic-gradient');
    expect(sameBackdrop(BACKDROP_PRESETS[0].colors, DEFAULT_BITMAP_VIEW.backdrop)).toBe(true);
  });

  it('stores valid colors and falls back to defaults for the rest', () => {
    expect(defaultPreferences().bitmapView).toEqual(DEFAULT_BITMAP_VIEW);
    // Preferences saved before the setting existed.
    expect(normalizePreferences({ theme: 'dark' }).bitmapView).toEqual(DEFAULT_BITMAP_VIEW);
    expect(normalizeBitmapView({ backdrop: ['#ABCDEF', 'red'], highlight: 42 })).toEqual({
      backdrop: ['#abcdef', DEFAULT_BITMAP_VIEW.backdrop[1]],
      highlight: DEFAULT_BITMAP_VIEW.highlight,
    });
  });
});
