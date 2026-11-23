/** Nondestructive outline deformation, evaluated once by the shared text outliner. */
import { flattenPaths, pathsBounds } from '../geometry/path';
import type { PathData, Vec2 } from '../geometry/types';
import type { TextModifier } from '../project/types';

export function applyTextModifiers(source: PathData[], modifiers: readonly TextModifier[] = []): PathData[] {
  let paths = source;
  for (const modifier of modifiers) {
    if (!modifier.enabled) continue;
    const bounds = pathsBounds(paths);
    if (!bounds) continue;
    const width = Math.max(1e-6, bounds.maxX - bounds.minX);
    const height = Math.max(1e-6, bounds.maxY - bounds.minY);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const { intensity } = modifier.parameters;
    if (!Number.isFinite(intensity) || Math.abs(intensity) > 1)
      throw new Error('Text modifier intensity must be between -1 and 1.');
    if (!intensity) continue;
    const map = (p: Vec2): Vec2 => {
      const u = (p.x - cx) / width;
      const v = (p.y - cy) / height;
      if (modifier.type === 'curve') {
        const angle = intensity * Math.PI;
        const parameters = modifier.parameters;
        const radius = parameters.radius ? Math.abs(parameters.radius) * Math.sign(angle) : width / angle;
        const theta =
          ((p.x - cx) / radius) * (parameters.reverse ? -1 : 1) +
          (((parameters.startAngle ?? 0) + (parameters.angularOffset ?? 0)) * Math.PI) / 180;
        const distance = radius + (p.y - cy) * (parameters.inside ? -1 : 1);
        return { x: cx + distance * Math.sin(theta), y: cy + distance * Math.cos(theta) - radius };
      }
      const amount = intensity;
      switch (modifier.parameters.preset) {
        case 'arch':
          return { x: p.x, y: p.y + amount * height * (1 - 4 * u * u) };
        case 'inverted-arch':
          return { x: p.x, y: p.y - amount * height * (1 - 4 * u * u) };
        case 'wave':
          return { x: p.x, y: p.y + amount * height * Math.sin(2 * Math.PI * u) };
        case 'bulge':
          return { x: p.x, y: cy + (p.y - cy) * (1 + amount * (1 - 4 * u * u)) };
        case 'squeeze':
          return { x: cx + (p.x - cx) * (1 - amount * (1 - 4 * v * v)), y: p.y };
        case 'perspective':
          return { x: cx + (p.x - cx) * (1 + amount * v), y: p.y };
        case 'slant':
          return { x: p.x + amount * width * v, y: p.y };
        default:
          throw new Error('Unsupported text warp preset.');
      }
    };
    // Sample straight edges too: mapping only cubic controls or endpoints distorts nonlinear warps.
    paths = flattenPaths(paths, undefined, 0.005).map(({ points, closed }) => {
      const sampled: Vec2[] = [];
      const count = points.length;
      for (let i = 0; i < count; i++) {
        const a = points[i];
        const b = points[(i + 1) % count];
        sampled.push(map(a));
        if (!closed && i === count - 1) break;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1));
        for (let j = 1; j < steps; j++)
          sampled.push(map({ x: a.x + ((b.x - a.x) * j) / steps, y: a.y + ((b.y - a.y) * j) / steps }));
      }
      return {
        start: sampled[0],
        closed,
        segments: sampled.slice(1).map((to) => ({ type: 'L' as const, to })),
      };
    });
  }
  return paths;
}
