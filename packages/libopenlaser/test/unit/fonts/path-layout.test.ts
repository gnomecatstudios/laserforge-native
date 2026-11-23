import { expect, it } from 'vitest';
import { baselineSampler, placeGlyphOnPath } from '../../../src/fonts/path-layout';
import { pathsBounds } from '../../../src/geometry';
import { serializeProject, deserializeProject, createProject } from '../../../src/project';
import type { TextPathLayout } from '../../../src/project';

const layout: TextPathLayout = {
  guideId: 'guide',
  path: { start: { x: 10, y: 20 }, closed: false, segments: [{ type: 'L', to: { x: 10, y: 120 } }] },
  offset: 0,
  normalOffset: 0,
  reverse: false,
};
it('samples by arc length and reverses direction', () => {
  const s = baselineSampler(layout);
  expect(s.length).toBeCloseTo(100);
  expect(s.at(25)).toEqual({ point: { x: 10, y: 45 }, tangent: { x: 0, y: 1 } });
  expect(baselineSampler({ ...layout, reverse: true }).at(25).point).toEqual({ x: 10, y: 95 });
});
it('rotates a glyph rigidly, preserving its cubic curves and closed contours', () => {
  const glyph = [
    {
      start: { x: 0, y: 0 },
      closed: true,
      segments: [{ type: 'C' as const, c1: { x: 5, y: 0 }, c2: { x: 5, y: 10 }, to: { x: 0, y: 0 } }],
    },
  ];
  const out = placeGlyphOnPath(glyph, 0, 0, 2, baselineSampler(layout));
  expect(out[0].start).toEqual({ x: 8, y: 20 });
  expect(out[0].segments[0]).toMatchObject({
    type: 'C',
    c1: { x: 8, y: 25 },
    c2: { x: -2, y: 25 },
    to: out[0].start,
  });
  expect(pathsBounds(out)).not.toBeNull();
  expect(glyph[0].start).toEqual({ x: 0, y: 0 });
});
it('wraps on closed baselines and handles degenerate guides without NaN', () => {
  const closed = { ...layout, path: { ...layout.path, closed: true } };
  const s = baselineSampler(closed);
  expect(s.at(225).point).toEqual(s.at(25).point);
  expect(baselineSampler({ ...layout, path: { ...layout.path, segments: [] } }).at(10).point).toEqual(
    layout.path.start,
  );
});
it('preserves the editable path snapshot through a project round trip', async () => {
  const p = createProject();
  p.objects = [
    {
      id: 't',
      kind: 'text',
      name: 'Hi',
      text: 'Hi',
      layerId: 'l',
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      fontFamily: 'Geist',
      fontSize: 10,
      fontWeight: 400,
      italic: false,
      align: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      paths: [],
      pathLayout: layout,
      arcAngle: 45,
    },
  ];
  const restored = await deserializeProject(await serializeProject(p));
  expect(restored.objects[0]).toMatchObject({ kind: 'text', pathLayout: layout, arcAngle: 45 });
});
