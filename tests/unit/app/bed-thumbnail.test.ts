import { describe, expect, it } from 'vitest';
import { createProject, defaultLayer } from 'libopenlaser/project';
import type { ImageObject, Project, SceneObject } from 'libopenlaser/project';
import { bedThumbnail, shapeBox, svgPoints } from '$app/lib/bed-thumbnail';
import type { BedFrame } from '$app/canvas/viewport';

const image = (
  id: string,
  transform: ImageObject['transform'],
  extra: Partial<ImageObject> = {},
): ImageObject => ({
  id,
  kind: 'image',
  layerId: 'L1',
  name: `${id}.png`,
  locked: false,
  visible: true,
  transform,
  assetId: 'a0',
  width: 40,
  height: 20,
  ...extra,
});

function project(objects: SceneObject[], hiddenLayer = false): Project {
  let n = 0;
  const base = createProject({ name: 'Test', id: () => `p${n++}` });
  return {
    ...base,
    layers: [
      defaultLayer({ id: 'L1', mode: 'image', name: 'Photo', color: '#aa00ff' }),
      { ...defaultLayer({ id: 'L2', mode: 'image', name: 'Hidden' }), visible: !hiddenLayer },
    ],
    objects,
  };
}

/** 400 × 200 mm into 200 × 100 px: half a px per mm. */
const BOX = { width: 200, height: 100 };
const bed = (originCorner: BedFrame['originCorner']): BedFrame => ({ width: 400, height: 200, originCorner });
const sorted = (points: { x: number; y: number }[]) =>
  points
    .map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

describe('bed thumbnail', () => {
  it('fits the bed in the box and draws y up from a bottom-left origin, as the canvas does', () => {
    const t = bedThumbnail(project([image('img', [1, 0, 0, 1, 0, 0])]), bed('bl'), BOX, 'img');
    expect([t.width, t.height]).toEqual([200, 100]);
    expect(t.origin).toEqual({ x: 0, y: 100 });
    // 40 × 20 mm at the origin: 20 × 10 px in the bottom-left corner.
    expect(sorted(t.current!.points)).toEqual([
      [0, 90],
      [0, 100],
      [20, 90],
      [20, 100],
    ]);
    expect(t.shapes).toEqual([]);
  });

  it('follows the machine origin corner', () => {
    const t = bedThumbnail(project([image('img', [1, 0, 0, 1, 0, 0])]), bed('tr'), BOX, 'img');
    expect(t.origin).toEqual({ x: 200, y: 0 });
    expect(sorted(t.current!.points)).toEqual([
      [180, 0],
      [180, 10],
      [200, 0],
      [200, 10],
    ]);
  });

  it('keeps a rotated image rotated, and lists the other visible objects with their layer color', () => {
    const c = Math.SQRT1_2;
    const t = bedThumbnail(
      project(
        [
          image('img', [c, c, -c, c, 200, 100]),
          image('other', [1, 0, 0, 1, 10, 10]),
          image('hidden', [1, 0, 0, 1, 50, 50], { visible: false }),
          image('on-hidden-layer', [1, 0, 0, 1, 80, 80], { layerId: 'L2' }),
        ],
        true,
      ),
      bed('bl'),
      BOX,
      'img',
    );
    // 45°: no two corners share an x.
    expect(new Set(t.current!.points.map((p) => p.x.toFixed(3))).size).toBe(4);
    expect(t.shapes.map((s) => s.id)).toEqual(['other']);
    expect(t.shapes[0]).toMatchObject({ color: '#aa00ff', image: true });
  });

  it('formats points and finds the box of a shape', () => {
    expect(
      svgPoints([
        { x: 1, y: 2.25 },
        { x: 3, y: 4 },
      ]),
    ).toBe('1.0,2.3 3.0,4.0');
    expect(
      shapeBox([
        { x: 0, y: 0 },
        { x: 4, y: 2 },
      ]),
    ).toEqual({ cx: 2, cy: 1, size: 4 });
  });
});
