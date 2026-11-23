/** Pure layout geometry. All coordinates are bed millimetres; originals are never mutated. */
import { multiply, rotationAbout, translation } from 'libopenlaser/geometry';
import type { Mat2D, Rect, Vec2 } from 'libopenlaser/geometry';
import { groupLeaves } from 'libopenlaser/project';
import type { SceneObject } from 'libopenlaser/project';
import { boundsOf } from './selection';

export type Alignment = 'left' | 'center-x' | 'right' | 'bottom' | 'center-y' | 'top';
export const MAX_ARRAY_OBJECTS = 1000;
const center = (b: Rect): Vec2 => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

export function alignObjects(objects: SceneObject[], target: Rect, align: Alignment): Map<string, Mat2D> {
  const out = new Map<string, Mat2D>();
  for (const o of objects) {
    if (o.locked) continue;
    const b = boundsOf([o]);
    if (!b) continue;
    const dx =
      align === 'left'
        ? target.minX - b.minX
        : align === 'right'
          ? target.maxX - b.maxX
          : align === 'center-x'
            ? center(target).x - center(b).x
            : 0;
    const dy =
      align === 'bottom'
        ? target.minY - b.minY
        : align === 'top'
          ? target.maxY - b.maxY
          : align === 'center-y'
            ? center(target).y - center(b).y
            : 0;
    out.set(o.id, multiply(translation(dx, dy), o.transform));
  }
  return out;
}

/** The two outer objects stay fixed. Gaps may be negative when the span is too small. */
export function distributeObjects(
  objects: SceneObject[],
  axis: 'x' | 'y',
  mode: 'centers' | 'gaps',
): Map<string, Mat2D> {
  const out = new Map<string, Mat2D>();
  const min = axis === 'x' ? 'minX' : 'minY';
  const max = axis === 'x' ? 'maxX' : 'maxY';
  const list = objects
    .filter((o) => !o.locked)
    .map((o) => ({ o, b: boundsOf([o]) }))
    .filter((v): v is { o: SceneObject; b: Rect } => !!v.b);
  list.sort((a, b) => (mode === 'centers' ? center(a.b)[axis] - center(b.b)[axis] : a.b[min] - b.b[min]));
  if (list.length < 3) return out;
  const first = list[0].b,
    last = list[list.length - 1].b;
  const step =
    mode === 'centers'
      ? (center(last)[axis] - center(first)[axis]) / (list.length - 1)
      : (last[max] - first[min] - list.reduce((s, v) => s + v.b[max] - v.b[min], 0)) / (list.length - 1);
  let cursor = first[min];
  list.forEach(({ o, b }, i) => {
    const delta = mode === 'centers' ? center(first)[axis] + i * step - center(b)[axis] : cursor - b[min];
    if (i > 0 && i < list.length - 1)
      out.set(o.id, multiply(translation(axis === 'x' ? delta : 0, axis === 'y' ? delta : 0), o.transform));
    cursor += b[max] - b[min] + step;
  });
  return out;
}

export type ArraySpec =
  | {
      kind: 'grid';
      rows: number;
      columns: number;
      gapX: number;
      gapY: number;
      directionX?: number;
      directionY?: number;
    }
  | { kind: 'circle'; count: number; center: Vec2; sweep: number; rotate: boolean };

/** Returns only additional copies. Counts include the original selection. */
export function arrayCopies(objects: SceneObject[], spec: ArraySpec): SceneObject[] {
  const b = boundsOf(objects);
  if (!b || objects.length === 0 || objects.some((o) => o.locked)) return [];
  const transforms: Mat2D[] = [];
  if (spec.kind === 'grid') {
    if (
      ![spec.rows, spec.columns].every((n) => Number.isInteger(n) && n >= 1) ||
      ![spec.gapX, spec.gapY].every(Number.isFinite)
    )
      return [];
    if (spec.rows * spec.columns * objects.length > MAX_ARRAY_OBJECTS) return [];
    for (let row = 0; row < spec.rows; row++)
      for (let col = 0; col < spec.columns; col++) {
        if (!row && !col) continue;
        transforms.push(
          translation(
            col * (b.maxX - b.minX + spec.gapX) * (spec.directionX ?? 1),
            row * (b.maxY - b.minY + spec.gapY) * (spec.directionY ?? -1),
          ),
        );
      }
  } else {
    if (
      !Number.isInteger(spec.count) ||
      spec.count < 2 ||
      spec.count * objects.length > MAX_ARRAY_OBJECTS ||
      ![spec.center.x, spec.center.y, spec.sweep].every(Number.isFinite)
    )
      return [];
    const step = spec.sweep / (Math.abs(spec.sweep) === 360 ? spec.count : spec.count - 1);
    const original = center(b);
    for (let i = 1; i < spec.count; i++) {
      const degrees = i * step;
      if (spec.rotate) transforms.push(rotationAbout(degrees, spec.center.x, spec.center.y));
      else {
        const angle = (degrees * Math.PI) / 180,
          x = original.x - spec.center.x,
          y = original.y - spec.center.y;
        transforms.push(
          translation(
            spec.center.x + x * Math.cos(angle) - y * Math.sin(angle) - original.x,
            spec.center.y + x * Math.sin(angle) + y * Math.cos(angle) - original.y,
          ),
        );
      }
    }
  }
  return transforms.flatMap((t, i) =>
    objects.map(
      (o) =>
        ({
          ...o,
          id: `array-preview-${i}-${o.id}`,
          name: `${o.name} copy`,
          transform: multiply(t, o.transform),
        }) as SceneObject,
    ),
  );
}

/** Reuse alignment/distribution geometry with complete groups represented by rigid proxies. */
export function rigidLayout(
  project: import('libopenlaser/project').Project,
  objects: SceneObject[],
  scope: string | null,
  run: (units: SceneObject[]) => Map<string, Mat2D>,
): Map<string, Mat2D> {
  const selected = new Set(objects.map((o) => o.id));
  const groups = project.groups ?? [];
  const members = new Map<string, SceneObject[]>();
  for (const object of objects) {
    let id = object.id;
    let parent = groups.find((g) => g.children.includes(id));
    while (parent && parent.id !== scope) {
      const leaves = groupLeaves(project, parent.id);
      if (!leaves.every((leaf) => selected.has(leaf))) break;
      id = parent.id;
      parent = groups.find((g) => g.children.includes(id));
    }
    members.set(id, [...(members.get(id) ?? []), object]);
  }
  const proxies: SceneObject[] = [];
  for (const [id, children] of members) {
    const bounds = boundsOf(children);
    if (!bounds) continue;
    proxies.push({
      id,
      name: id,
      kind: 'image',
      assetId: '',
      layerId: children[0].layerId,
      visible: true,
      locked: children.some((o) => o.locked),
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      transform: translation(bounds.minX, bounds.minY),
    });
  }
  const changed = run(proxies);
  const result = new Map<string, Mat2D>();
  for (const proxy of proxies) {
    const transform = changed.get(proxy.id);
    if (!transform || proxy.locked) continue;
    const delta = translation(transform[4] - proxy.transform[4], transform[5] - proxy.transform[5]);
    for (const object of members.get(proxy.id)!) result.set(object.id, multiply(delta, object.transform));
  }
  return result;
}
