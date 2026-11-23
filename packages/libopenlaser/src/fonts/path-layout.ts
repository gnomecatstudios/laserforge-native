/** Rigidly place each shaped glyph on an arc-length baseline; preserve its curves and holes. */
import { flattenPath } from '../geometry/path';
import type { PathData, Vec2 } from '../geometry/types';
import type { TextPathLayout } from '../project/types';

export function baselineSampler(layout: TextPathLayout): {
  length: number;
  at: (distance: number) => { point: Vec2; tangent: Vec2 };
} {
  const poly = flattenPath(layout.path, undefined, 0.01);
  const points = [...poly.points];
  if (poly.closed && points.length > 1) points.push(points[0]);
  if (layout.reverse) points.reverse();
  const segments: Array<{ a: Vec2; b: Vec2; start: number; length: number }> = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      span = Math.hypot(b.x - a.x, b.y - a.y);
    if (span <= 1e-9) continue;
    segments.push({ a, b, start: length, length: span });
    length += span;
  }
  return {
    length,
    at(distance) {
      if (!segments.length) return { point: points[0] ?? { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
      const d = poly.closed ? ((distance % length) + length) % length : distance;
      const s = segments.find((s) => d <= s.start + s.length) ?? segments[segments.length - 1];
      const tangent = { x: (s.b.x - s.a.x) / s.length, y: (s.b.y - s.a.y) / s.length };
      return {
        point: { x: s.a.x + tangent.x * (d - s.start), y: s.a.y + tangent.y * (d - s.start) },
        tangent,
      };
    },
  };
}

export function placeGlyphOnPath(
  paths: PathData[],
  baseline: number,
  shift: number,
  normal: number,
  sample: ReturnType<typeof baselineSampler>,
): PathData[] {
  const xs = paths.flatMap((p) => [p.start.x, ...p.segments.map((s) => s.to.x)]);
  if (!xs.length) return [];
  const anchor = (Math.min(...xs) + Math.max(...xs)) / 2;
  const { point, tangent: t } = sample.at(shift + anchor);
  const map = (p: Vec2): Vec2 => ({
    x: point.x + t.x * (p.x - anchor) - t.y * (p.y - baseline + normal),
    y: point.y + t.y * (p.x - anchor) + t.x * (p.y - baseline + normal),
  });
  return paths.map((p) => ({
    ...p,
    start: map(p.start),
    segments: p.segments.map((s) =>
      s.type === 'C' ? { ...s, to: map(s.to), c1: map(s.c1), c2: map(s.c2) } : { ...s, to: map(s.to) },
    ),
  }));
}
