import { expect, it } from 'vitest';
import { createProject, defaultLayer, type SceneObject, type VectorObject } from 'libopenlaser/project';
import { arrangeObjects, type ArrangeSettings } from '$app/lib/arrange';
const rectangle = (id: string, w = 10, h = 10): VectorObject => ({
  id,
  name: id,
  kind: 'vector',
  layerId: 'l',
  visible: true,
  locked: false,
  transform: [1, 0, 0, 1, 30, 30],
  paths: [
    {
      start: { x: 0, y: 0 },
      closed: true,
      segments: [
        { type: 'L', to: { x: w, y: 0 } },
        { type: 'L', to: { x: w, y: h } },
        { type: 'L', to: { x: 0, y: h } },
      ],
    },
  ],
});
const project = (objects: SceneObject[]) => ({
  ...createProject(),
  layers: [defaultLayer({ id: 'l', mode: 'line' })],
  objects,
});
const settings: ArrangeSettings = {
  mode: 'contour',
  width: 100,
  height: 100,
  gap: 2,
  margin: 2,
  rotate: true,
  increment: 90,
  grain: 'unrestricted',
  angles: [0],
  preserveGroups: true,
  respectLocked: true,
  holeNesting: false,
  rows: 0,
  columns: 0,
  radius: 20,
  startAngle: 0,
  sweep: 360,
  rotateAlongCircle: false,
};
it.each(['horizontal', 'vertical', 'grid', 'contour', 'automatic'] as const)(
  '%s proposes bounded nonoverlapping placement without mutation',
  (mode) => {
    const p = project([rectangle('a'), rectangle('b'), rectangle('c')]);
    const before = JSON.stringify(p);
    const r = arrangeObjects(p, ['a', 'b', 'c'], { ...settings, mode });
    expect(r.placed).toHaveLength(3);
    expect(r.unplaced).toEqual([]);
    expect(r.transforms).toHaveLength(3);
    expect(JSON.stringify(p)).toBe(before);
    expect(r.utilization).toBeCloseTo(3);
    expect(r.remainingArea).toBeCloseTo(9700);
  },
);
it('reports overflow instead of placing outside material', () => {
  const r = arrangeObjects(project([rectangle('a', 200, 200)]), ['a'], settings);
  expect(r.transforms).toEqual([]);
  expect(r.unplaced).toEqual(['a']);
});
it('locked geometry stays stationary and blocks placement', () => {
  const locked = {
    ...rectangle('locked'),
    locked: true,
    transform: [1, 0, 0, 1, 2, 2] as VectorObject['transform'],
  };
  const r = arrangeObjects(project([locked, rectangle('a')]), ['locked', 'a'], settings);
  expect(r.transforms.map(([id]) => id)).toEqual(['a']);
  expect(r.placed).toHaveLength(2);
  const matrix = r.transforms[0][1];
  expect(matrix[4] > 14 || matrix[5] > 14).toBe(true);
});
it('moves complete nested groups as rigid units', () => {
  const a = rectangle('a'),
    b = { ...rectangle('b'), transform: [1, 0, 0, 1, 50, 30] as VectorObject['transform'] };
  const p = { ...project([a, b]), groups: [{ id: 'g', name: 'Design', children: ['a', 'b'] }] };
  const r = arrangeObjects(p, ['a', 'b'], settings);
  expect(r.placed).toEqual(['g']);
  const matrices = new Map(r.transforms);
  expect(matrices.get('b')![4] - matrices.get('a')![4]).toBeCloseTo(20);
});
it('rotation restrictions and material margins are enforced', () => {
  const p = project([rectangle('a', 20, 8)]);
  expect(arrangeObjects(p, ['a'], { ...settings, width: 14, height: 30, rotate: false }).unplaced).toEqual([
    'a',
  ]);
  expect(arrangeObjects(p, ['a'], { ...settings, width: 14, height: 30, grain: 'vertical' }).placed).toEqual([
    'a',
  ]);
});
it('rejects invalid settings and unsafe cutout nesting', () => {
  expect(() => arrangeObjects(project([rectangle('a')]), ['a'], { ...settings, gap: -1 })).toThrow();
  const p = project([rectangle('a')]);
  p.layers[0].mode = 'fill';
  expect(() => arrangeObjects(p, ['a'], { ...settings, holeNesting: true })).toThrow(/line layer/);
});
it('produces repeatable results', () => {
  const p = project([rectangle('a', 12, 20), rectangle('b', 10, 5)]);
  expect(arrangeObjects(p, ['a', 'b'], settings)).toEqual(arrangeObjects(p, ['a', 'b'], settings));
});

it('nests inside verified cutout regions only when manufacturing constraints permit it', () => {
  const outer = rectangle('outer', 50, 50);
  const hole = {
    ...rectangle('hole', 30, 30).paths[0],
    start: { x: 10, y: 10 },
    segments: [
      { type: 'L' as const, to: { x: 40, y: 10 } },
      { type: 'L' as const, to: { x: 40, y: 40 } },
      { type: 'L' as const, to: { x: 10, y: 40 } },
    ],
  };
  outer.paths.push(hole);
  const p = project([outer, rectangle('small', 10, 10)]);
  const r = arrangeObjects(p, ['outer', 'small'], { ...settings, width: 54, height: 54, holeNesting: true });
  expect(r.placed).toHaveLength(2);
  expect(r.unplaced).toEqual([]);
  expect(
    arrangeObjects(p, ['outer', 'small'], { ...settings, width: 54, height: 54, holeNesting: false })
      .unplaced,
  ).toContain('small');
});
it('open geometry uses a conservative footprint with an explicit warning', () => {
  const open = rectangle('open');
  open.paths[0].closed = false;
  const r = arrangeObjects(project([open]), ['open'], settings);
  expect(r.placed).toEqual(['open']);
  expect(r.warnings.join(' ')).toMatch(/conservative/);
});
