import { describe, expect, it } from 'vitest';
import { apply } from 'libopenlaser/geometry';
import { createProject, defaultLayer } from 'libopenlaser/project';
import type { ImageObject, Project } from 'libopenlaser/project';
import { placeInk } from '$app/lib/ink-place';
import type { InkResult } from '$lib/workers/protocol';

const blob = new Blob([]);

function setup(): Project {
  let n = 0;
  const base = createProject({ name: 'Test', id: () => `p${n++}` });
  const image: ImageObject = {
    id: 'img',
    kind: 'image',
    layerId: 'L1',
    name: 'sketch.jpg',
    locked: false,
    visible: true,
    // 100 × 50 px shown at 50 × 25 mm, placed at (10, 20).
    transform: [1, 0, 0, 1, 10, 20],
    assetId: 'a0',
    width: 50,
    height: 25,
  };
  return {
    ...base,
    layers: [defaultLayer({ id: 'L1', mode: 'image', name: 'Photo' })],
    objects: [image],
    assets: {
      a0: { id: 'a0', mime: 'image/jpeg', name: 'sketch.jpg', data: blob, widthPx: 100, heightPx: 50 },
    },
  };
}

const ink = (x: number, y: number, width: number, height: number): InkResult => ({
  sourceWidth: 100,
  sourceHeight: 50,
  ink: { x, y, width, height, blob },
});

describe('placeInk', () => {
  it('swaps the photo for the ink, cropped and left exactly where the drawing was', () => {
    // Ink fills columns 20–59 and rows 10–29 of the photo.
    const next = placeInk(setup(), 'img', ink(20, 10, 40, 20), () => 'inkAsset');
    const object = next.objects[0] as ImageObject;
    expect(object.id).toBe('img');
    expect(object.layerId).toBe('L1');
    expect(object.assetId).toBe('inkAsset');
    expect(object.width).toBe(20);
    expect(object.height).toBe(10);
    // Object space is Y-up with row 0 at the top: the crop's bottom-left is column 20, row 30.
    expect(apply(object.transform, { x: 0, y: 0 })).toEqual({ x: 20, y: 30 });
    expect(next.assets.inkAsset).toMatchObject({ mime: 'image/png', name: 'sketch ink.png', widthPx: 40 });
    // The photo's asset is no longer used, so it goes; undo restores it.
    expect(next.assets.a0).toBeUndefined();
  });

  it('refuses when no ink was found', () => {
    expect(() =>
      placeInk(setup(), 'img', { sourceWidth: 100, sourceHeight: 50, ink: null }, () => 'x'),
    ).toThrow(/No ink/);
  });
});
