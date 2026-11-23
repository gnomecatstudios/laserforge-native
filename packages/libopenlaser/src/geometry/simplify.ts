import { apply, IDENTITY } from './mat2d';
import type { Mat2D, PathData, Segment, Vec2 } from './types';

function distance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Reduce nodes within a tolerance in transformed mm, retaining cubic segments.
 * Endpoints, the closed seam and turns of 45 degrees or more are retained.
 * The iterative algorithm avoids recursion limits on large imported paths.
 */
export function simplifyPath(path: PathData, tolerance: number, transform: Mat2D = IDENTITY): PathData {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || path.segments.length < 2) return path;
  if (path.segments.some((s) => s.type === 'C')) return simplifyCubics(path, tolerance, transform);
  const points = [path.start, ...path.segments.map((s) => s.to)];
  const world = points.map((p) => apply(transform, p));
  if (world.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return path;
  // Normalize explicit closing endpoints, while keeping the original seam.
  if (path.closed && distance(world[world.length - 1], world[0], world[0]) < 1e-9) {
    points.pop();
    world.pop();
  }
  if (points.length < (path.closed ? 3 : 2)) return path;
  const keep = new Set([0, points.length - 1]);
  for (let i = 1; i < world.length - 1; i++) {
    const a = world[i - 1],
      b = world[i],
      c = world[i + 1];
    const ux = b.x - a.x,
      uy = b.y - a.y,
      vx = c.x - b.x,
      vy = c.y - b.y;
    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (length && (ux * vx + uy * vy) / length <= Math.SQRT1_2) keep.add(i);
  }
  if (path.closed) {
    // A second anchor splits smooth loops; never reduce a ring to a line.
    let farthest = 1;
    for (let i = 2; i < world.length; i++) {
      if (distance(world[i], world[0], world[0]) > distance(world[farthest], world[0], world[0]))
        farthest = i;
    }
    keep.add(farthest);
  }
  const anchors = [...keep].sort((a, b) => a - b);
  const stack: [number, number][] = anchors.slice(1).map((end, i) => [anchors[i], end]);
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maximum = tolerance,
      index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = distance(world[i], world[first], world[last]);
      if (d > maximum) {
        maximum = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep.add(index);
      stack.push([first, index], [index, last]);
    }
  }
  if (keep.size < (path.closed ? 3 : 2)) return path;
  const result = points.filter((_, i) => keep.has(i));
  if (path.closed) {
    // Reject collapsed or reversed loops even with an excessive tolerance.
    const area = (ps: Vec2[]) =>
      ps.reduce((n, p, i) => {
        const q = ps[(i + 1) % ps.length];
        return n + p.x * q.y - q.x * p.y;
      }, 0);
    if (area(result) * area(points) <= 0) return path;
  }
  if (result.length === path.segments.length + 1) return path;
  return { ...path, segments: result.slice(1).map((to) => ({ type: 'L', to })) };
}

/** Merge adjacent cubics by reversing de Casteljau subdivision. Comparing each control point
 * of both split halves bounds the whole curve's deviation by the convex-hull property.
 * Carry the accumulated bound through successive merges so errors never exceed tolerance.
 */
function simplifyCubics(path: PathData, tolerance: number, transform: Mat2D): PathData {
  const entries: Array<{ start: Vec2; segment: Segment; error: number }> = [];
  let start = path.start;
  const mix = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  for (const segment of path.segments) {
    entries.push({ start, segment, error: 0 });
    start = segment.to;
    while (entries.length >= 2) {
      const left = entries[entries.length - 2],
        right = entries[entries.length - 1];
      const a = left.segment,
        b = right.segment;
      if (a.type !== 'C' || b.type !== 'C') break;
      const u = { x: a.to.x - a.c2.x, y: a.to.y - a.c2.y };
      const v = { x: b.c1.x - a.to.x, y: b.c1.y - a.to.y };
      const lu = Math.hypot(u.x, u.y),
        lv = Math.hypot(v.x, v.y);
      if (!(lu > 1e-12 && lv > 1e-12) || u.x * v.x + u.y * v.y <= 0) break;
      const t = lu / (lu + lv);
      if (t < 1e-6 || t > 1 - 1e-6) break;
      const c1 = mix(left.start, a.c1, 1 / t),
        c2 = mix(b.to, b.c2, 1 / (1 - t));
      const p01 = mix(left.start, c1, t),
        p12 = mix(c1, c2, t),
        p23 = mix(c2, b.to, t);
      const p012 = mix(p01, p12, t),
        p123 = mix(p12, p23, t),
        seam = mix(p012, p123, t);
      const expected = [a.c1, a.c2, a.to, b.c1, b.c2];
      const actual = [p01, p012, seam, p123, p23];
      let error = 0;
      for (let i = 0; i < actual.length; i++) {
        const x = apply(transform, actual[i]),
          y = apply(transform, expected[i]);
        error = Math.max(error, Math.hypot(x.x - y.x, x.y - y.y));
      }
      error += Math.max(left.error, right.error);
      if (!Number.isFinite(error) || error > tolerance) break;
      entries.splice(entries.length - 2, 2, {
        start: left.start,
        segment: { type: 'C', c1, c2, to: b.to },
        error,
      });
    }
  }
  return entries.length < path.segments.length ? { ...path, segments: entries.map((e) => e.segment) } : path;
}
