/** Closed vector regions in bed space, using the same tolerance and even-odd holes as CAM. */
import { difference, intersection, union, xor } from '../geometry/clipper';
import { flattenPaths } from '../geometry/path';
import { isOutlined } from './outline';
import { IDENTITY } from '../geometry/mat2d';
import type { PathData, Vec2 } from '../geometry/types';
import type { Project, SceneObject, VectorObject } from './types';

export type BooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude';

export function booleanPaths(objects: readonly SceneObject[], operation: BooleanOperation): PathData[] {
  if (objects.length < 2) throw new Error('Select at least two closed vector or text objects.');
  const regions = objects.map((object) => {
    if (object.locked)
      throw new Error(`${object.name} is locked. Unlock it before using Boolean operations.`);
    if (!isOutlined(object) || !object.visible)
      throw new Error('Boolean operations require visible vector or text objects. Trace images first.');
    if (object.kind === 'text' && object.outlineDirty)
      throw new Error(`${object.name} has stale outlines. Wait for its font to finish loading.`);
    if (object.kind === 'text' && object.missingGlyphs?.length)
      throw new Error(`${object.name} has missing glyphs. Load the complete font first.`);
    if (!object.paths.length || object.paths.some((p) => !p.closed))
      throw new Error(`${object.name} contains empty or open paths. Close every path first.`);
    const finite = (p: Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y);
    if (
      object.transform.some((n) => !Number.isFinite(n)) ||
      object.paths.some(
        (p) =>
          !finite(p.start) ||
          p.segments.some((s) => !finite(s.to) || (s.type === 'C' && (!finite(s.c1) || !finite(s.c2)))),
      )
    )
      throw new Error(`${object.name} contains invalid coordinates.`);
    const rings = flattenPaths(object.paths, object.transform).map((p) => p.points);
    if (rings.some((r) => r.length < 3 || r.some((p) => Math.abs(p.x) > 1e12 || Math.abs(p.y) > 1e12)))
      throw new Error(`${object.name} contains degenerate or out-of-range geometry.`);
    if (rings.some((ring) => !union([ring], 'evenodd').length))
      throw new Error(`${object.name} contains a path with no enclosed area.`);
    const region = union(rings, 'evenodd');
    if (!region.length) throw new Error(`${object.name} has no enclosed area.`);
    return region;
  });
  // Normalize each operand independently before combining: holes stay holes and overlaps don't cancel.
  let rings = regions[0];
  for (const region of regions.slice(1)) {
    if (operation === 'union') rings = union([...rings, ...region], 'nonzero');
    else if (operation === 'subtract') rings = difference(rings, region, 'nonzero');
    else if (operation === 'intersect') rings = intersection(rings, region, 'nonzero');
    else rings = xor(rings, region, 'nonzero');
  }
  return rings.map((points) => ({
    start: points[0],
    segments: points.slice(1).map((to) => ({ type: 'L', to })),
    closed: true,
  }));
}

/** Atomic replacement; operand order is selection order, never project z-order. */
export function booleanObjects(
  project: Project,
  ids: readonly string[],
  operation: BooleanOperation,
  id: string,
): { project: Project; object: VectorObject | null } {
  if (new Set(ids).size !== ids.length) throw new Error('Boolean operands must be distinct.');
  const objects = ids.map((selected) => {
    const object = project.objects.find((o) => o.id === selected);
    if (!object) throw new Error('A selected object no longer exists.');
    if (!project.layers.some((l) => l.id === object.layerId && l.visible))
      throw new Error('Selected objects must belong to visible layers.');
    return object;
  });
  if (project.objects.some((o) => o.id === id)) throw new Error('The result ID is already in use.');
  const paths = booleanPaths(objects, operation);
  const object: VectorObject | null = paths.length
    ? {
        layerId: objects[0].layerId,
        locked: objects[0].locked,
        visible: objects[0].visible,
        ...(objects[0].kind === 'vector' ? { drawn: objects[0].drawn } : {}),
        kind: 'vector',
        id,
        name: `${objects[0].name} (${operation})`,
        paths,
        transform: IDENTITY,
        shape: undefined,
      }
    : null;
  const selected = new Set(ids);
  // Keep the result at the base's stacking position and retain all unrelated objects and assets.
  const remaining = project.objects.flatMap((o) =>
    o.id === ids[0] ? (object ? [object] : []) : selected.has(o.id) ? [] : [o],
  );
  const groups = project.groups?.map((g) => ({
    ...g,
    children: g.children.flatMap((key) =>
      key === ids[0] ? (object ? [object.id] : []) : selected.has(key) ? [] : [key],
    ),
  }));
  return { project: { ...project, ...(groups ? { groups } : {}), objects: remaining }, object };
}
