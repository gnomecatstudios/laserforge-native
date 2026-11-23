import { expect, it } from 'vitest';
import { IDENTITY, flattenPaths, polylineLength } from 'libopenlaser/geometry';
import type { VectorObject } from 'libopenlaser/project';
import { unitePaths } from '../../../src/app/unite';
function square(x: number): VectorObject {
  return {
    id: String(x),
    kind: 'vector',
    layerId: 'layer',
    name: 'Square',
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, x, 0],
    paths: [
      {
        closed: true,
        start: { x: 0, y: 0 },
        segments: [
          { type: 'L', to: { x: 10, y: 0 } },
          { type: 'L', to: { x: 10, y: 10 } },
          { type: 'L', to: { x: 0, y: 10 } },
        ],
      },
    ],
  };
}
it('unites overlapping shapes in bed space and removes interior edges', () => {
  const result = unitePaths([square(0), square(5)]);
  expect(result).toHaveLength(1);
  expect(polylineLength(flattenPaths(result, IDENTITY)[0])).toBeCloseTo(50);
});
it('keeps disjoint shapes as separate closed subpaths', () => {
  const result = unitePaths([square(0), square(20)]);
  expect(result).toHaveLength(2);
  expect(result.every((p) => p.closed)).toBe(true);
});
