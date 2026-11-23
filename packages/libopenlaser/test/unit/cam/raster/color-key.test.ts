import { describe, expect, it } from 'vitest';
import {
  colorAt,
  combineWeights,
  type ColorKey,
  type KeyMaskCache,
  keyWeights,
  downscaleRaster,
  edgeSelection,
  type Rgb,
  selectedShare,
  selectionWeights,
  separateRaster,
  spectrumKey,
} from 'libopenlaser/cam/raster/color-key';
import type { RasterSource } from 'libopenlaser/cam';

/** An image from rows of single-letter colors. */
const PALETTE: Record<string, [number, number, number, number]> = {
  G: [0, 200, 0, 255], // green screen
  g: [0, 150, 0, 255], // shadowed green screen
  R: [220, 30, 30, 255], // foreground subject
  B: [30, 30, 220, 255], // midground subject
  W: [255, 255, 255, 255],
  '.': [0, 0, 0, 0], // transparent
};

function image(rows: string[]): RasterSource {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => data.set(PALETTE[ch], (y * width + x) * 4)));
  return { width, height, data };
}

const selected = (weights: Uint8ClampedArray) => [...weights].map((w) => (w === 255 ? 1 : w === 0 ? 0 : 0.5));
const at = (source: RasterSource, x: number, y: number) =>
  source.data.slice((y * source.width + x) * 4, (y * source.width + x) * 4 + 4);

describe('selectionWeights', () => {
  const scene = image(['GGGG', 'GRRG', 'GBBg', 'GGGG']);

  it('selects pixels near a picked color and nothing else', () => {
    const weights = selectionWeights(scene, { keys: [{ stops: [[0, 200, 0]] }], tolerance: 5, softness: 0 });
    expect(selected(weights)).toEqual([1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1]);
  });

  it('widens with tolerance to catch shadowed shades', () => {
    const weights = selectionWeights(scene, { keys: [{ stops: [[0, 200, 0]] }], tolerance: 25, softness: 0 });
    expect(weights[11]).toBe(255);
    expect(weights[5]).toBe(0);
  });

  it('matches every color along a spectrum key', () => {
    const narrow = { tolerance: 2, softness: 0 };
    const single = selectionWeights(scene, { keys: [{ stops: [[0, 200, 0]] }], ...narrow });
    const range = selectionWeights(scene, {
      keys: [
        {
          stops: [
            [0, 220, 0],
            [0, 130, 0],
          ],
        },
      ],
      ...narrow,
    });
    expect(single[11]).toBe(0);
    expect(range[11]).toBe(255);
    expect(range[0]).toBe(255);
    expect(range[5]).toBe(0);
  });

  it('combines several keys', () => {
    const weights = selectionWeights(scene, {
      keys: [{ stops: [[220, 30, 30]] }, { stops: [[30, 30, 220]] }],
      tolerance: 5,
      softness: 0,
    });
    expect(selected(weights)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
  });

  it('gives a soft band partial weights', () => {
    const hard = selectionWeights(scene, { keys: [{ stops: [[0, 200, 0]] }], tolerance: 5, softness: 0 });
    const soft = selectionWeights(scene, { keys: [{ stops: [[0, 200, 0]] }], tolerance: 5, softness: 60 });
    expect(hard[11]).toBe(0);
    expect(soft[11]).toBeGreaterThan(0);
    expect(soft[11]).toBeLessThan(255);
  });

  it('keeps only areas connected to the seeds', () => {
    const split = image(['RGGR', 'RRRR', 'RGGR']);
    const keys = [{ stops: [[0, 200, 0]] as Rgb[] }];
    const all = selectionWeights(split, { keys, tolerance: 5, softness: 0 });
    const top = selectionWeights(split, {
      keys: [{ ...keys[0], seeds: [{ x: 0.4, y: 0.1 }] }],
      tolerance: 5,
      softness: 0,
      connected: true,
    });
    expect(selected(all).filter(Boolean)).toHaveLength(4);
    expect(selected(top)).toEqual([0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('inverts, but never selects transparent pixels', () => {
    const holey = image(['G.', 'RG']);
    const weights = selectionWeights(holey, {
      keys: [{ stops: [[0, 200, 0]] }],
      tolerance: 5,
      softness: 0,
      invert: true,
    });
    expect(selected(weights)).toEqual([0, 0, 1, 0]);
  });

  it('selects nothing without keys', () => {
    expect(selected(selectionWeights(scene, { keys: [], tolerance: 50, softness: 0 }))).not.toContain(1);
  });
});

describe('separateRaster', () => {
  it('moves the selection out and leaves the rest, both cropped', () => {
    const scene = image(['GGGG', 'GRRG', 'GBBG', 'GGGG']);
    const weights = selectionWeights(scene, {
      keys: [{ stops: [[30, 30, 220]] }],
      tolerance: 5,
      softness: 0,
    });
    const { pieces, rest } = separateRaster(scene, weights);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ x: 1, y: 2, width: 2, height: 1 });
    expect([...pieces[0].data.slice(0, 4)]).toEqual([30, 30, 220, 255]);
    expect(rest).toMatchObject({ x: 0, y: 0, width: 4, height: 4 });
    expect(at(rest!, 1, 2)[3]).toBe(0);
    expect(at(rest!, 1, 1)[3]).toBe(255);
  });

  it('shares partial alpha so the two parts stack back into the original', () => {
    const scene = image(['GgR']);
    const weights = selectionWeights(scene, { keys: [{ stops: [[0, 200, 0]] }], tolerance: 5, softness: 60 });
    const { pieces, rest } = separateRaster(scene, weights);
    const pieceAlpha = (x: number) => at(pieces[0], x - pieces[0].x, 0)[3];
    const restAlpha = (x: number) => (x >= rest!.x ? at(rest!, x - rest!.x, 0)[3] : 0);
    expect(pieceAlpha(1) + restAlpha(1)).toBe(255);
    expect(pieceAlpha(1)).toBeGreaterThan(0);
    expect(restAlpha(1)).toBeGreaterThan(0);
  });

  it('splits separate areas into their own pieces when asked', () => {
    const scene = image(['RWWWR', 'RWWWR', 'WWWWW']);
    const weights = selectionWeights(scene, {
      keys: [{ stops: [[220, 30, 30]] }],
      tolerance: 5,
      softness: 0,
    });
    expect(separateRaster(scene, weights).pieces).toHaveLength(1);
    const { pieces } = separateRaster(scene, weights, { regions: true });
    expect(pieces).toHaveLength(2);
    expect(pieces.map((p) => [p.x, p.width, p.height])).toEqual(
      expect.arrayContaining([
        [0, 1, 2],
        [4, 1, 2],
      ]),
    );
  });

  it('folds specks into the largest region', () => {
    const scene = image(['RRRWR', 'RRRWW', 'RRRWW']);
    const weights = selectionWeights(scene, {
      keys: [{ stops: [[220, 30, 30]] }],
      tolerance: 5,
      softness: 0,
    });
    const { pieces } = separateRaster(scene, weights, { regions: true, minRegionShare: 0.2 });
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ x: 0, width: 5 });
  });

  it('returns no rest when everything is selected', () => {
    const scene = image(['GG']);
    const weights = selectionWeights(scene, { keys: [{ stops: [[0, 200, 0]] }], tolerance: 5, softness: 0 });
    expect(separateRaster(scene, weights).rest).toBeNull();
  });
});

describe('helpers', () => {
  it('finds the background from the edges, connected to them only', () => {
    const scene = image(['GGGGG', 'GRRRG', 'GRGRG', 'GRRRG', 'GGGGG']);
    const keys = edgeSelection(scene);
    expect(keys).toHaveLength(1);
    const weights = selectionWeights(scene, { keys, tolerance: 5, softness: 0, connected: true });
    // The green inside the red ring is not connected to the edge, so it stays.
    expect(weights[12]).toBe(0);
    expect(weights[0]).toBe(255);
    expect(selectedShare(scene, weights)).toBeCloseTo(16 / 25);
  });

  it('thins a dragged spectrum and drops repeats', () => {
    const drag: Rgb[] = [];
    for (let i = 0; i < 200; i++) drag.push([0, 255 - i, 0], [0, 255 - i, 0]);
    const key = spectrumKey(drag, 8)!;
    expect(key.stops).toHaveLength(8);
    expect(key.stops[0]).toEqual([0, 255, 0]);
    expect(spectrumKey([])).toBeNull();
  });

  it('downscales with real image colors and reads colors at points', () => {
    const scene = image(['GGRR', 'GGRR', 'BBWW', 'BBWW']);
    const small = downscaleRaster(scene, 4);
    expect(small.width).toBe(2);
    expect(colorAt(small, { x: 0.9, y: 0.1 })).toEqual([220, 30, 30]);
    expect(colorAt(image(['.']), { x: 0, y: 0 })).toBeNull();
  });
});

describe('add and subtract keys', () => {
  // Green backdrop, a red subject and a blue one; the right column is a darker red.
  const scene = image(['GGGG', 'GRRG', 'GBBG', 'GGGG']);
  const green: ColorKey = { stops: [[0, 200, 0]] };
  const red: ColorKey = { stops: [[220, 30, 30]] };
  const tight = { tolerance: 5, softness: 0 };
  const sel = (keys: ColorKey[], extra = {}) =>
    selected(selectionWeights(scene, { keys, ...tight, ...extra }));

  it('selects the union of add keys', () => {
    expect(sel([green, red])).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1]);
  });

  it('selects nothing with only subtract keys', () => {
    expect(sel([{ ...red, mode: 'subtract' }])).not.toContain(1);
    expect(
      sel([
        { ...red, mode: 'subtract' },
        { ...green, mode: 'subtract' },
      ]),
    ).not.toContain(1);
  });

  it('takes subtract matches out of add matches where they overlap', () => {
    // A wide add key catches the red and the blue; subtracting red leaves the blue.
    const wide: ColorKey = {
      stops: [
        [220, 30, 30],
        [30, 30, 220],
      ],
    };
    expect(sel([wide])).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    expect(sel([wide, { ...red, mode: 'subtract' }])).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0,
    ]);
    // Order does not matter.
    expect(sel([{ ...red, mode: 'subtract' }, wide])).toEqual(sel([wide, { ...red, mode: 'subtract' }]));
  });

  it("keeps each key's own tolerance", () => {
    const shades = image(['GgR']);
    const subtractShadow: ColorKey = { stops: [[0, 150, 0]], mode: 'subtract', tolerance: 2 };
    const wideGreen: ColorKey = { ...green, tolerance: 40 };
    const weights = selectionWeights(shades, { keys: [wideGreen, subtractShadow], ...tight });
    expect(selected(weights)).toEqual([1, 0, 0]);
  });

  it('floods subtract keys from their own seeds when connected', () => {
    // Two red areas on green; subtracting red picked on the left one only removes that one.
    const split = image(['RGGR', 'RGGR']);
    const addAll: ColorKey = {
      stops: [
        [220, 30, 30],
        [0, 200, 0],
      ],
      seeds: [{ x: 0.5, y: 0.5 }],
    };
    const minusLeft: ColorKey = { ...red, mode: 'subtract', seeds: [{ x: 0.1, y: 0.5 }] };
    const connected = selectionWeights(split, { keys: [addAll, minusLeft], ...tight, connected: true });
    expect(selected(connected)).toEqual([0, 1, 1, 1, 0, 1, 1, 1]);
    const everywhere = selectionWeights(split, { keys: [addAll, minusLeft], ...tight });
    expect(selected(everywhere)).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
  });

  it('inverts after subtracting', () => {
    const weights = selectionWeights(scene, {
      keys: [green, { stops: [[0, 200, 0]], mode: 'subtract' }, red],
      ...tight,
      invert: true,
    });
    // green − green = nothing, so only red is selected; inverted, everything but red.
    expect(selected(weights)).toEqual([1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const onlySubtract = selectionWeights(scene, {
      keys: [{ ...red, mode: 'subtract' }],
      ...tight,
      invert: true,
    });
    expect(selected(onlySubtract)).not.toContain(0);
  });

  it('subtracts soft edges proportionally', () => {
    const add = new Uint8ClampedArray([255, 255, 200]);
    const minus = new Uint8ClampedArray([0, 255, 128]);
    const row = image(['GGG']);
    const out = combineWeights(row, [
      { mode: 'add', weights: add },
      { mode: 'subtract', weights: minus },
    ]);
    expect([...out]).toEqual([255, 0, 100]);
  });

  it('reuses cached masks for keys that did not change', () => {
    const cache: KeyMaskCache = new Map();
    selectionWeights(scene, { keys: [green, red], ...tight }, undefined, cache);
    expect(cache.size).toBe(2);
    const greenMask = [...cache.values()][0];
    // Switching a key to subtract reuses its mask; removing one drops it.
    selectionWeights(scene, { keys: [{ ...green, mode: 'subtract' }], ...tight }, undefined, cache);
    expect(cache.size).toBe(1);
    expect([...cache.values()][0]).toBe(greenMask);
    expect(greenMask).toEqual(keyWeights(scene, green, 5, 0));
  });
});
