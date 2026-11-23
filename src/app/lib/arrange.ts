/** Deterministic, bounded placement. Runs in a worker; all transforms are proposed, never applied. */
import {
  apply,
  boundsOfPoints,
  flattenPaths,
  intersection,
  multiply,
  offsetRings,
  rotationAbout,
  signedArea,
  translation,
  union,
} from 'libopenlaser/geometry';
import type { Mat2D, Rect, Vec2 } from 'libopenlaser/geometry';
import { groupLeaves } from 'libopenlaser/project';
import type { Project, SceneObject } from 'libopenlaser/project';
import { boundsOf } from './selection';

export type ArrangeMode =
  'automatic' | 'horizontal' | 'vertical' | 'grid' | 'circle' | 'staggered' | 'contour';
export interface ArrangeSettings {
  mode: ArrangeMode;
  width: number;
  height: number;
  gap: number;
  margin: number;
  rotate: boolean;
  increment: number;
  grain: 'unrestricted' | 'horizontal' | 'vertical' | 'fixed' | 'custom';
  angles: number[];
  preserveGroups: boolean;
  respectLocked: boolean;
  holeNesting: boolean;
  rows: number;
  columns: number;
  radius: number;
  startAngle: number;
  sweep: number;
  rotateAlongCircle: boolean;
}
export interface ArrangeResult {
  transforms: [string, Mat2D][];
  placed: string[];
  unplaced: string[];
  mode: ArrangeMode;
  materialArea: number;
  occupiedArea: number;
  utilization: number;
  remainingArea: number;
  warnings: string[];
}
interface Unit {
  id: string;
  objects: SceneObject[];
  rings: Vec2[][];
  bounds: Rect;
  locked: boolean;
  kerf: number;
}
const boxRing = (b: Rect): Vec2[] => [
  { x: b.minX, y: b.minY },
  { x: b.maxX, y: b.minY },
  { x: b.maxX, y: b.maxY },
  { x: b.minX, y: b.maxY },
];
const mapRings = (rings: Vec2[][], m: Mat2D) => rings.map((ring) => ring.map((p) => apply(m, p)));
const overlaps = (a: Rect, b: Rect) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const area = (rings: Vec2[][]) => Math.abs(rings.reduce((sum, ring) => sum + signedArea(ring), 0));

function arrangePass(
  project: Project,
  ids: string[],
  settings: ArrangeSettings,
  scope: string | null = null,
  progress: (value: number) => void = () => {},
): ArrangeResult {
  const s = settings;
  if (
    ![s.width, s.height, s.gap, s.margin, s.increment, s.radius, s.startAngle, s.sweep, ...s.angles].every(
      Number.isFinite,
    ) ||
    s.width <= 0 ||
    s.height <= 0 ||
    s.gap < 0 ||
    s.margin < 0 ||
    s.margin * 2 >= Math.min(s.width, s.height) ||
    s.increment < 5 ||
    s.increment > 360 ||
    s.radius < 0 ||
    !Number.isInteger(s.rows) ||
    s.rows < 0 ||
    !Number.isInteger(s.columns) ||
    s.columns < 0
  )
    throw new Error('Enter valid material dimensions, spacing, margins, counts and rotation settings.');
  if (ids.length > 1000) throw new Error('Arrange at most 1000 objects at a time.');
  const selected = new Set(ids);
  if (
    s.holeNesting &&
    (!project.jobSettings.optimizeOrder ||
      new Set(project.objects.filter((o) => selected.has(o.id)).map((o) => o.layerId)).size !== 1 ||
      project.objects
        .filter((o) => selected.has(o.id))
        .some((o) => o.kind === 'image' || project.layers.find((l) => l.id === o.layerId)?.mode !== 'line'))
  )
    throw new Error('Hole nesting requires a single line layer and optimized cut ordering.');
  const warnings = new Set<string>();
  const groups = project.groups ?? [];
  const unitId = (id: string) => {
    if (!s.preserveGroups) return id;
    let key = id;
    let parent = groups.find((g) => g.children.includes(key));
    while (
      parent &&
      parent.id !== scope &&
      groupLeaves(project, parent.id).every((leaf) => selected.has(leaf))
    ) {
      key = parent.id;
      parent = groups.find((g) => g.children.includes(key));
    }
    return key;
  };
  const buckets = new Map<string, SceneObject[]>();
  for (const object of project.objects.filter((o) => selected.has(o.id) && o.visible)) {
    if (
      object.kind === 'text' &&
      (object.outlineDirty || !object.paths.length || object.missingGlyphs?.length)
    )
      throw new Error('Wait for complete text outlines before arranging.');
    const key = unitId(object.id);
    buckets.set(key, [...(buckets.get(key) ?? []), object]);
  }
  const makeUnit = (id: string, objects: SceneObject[]): Unit | null => {
    const bounds = boundsOf(objects);
    if (!bounds || !Object.values(bounds).every(Number.isFinite)) return null;
    const allowHoles =
      s.holeNesting &&
      objects.every(
        (o) => o.kind !== 'image' && project.layers.find((l) => l.id === o.layerId)?.mode === 'line',
      );
    if (s.holeNesting && !allowHoles)
      warnings.add(
        'Hole nesting disabled for parts with engraving, images, or unverified operation settings.',
      );
    let kerf = 0;
    const regions = objects.flatMap((object) => {
      const b = boundsOf([object]);
      if (!b) return [];
      kerf = Math.max(
        kerf,
        Math.abs(project.layers.find((l) => l.id === object.layerId)?.line?.kerfOffset ?? 0),
      );
      if (object.kind === 'image' || object.paths.some((p) => !p.closed) || !object.paths.length) {
        warnings.add('Images and open geometry use conservative rectangular footprints.');
        return [
          boxRing({ minX: b.minX - 0.005, minY: b.minY - 0.005, maxX: b.maxX + 0.005, maxY: b.maxY + 0.005 }),
        ];
      }
      const rings = flattenPaths(object.paths, object.transform, 0.005).map((p) => p.points);
      const normalized = union(rings, 'evenodd');
      return allowHoles
        ? normalized
        : union(
            normalized.map((ring) => (signedArea(ring) < 0 ? [...ring].reverse() : ring)),
            'nonzero',
          );
    });
    const rings = union(regions, 'nonzero');
    return { id, objects, rings, bounds, locked: s.respectLocked && objects.some((o) => o.locked), kerf };
  };
  const units = [...buckets].map(([id, objects]) => makeUnit(id, objects)).filter((u): u is Unit => !!u);
  if (!units.length) throw new Error('Select visible objects with valid geometry.');
  let mode = s.mode;
  if (mode === 'automatic') {
    const sizes = units.map((u) => [u.bounds.maxX - u.bounds.minX, u.bounds.maxY - u.bounds.minY]);
    const identical = sizes.every(
      ([w, h]) => Math.abs(w - sizes[0][0]) < 0.01 && Math.abs(h - sizes[0][1]) < 0.01,
    );
    const circles = units.every(
      (u) =>
        u.objects.length === 1 &&
        u.objects[0].kind === 'vector' &&
        (u.objects[0].shape?.kind === 'circle' || u.objects[0].name === 'Ellipse'),
    );
    mode = circles && identical ? 'staggered' : identical ? 'grid' : 'contour';
  }
  const result: ArrangeResult = {
    transforms: [],
    placed: [],
    unplaced: [],
    mode,
    materialArea: s.width * s.height,
    occupiedArea: 0,
    utilization: 0,
    remainingArea: 0,
    warnings: [],
  };
  const placed: { rings: Vec2[][]; bounds: Rect }[] = [];
  // Spatial hash broad phase. Exact polygon intersection is the final collision test.
  const cellSize = Math.max(1, Math.sqrt((s.width * s.height) / Math.max(1, units.length)));
  const index = new Map<string, Set<number>>();
  const keys = (b: Rect) => {
    const out: string[] = [];
    for (
      let x = Math.max(0, Math.floor(b.minX / cellSize));
      x <= Math.min(Math.ceil(s.width / cellSize), Math.floor(b.maxX / cellSize));
      x++
    )
      for (
        let y = Math.max(0, Math.floor(b.minY / cellSize));
        y <= Math.min(Math.ceil(s.height / cellSize), Math.floor(b.maxY / cellSize));
        y++
      )
        out.push(`${x}:${y}`);
    return out;
  };
  const insert = (rings: Vec2[][]) => {
    const bounds = boundsOfPoints(rings.flat());
    if (!bounds) return;
    const i = placed.length;
    placed.push({ rings, bounds });
    for (const key of keys(bounds)) {
      const bucket = index.get(key) ?? new Set();
      bucket.add(i);
      index.set(key, bucket);
    }
  };
  const collides = (rings: Vec2[][], b: Rect) => {
    const candidates = new Set(keys(b).flatMap((key) => [...(index.get(key) ?? [])]));
    return [...candidates].some(
      (i) => overlaps(b, placed[i].bounds) && intersection(rings, placed[i].rings, 'nonzero').length > 0,
    );
  };
  // Locked selected units and all unselected locked objects are stationary obstacles.
  for (const unit of units.filter((u) => u.locked))
    insert(offsetRings(unit.rings, s.gap / 2 + unit.kerf + 0.006, { join: 'round', arcTolerance: 0.001 }));
  for (const object of project.objects.filter((o) => !selected.has(o.id) && o.locked && o.visible)) {
    const unit = makeUnit(object.id, [object]);
    if (unit)
      insert(offsetRings(unit.rings, s.gap / 2 + unit.kerf + 0.006, { join: 'round', arcTolerance: 0.001 }));
  }
  for (const unit of units.filter((u) => u.locked)) {
    if (
      unit.bounds.minX >= s.margin &&
      unit.bounds.minY >= s.margin &&
      unit.bounds.maxX <= s.width - s.margin &&
      unit.bounds.maxY <= s.height - s.margin
    ) {
      result.placed.push(unit.id);
      result.occupiedArea += area(unit.rings);
    } else {
      result.unplaced.push(unit.id);
      warnings.add('Locked parts outside material boundaries remain stationary.');
    }
  }
  const moving = units.filter((u) => !u.locked);
  if (mode === 'contour') moving.sort((a, b) => area(b.rings) - area(a.rings) || a.id.localeCompare(b.id));
  const rotations =
    !s.rotate || s.grain === 'fixed'
      ? [0]
      : s.grain === 'custom'
        ? s.angles
        : s.grain === 'horizontal'
          ? [0, 180]
          : s.grain === 'vertical'
            ? [90, 270]
            : Array.from({ length: Math.ceil(360 / s.increment) }, (_, i) => i * s.increment);
  if (!rotations.length || rotations.length > 72)
    throw new Error('Choose between one and 72 allowed rotation angles.');
  const maxW = Math.max(...moving.map((u) => u.bounds.maxX - u.bounds.minX), 0);
  const maxH = Math.max(...moving.map((u) => u.bounds.maxY - u.bounds.minY), 0);
  const cols =
    s.columns || Math.max(1, Math.floor((s.width - 2 * s.margin + s.gap) / Math.max(0.001, maxW + s.gap)));
  const rows = s.rows || Math.ceil(moving.length / cols);
  let cursorX = s.margin,
    cursorY = s.margin;
  let attempts = 0;
  const maxAttempts = 100000;
  moving.forEach((unit, i) => {
    let accepted: { matrix: Mat2D; rings: Vec2[][]; footprint: Vec2[][]; bounds: Rect } | null = null;
    const candidates: Vec2[] = [];
    if (mode === 'horizontal' || mode === 'vertical') candidates.push({ x: cursorX, y: cursorY });
    else if (mode === 'grid' || mode === 'staggered') {
      const row = Math.floor(i / cols),
        col = i % cols;
      if (row < rows)
        candidates.push({
          x:
            s.margin +
            col * (maxW + s.gap + 0.02) +
            (mode === 'staggered' && row % 2 ? (maxW + s.gap + 0.02) / 2 : 0),
          y: s.margin + row * (maxH + s.gap + 0.02) * (mode === 'staggered' ? Math.sqrt(3) / 2 : 1),
        });
    } else if (mode === 'circle') {
      const angle =
        ((s.startAngle +
          (i * s.sweep) / (Math.abs(s.sweep) === 360 ? moving.length : Math.max(1, moving.length - 1))) *
          Math.PI) /
        180;
      candidates.push({
        x: s.width / 2 + s.radius * Math.cos(angle) - (unit.bounds.maxX - unit.bounds.minX) / 2,
        y: s.height / 2 + s.radius * Math.sin(angle) - (unit.bounds.maxY - unit.bounds.minY) / 2,
      });
    } else {
      const xs = new Set([s.margin]);
      const ys = new Set([s.margin]);
      for (const p of placed) {
        xs.add(p.bounds.maxX + s.gap / 2 + unit.kerf + 0.01);
        ys.add(p.bounds.maxY + s.gap / 2 + unit.kerf + 0.01);
        // Contour vertices supply inward placements, including verified hole regions.
        for (const ring of p.rings)
          for (const point of ring) {
            if (xs.size < 120) xs.add(point.x + s.gap / 2 + unit.kerf + 0.01);
            if (ys.size < 120) ys.add(point.y + s.gap / 2 + unit.kerf + 0.01);
          }
      }
      for (const y of [...ys].sort((a, b) => a - b))
        for (const x of [...xs].sort((a, b) => a - b))
          if (x >= s.margin && y >= s.margin && x < s.width - s.margin && y < s.height - s.margin)
            candidates.push({ x, y });
    }
    for (const point of candidates) {
      for (const angle of rotations) {
        if (++attempts > maxAttempts || accepted) break;
        const degrees =
          mode === 'circle' && s.rotateAlongCircle
            ? s.startAngle + (i * s.sweep) / Math.max(1, moving.length)
            : angle;
        const rotation = rotationAbout(degrees, 0, 0);
        const rotated = mapRings(unit.rings, rotation);
        const box = boundsOfPoints(rotated.flat());
        if (!box) continue;
        const matrix = multiply(translation(point.x - box.minX, point.y - box.minY), rotation);
        const rings = mapRings(unit.rings, matrix);
        const footprint = offsetRings(rings, s.gap / 2 + unit.kerf + 0.006, {
          join: 'round',
          arcTolerance: 0.001,
        });
        const bounds = boundsOfPoints(rings.flat())!;
        if (
          bounds.minX - unit.kerf < s.margin - 1e-6 ||
          bounds.minY - unit.kerf < s.margin - 1e-6 ||
          bounds.maxX + unit.kerf > s.width - s.margin + 1e-6 ||
          bounds.maxY + unit.kerf > s.height - s.margin + 1e-6
        )
          continue;
        if (!collides(footprint, boundsOfPoints(footprint.flat())!))
          accepted = { matrix, rings, footprint, bounds };
      }
      if (accepted || attempts > maxAttempts) break;
    }
    if (accepted) {
      const placement = accepted as { matrix: Mat2D; rings: Vec2[][]; footprint: Vec2[][]; bounds: Rect };
      insert(placement.footprint);
      for (const object of unit.objects)
        result.transforms.push([object.id, multiply(placement.matrix, object.transform)]);
      result.placed.push(unit.id);
      result.occupiedArea += area(placement.rings);
      if (mode === 'horizontal') cursorX = placement.bounds.maxX + s.gap + 0.02;
      if (mode === 'vertical') cursorY = placement.bounds.maxY + s.gap + 0.02;
    } else result.unplaced.push(unit.id);
    progress((i + 1) / Math.max(1, moving.length));
  });
  if (attempts > maxAttempts)
    warnings.add(
      'Optimization limit reached; this deterministic heuristic does not guarantee an optimal arrangement.',
    );
  if (s.holeNesting)
    warnings.add(
      'Hole nesting requires a line-only cut job. Review inner-before-outer cut ordering in job preview.',
    );
  // Unplaced parts retain original positions. A partial apply must not collide with them.
  let changed = true;
  while (changed) {
    changed = false;
    const map = new Map(result.transforms);
    const originalObstacles = units
      .filter((u) => result.unplaced.includes(u.id))
      .map((u) => offsetRings(u.rings, s.gap / 2 + u.kerf + 0.006, { join: 'round', arcTolerance: 0.001 }));
    for (const unit of moving.filter((u) => result.placed.includes(u.id))) {
      const transformed = unit.objects.flatMap((o) => {
        if (o.kind === 'image') return [boxRing(boundsOf([{ ...o, transform: map.get(o.id)! }])!)];
        return union(
          flattenPaths(o.paths, map.get(o.id)!, 0.005)
            .filter((p) => p.closed)
            .map((p) => p.points),
          'evenodd',
        );
      });
      if (
        originalObstacles.some(
          (rings) =>
            intersection(offsetRings(transformed, s.gap / 2 + unit.kerf + 0.006), rings, 'nonzero').length,
        )
      ) {
        result.unplaced.push(unit.id);
        result.placed = result.placed.filter((id) => id !== unit.id);
        const leaves = new Set(unit.objects.map((o) => o.id));
        result.transforms = result.transforms.filter(([id]) => !leaves.has(id));
        changed = true;
        warnings.add('Some placements were withheld to avoid collisions with unplaced originals.');
      }
    }
  }
  const finalTransforms = new Map(result.transforms);
  result.occupiedArea = 0;
  for (const unit of units.filter((u) => result.placed.includes(u.id))) {
    const original = unit.objects[0];
    const target = finalTransforms.get(original.id);
    // Rotation and translation preserve area.
    if (target || unit.locked) result.occupiedArea += area(unit.rings);
  }
  result.utilization = (100 * result.occupiedArea) / result.materialArea;
  result.remainingArea = Math.max(0, result.materialArea - result.occupiedArea);
  result.warnings = [...warnings];
  return result;
}

/** Compare bounded trials and keep the best valid result found, without claiming optimality. */
export function arrangeObjects(
  project: Project,
  ids: string[],
  settings: ArrangeSettings,
  scope: string | null = null,
  progress: (value: number) => void = () => {},
): ArrangeResult {
  const first = arrangePass(project, ids, settings, scope, progress);
  const trials: ArrangeResult[] = [first];
  if (settings.mode === 'automatic' && first.mode === 'staggered')
    trials.push(arrangePass(project, ids, { ...settings, mode: 'grid' }, scope, progress));
  if (first.mode === 'contour' && settings.rotate && settings.grain !== 'fixed') {
    const angles =
      settings.grain === 'custom'
        ? settings.angles
        : settings.grain === 'horizontal'
          ? [0, 180]
          : settings.grain === 'vertical'
            ? [90, 270]
            : Array.from({ length: Math.ceil(360 / settings.increment) }, (_, i) => i * settings.increment);
    trials.push(
      arrangePass(
        project,
        ids,
        { ...settings, mode: 'contour', grain: 'custom', angles: [...angles].reverse() },
        scope,
        progress,
      ),
    );
  }
  trials.sort((a, b) => b.placed.length - a.placed.length || b.occupiedArea - a.occupiedArea);
  progress(1);
  return trials[0];
}
