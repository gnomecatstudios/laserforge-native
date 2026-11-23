import { expect, it } from 'vitest';
import { applyTextModifiers } from '../../../packages/libopenlaser/src/fonts/modifiers';
import { pathsBounds } from 'libopenlaser/geometry';
import type { PathData } from 'libopenlaser/geometry';
import type { TextModifier, WarpPreset } from 'libopenlaser/project';
const paths: PathData[] = [
  {
    start: { x: 0, y: 0 },
    closed: true,
    segments: [
      { type: 'L', to: { x: 20, y: 0 } },
      { type: 'L', to: { x: 20, y: 10 } },
      { type: 'L', to: { x: 0, y: 10 } },
    ],
  },
];
const warp = (preset: WarpPreset, intensity = 0.4): TextModifier => ({
  id: preset,
  type: 'warp',
  enabled: true,
  parameters: { preset, intensity },
});
it.each(['arch', 'inverted-arch', 'wave', 'bulge', 'squeeze', 'perspective', 'slant'] as const)(
  'deforms real contours for %s without changing the source',
  (preset) => {
    const before = JSON.stringify(paths);
    const result = applyTextModifiers(paths, [warp(preset)]);
    expect(JSON.stringify(paths)).toBe(before);
    expect(result).not.toEqual(paths);
    expect(result[0].closed).toBe(true);
    expect(result[0].segments.length).toBeGreaterThan(100);
    expect(Object.values(pathsBounds(result)!)).toEqual(expect.arrayContaining([expect.any(Number)]));
  },
);
it('zero curvature and disabled modifiers return straight original geometry', () => {
  const curve: TextModifier = { id: 'curve', type: 'curve', enabled: true, parameters: { intensity: 0 } };
  expect(applyTextModifiers(paths, [curve])).toBe(paths);
  expect(applyTextModifiers(paths, [{ ...warp('wave'), enabled: false }])).toBe(paths);
});
it('stack order changes evaluated geometry while keeping source editable', () => {
  const a = warp('wave'),
    b = warp('slant');
  expect(applyTextModifiers(paths, [a, b])).not.toEqual(applyTextModifiers(paths, [b, a]));
});
it('retains disconnected contours and holes through warps', () => {
  const compound = [
    ...paths,
    {
      ...paths[0],
      start: { x: 5, y: 3 },
      segments: [
        { type: 'L' as const, to: { x: 8, y: 3 } },
        { type: 'L' as const, to: { x: 8, y: 6 } },
        { type: 'L' as const, to: { x: 5, y: 6 } },
      ],
    },
  ];
  const result = applyTextModifiers(compound, [warp('wave')]);
  expect(result).toHaveLength(2);
  expect(result.every((p) => p.closed)).toBe(true);
});
it('rejects invalid deformation parameters', () => {
  expect(() => applyTextModifiers(paths, [warp('wave', NaN)])).toThrow(/intensity/);
});
