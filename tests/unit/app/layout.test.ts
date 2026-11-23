import { describe, expect, it } from 'vitest';
import { alignObjects, arrayCopies, distributeObjects } from '$app/lib/layout';
import { boundsOf } from '$app/lib/selection';
import type { VectorObject } from 'libopenlaser/project';

function box(id: string, x: number, y: number, width = 10): VectorObject {
  return {
    id,
    kind: 'vector',
    name: id,
    layerId: 'l',
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, x, y],
    paths: [
      {
        start: { x: 0, y: 0 },
        closed: true,
        segments: [
          { type: 'L', to: { x: width, y: 0 } },
          { type: 'L', to: { x: width, y: 10 } },
          { type: 'L', to: { x: 0, y: 10 } },
        ],
      },
    ],
  };
}

describe('layout', () => {
  it('aligns independently sized objects to the requested reference without changing originals', () => {
    const objects = [box('a', 5, 8), box('b', 30, 25, 20)];
    const original = structuredClone(objects);
    const transforms = alignObjects(objects, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 'center-x');
    for (const o of objects) {
      const b = boundsOf([{ ...o, transform: transforms.get(o.id)! }])!;
      expect((b.minX + b.maxX) / 2).toBeCloseTo(50);
    }
    expect(objects).toEqual(original);
  });
  it('distributes unequal sizes by centres or by edge gaps, keeping extremes fixed', () => {
    const objects = [box('a', 0, 0), box('b', 20, 0, 20), box('c', 90, 0)];
    expect(distributeObjects(objects, 'x', 'centers').get('b')![4]).toBeCloseTo(40);
    expect(distributeObjects(objects, 'x', 'gaps').get('b')![4]).toBeCloseTo(40);
    const different = [box('a', 0, 0, 20), box('b', 25, 0, 10), box('c', 90, 0, 30)];
    expect(distributeObjects(different, 'x', 'centers').get('b')![4]).toBeCloseTo(52.5);
    expect(distributeObjects(different, 'x', 'gaps').get('b')![4]).toBeCloseTo(50);
    expect([...distributeObjects(different, 'x', 'gaps').keys()]).toEqual(['b']);
  });
  it('uses selection bounds and gaps for grid copies, respecting flipped bed directions', () => {
    const source = [box('a', 10, 10)];
    const copies = arrayCopies(source, { kind: 'grid', rows: 2, columns: 3, gapX: 2, gapY: 3 });
    expect(copies).toHaveLength(5);
    expect(copies[0].transform.slice(4)).toEqual([22, 10]);
    expect(copies[4].transform.slice(4)).toEqual([34, -3]);
    const flipped = arrayCopies(source, {
      kind: 'grid',
      rows: 2,
      columns: 2,
      gapX: 2,
      gapY: 3,
      directionX: -1,
      directionY: 1,
    });
    expect(flipped[2].transform.slice(4)).toEqual([-2, 23]);
    expect(source[0].transform.slice(4)).toEqual([10, 10]);
  });
  it('avoids a duplicate at 360 degrees and includes both ends of a partial sweep', () => {
    const source = [box('a', 15, -5)];
    const full = arrayCopies(source, {
      kind: 'circle',
      count: 4,
      center: { x: 0, y: 0 },
      sweep: 360,
      rotate: false,
    });
    expect(full).toHaveLength(3);
    expect(boundsOf([full[0]])!.minX).toBeCloseTo(-5);
    expect(boundsOf([full[0]])!.minY).toBeCloseTo(15);
    const half = arrayCopies(source, {
      kind: 'circle',
      count: 3,
      center: { x: 0, y: 0 },
      sweep: -180,
      rotate: true,
    });
    expect(boundsOf([half[1]])!.minX).toBeCloseTo(-25);
    expect(half[0].transform[1]).toBeCloseTo(-1);
  });
  it('rejects excessive, fractional and locked arrays', () => {
    const source = [box('a', 0, 0)];
    expect(arrayCopies(source, { kind: 'grid', rows: 1000, columns: 2, gapX: 0, gapY: 0 })).toEqual([]);
    expect(arrayCopies(source, { kind: 'grid', rows: 1.5, columns: 2, gapX: 0, gapY: 0 })).toEqual([]);
    expect(
      arrayCopies([{ ...source[0], locked: true }], { kind: 'grid', rows: 2, columns: 2, gapX: 0, gapY: 0 }),
    ).toEqual([]);
  });
});
