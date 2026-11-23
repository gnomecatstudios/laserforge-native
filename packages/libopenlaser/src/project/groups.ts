/** Logical hierarchy over existing bed-space objects. Grouping never rewrites geometry. */
import { IDENTITY, invert, multiply } from '../geometry/mat2d';
import type { Id, ObjectGroup, Project, Mat2D } from './types';

export function groupLeaves(project: Project, id: Id): Id[] {
  const groups = new Map((project.groups ?? []).map((g) => [g.id, g]));
  const visiting = new Set<Id>();
  const visit = (key: Id): Id[] => {
    const group = groups.get(key);
    if (!group) return project.objects.some((o) => o.id === key) ? [key] : [];
    if (visiting.has(key)) throw new Error('Invalid group hierarchy: circular reference.');
    visiting.add(key);
    const leaves = group.children.flatMap(visit);
    visiting.delete(key);
    return leaves;
  };
  return visit(id);
}

export function validateGroups(project: Project): void {
  const ids = new Set(project.objects.map((o) => o.id));
  const owned = new Set<Id>();
  for (const group of project.groups ?? []) {
    if (group.transform && (group.transform.length !== 6 || group.transform.some((v) => !Number.isFinite(v))))
      throw new Error('Invalid group hierarchy: nonfinite transform.');
    if (ids.has(group.id)) throw new Error('Invalid group hierarchy: duplicate identifier.');
    ids.add(group.id);
  }
  for (const group of project.groups ?? []) {
    for (const child of group.children) {
      if (!ids.has(child) || owned.has(child))
        throw new Error('Invalid group hierarchy: missing or shared child.');
      owned.add(child);
    }
    groupLeaves(project, group.id);
  }
}

/** Discard deleted references and empty containers, preserving surviving hierarchy levels. */
export function pruneGroups(project: Project): Project {
  if (!project.groups?.length) return project;
  let groups = project.groups;
  for (;;) {
    const ids = new Set([...project.objects.map((o) => o.id), ...groups.map((g) => g.id)]);
    const next = groups
      .map((g) => ({ ...g, children: g.children.filter((id) => ids.has(id)) }))
      .filter((g) => g.children.length);
    if (JSON.stringify(next) === JSON.stringify(groups)) break;
    groups = next;
  }
  return groups === project.groups ? project : { ...project, groups };
}

export function createGroup(
  project: Project,
  children: Id[],
  id: Id,
  name: string,
  parent: Id | null,
): Project {
  if (children.length < 2) throw new Error('Select at least two objects or groups.');
  const childSet = new Set(children);
  const owner = (key: Id) => project.groups?.find((g) => g.children.includes(key))?.id ?? null;
  if (children.some((key) => owner(key) !== parent))
    throw new Error('Group selection must belong to one editing scope.');
  const group: ObjectGroup = { id, name, children, transform: IDENTITY };
  const next = {
    ...project,
    groups: [
      ...(project.groups ?? []).map((g) =>
        g.id === parent
          ? {
              ...g,
              children: g.children.flatMap((key) =>
                key === children[0] ? [id] : childSet.has(key) ? [] : [key],
              ),
            }
          : g,
      ),
      group,
    ],
  };
  validateGroups(next);
  return next;
}

export function ungroup(project: Project, id: Id): Project {
  const group = project.groups?.find((g) => g.id === id);
  if (!group) return project;
  return {
    ...project,
    groups: project
      .groups!.filter((g) => g.id !== id)
      .map((g) => ({
        ...g,
        children: g.children.flatMap((key) => (key === id ? group.children : [key])),
      })),
  };
}

/** Clone complete selected subtrees and remap text-guide references within the copied design. */
export function cloneGroupMetadata(project: Project, mapping: Map<Id, Id>, makeId: () => Id): ObjectGroup[] {
  const included = (project.groups ?? []).filter((g) =>
    groupLeaves(project, g.id).every((id) => mapping.has(id)),
  );
  for (const g of included) mapping.set(g.id, makeId());
  return included.map((g) => ({
    ...g,
    id: mapping.get(g.id)!,
    children: g.children.map((id) => mapping.get(id)!),
  }));
}

/** Maintain group frames after rigid edits while retaining the renderer's bed-space cache. */
export function syncGroupFrames(previous: Project, next: Project): Project {
  if (!next.groups?.length || previous.objects === next.objects) return next;
  const groups = next.groups.map((group) => {
    const old = previous.groups?.find((g) => g.id === group.id);
    if (!old) return group;
    const leaves = groupLeaves(next, group.id);
    const first = previous.objects.find((o) => o.id === leaves[0]);
    const current = next.objects.find((o) => o.id === leaves[0]);
    const inverse = first && invert(first.transform);
    if (!inverse || !current) return group;
    const delta = multiply(current.transform, inverse);
    const rigid = leaves.every((id) => {
      const a = previous.objects.find((o) => o.id === id),
        b = next.objects.find((o) => o.id === id);
      return a && b && multiply(delta, a.transform).every((v, i) => Math.abs(v - b.transform[i]) < 1e-8);
    });
    if (!rigid) return group;
    const transform = multiply(delta, old.transform ?? IDENTITY);
    return { ...group, transform: invert(transform) ? transform : IDENTITY };
  });
  return { ...next, groups };
}

/** Archives store true local frames. The current browser renderer receives composed bed caches. */
export function localGroupCoordinates(project: Project): Project {
  const parent = (id: Id) => project.groups?.find((g) => g.children.includes(id));
  const local = (id: Id, transform: Mat2D): Mat2D => {
    const owner = parent(id);
    const inverse = owner ? invert(owner.transform ?? IDENTITY) : IDENTITY;
    if (!inverse) throw new Error('Invalid group hierarchy: singular group frame.');
    return multiply(inverse, transform);
  };
  return {
    ...project,
    objects: project.objects.map((o) => ({ ...o, transform: local(o.id, o.transform) })),
    groups: project.groups?.map((g) => ({
      ...g,
      ...(g.transform ? { transform: local(g.id, g.transform) } : {}),
    })),
  };
}

export function worldGroupCoordinates(project: Project): Project {
  validateGroups(project);
  const frames = new Map<Id, Mat2D>();
  const frame = (id: Id): Mat2D => {
    const cached = frames.get(id);
    if (cached) return cached;
    const group = project.groups?.find((g) => g.id === id);
    const parent = project.groups?.find((g) => g.children.includes(id));
    const matrix = multiply(parent ? frame(parent.id) : IDENTITY, group?.transform ?? IDENTITY);
    frames.set(id, matrix);
    return matrix;
  };
  return {
    ...project,
    objects: project.objects.map((o) => {
      const parent = project.groups?.find((g) => g.children.includes(o.id));
      return parent ? { ...o, transform: multiply(frame(parent.id), o.transform) } : o;
    }),
    groups: project.groups?.map((g) => ({ ...g, ...(g.transform ? { transform: frame(g.id) } : {}) })),
  };
}

export function addNewObjectsToScope(previous: Project, next: Project, scope: Id | null): Project {
  if (!scope || !next.groups?.some((g) => g.id === scope)) return next;
  const old = new Set([...previous.objects.map((o) => o.id), ...(previous.groups ?? []).map((g) => g.id)]);
  const owned = new Set(next.groups.flatMap((g) => g.children));
  const added = [...next.objects.map((o) => o.id), ...next.groups.map((g) => g.id)].filter(
    (id) => !old.has(id) && !owned.has(id),
  );
  return added.length
    ? {
        ...next,
        groups: next.groups.map((g) => (g.id === scope ? { ...g, children: [...g.children, ...added] } : g)),
      }
    : next;
}
