import { describe, expect, it } from 'vitest';
import { extractInk } from 'libopenlaser/cam/raster/ink';
import { graySource, makeSource } from './helpers';

const W = 400;
const H = 300;

/** Paper lit from the left: 240 on the left edge falling to 140 on the right, like a phone shadow. */
const paper = (x: number) => 240 - (100 * x) / W;

/** Ink is a third of the paper's brightness wherever it falls. */
function sketch(ink: (x: number, y: number) => boolean, speck?: (x: number, y: number) => boolean) {
  return graySource(W, H, (x, y) => {
    if (ink(x, y)) return paper(x) / 3;
    if (speck?.(x, y)) return paper(x) / 3;
    return paper(x);
  });
}

const alphaAt = (crop: NonNullable<ReturnType<typeof extractInk>>, x: number, y: number) =>
  crop.data[((y - crop.y) * crop.width + (x - crop.x)) * 4 + 3];

describe('extractInk', () => {
  // A horizontal stroke across the whole shading gradient.
  const stroke = (x: number, y: number) => y >= 145 && y < 155 && x >= 40 && x < 360;

  it('keeps ink in bright and shadowed areas alike and drops the shadow', () => {
    const crop = extractInk(sketch(stroke))!;
    expect(crop).not.toBeNull();
    expect(alphaAt(crop, 50, 150)).toBe(255);
    expect(alphaAt(crop, 350, 150)).toBe(255);
    // The shadowed paper on the right is still paper.
    expect(alphaAt(crop, 350, crop.y)).toBe(0);
    expect(alphaAt(crop, 200, 158)).toBe(0);
  });

  it('outputs black ink with coverage in alpha only', () => {
    const crop = extractInk(sketch(stroke))!;
    for (let p = 0; p < crop.data.length; p += 4) {
      expect(crop.data[p] | crop.data[p + 1] | crop.data[p + 2]).toBe(0);
    }
  });

  it('crops to the drawing with a small margin', () => {
    const crop = extractInk(sketch(stroke))!;
    const pad = Math.round(W * 0.01);
    expect(crop.x).toBe(40 - pad);
    expect(crop.y).toBe(145 - pad);
    expect(crop.width).toBe(320 + 2 * pad);
    expect(crop.height).toBe(10 + 2 * pad);
  });

  it('drops dust specks', () => {
    const speck = (x: number, y: number) => x >= 20 && x < 22 && y >= 20 && y < 22;
    const crop = extractInk(sketch(stroke, speck))!;
    // The crop does not reach up to the speck.
    expect(crop.y).toBeGreaterThan(30);
  });

  it('returns null for a blank page, however unevenly lit', () => {
    expect(extractInk(sketch(() => false))).toBeNull();
  });

  it('treats transparent pixels as paper', () => {
    const source = makeSource(W, H, (x, y) => (stroke(x, y) ? [20, 20, 20, 255] : [0, 0, 0, 0]));
    const crop = extractInk(source)!;
    expect(alphaAt(crop, 200, 150)).toBe(255);
    expect(alphaAt(crop, 200, crop.y)).toBe(0);
  });
});
