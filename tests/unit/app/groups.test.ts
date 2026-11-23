import { afterEach, expect, it } from 'vitest';
import {
  createGroup,
  createProject,
  defaultLayer,
  duplicateObjects,
  groupLeaves,
  serializeProject,
  deserializeProject,
  ungroup,
  validateGroups,
  type VectorObject,
} from 'libopenlaser/project';
import { editor } from '$app/state/editor.svelte';
import { groupSelection, ungroupSelection, renameGroup } from '$app/group-actions';
const object = (id: string): VectorObject => ({
  id,
  name: id,
  kind: 'vector',
  layerId: 'l',
  locked: false,
  visible: true,
  transform: [0, 2, -3, 0, 40, 30],
  paths: [],
});
const project = () => ({
  ...createProject(),
  layers: [defaultLayer({ id: 'l' })],
  objects: ['a', 'b', 'c'].map(object),
});
afterEach(() => editor.close());
it('groups without mutating child transforms, layers, ordering or identifiers', () => {
  const p = project();
  const next = createGroup(p, ['a', 'b'], 'g', 'Design', null);
  expect(next.objects).toBe(p.objects);
  expect(groupLeaves(next, 'g')).toEqual(['a', 'b']);
  expect(p.groups).toBeUndefined();
  expect(ungroup(next, 'g').objects).toBe(p.objects);
});
it('nested ungroup removes exactly one container level', () => {
  const p = createGroup(
    createGroup(project(), ['a', 'b'], 'inner', 'Inner', null),
    ['inner', 'c'],
    'outer',
    'Outer',
    null,
  );
  const next = ungroup(p, 'outer');
  expect(next.groups?.map((g) => g.id)).toEqual(['inner']);
  expect(groupLeaves(next, 'inner')).toEqual(['a', 'b']);
});
it('rejects cycles, duplicate ownership, missing references and identifier collisions', () => {
  const p = project();
  for (const groups of [
    [{ id: 'g', name: 'g', children: ['g'] }],
    [
      { id: 'g', name: 'g', children: ['a'] },
      { id: 'h', name: 'h', children: ['a'] },
    ],
    [{ id: 'g', name: 'g', children: ['missing'] }],
    [{ id: 'a', name: 'g', children: ['b'] }],
  ])
    expect(() => validateGroups({ ...p, groups })).toThrow(/hierarchy/);
});
it('selects rigid groups, enters nested scope, scopes Ctrl+A and exits one level', () => {
  const p = createGroup(
    createGroup(project(), ['a', 'b'], 'inner', 'Inner', null),
    ['inner', 'c'],
    'outer',
    'Outer',
    null,
  );
  editor.open(p);
  editor.select(['a']);
  expect([...editor.selection]).toEqual(['a', 'b', 'c']);
  expect(editor.selectedGroup).toBe('outer');
  editor.enterGroup('outer');
  editor.select(['a']);
  expect([...editor.selection]).toEqual(['a', 'b']);
  expect(editor.selectedGroup).toBe('inner');
  editor.enterGroup('inner');
  editor.selectAll();
  expect([...editor.selection]).toEqual(['a', 'b']);
  editor.select(['c']);
  expect(editor.selection.size).toBe(0);
  editor.exitGroup();
  expect(editor.groupScope).toBe('outer');
  editor.exitGroup();
  expect(editor.groupScope).toBeNull();
});
it('group, rename and ungroup are independent undoable transactions', () => {
  editor.open(project());
  editor.select(['a', 'b']);
  groupSelection();
  const id = editor.selectedGroup!;
  renameGroup('Bookmark');
  expect(editor.project?.groups?.find((g) => g.id === id)?.name).toBe('Bookmark');
  ungroupSelection();
  expect(editor.project?.groups).toEqual([]);
  editor.undo();
  expect(editor.project?.groups?.[0].name).toBe('Bookmark');
  editor.undo();
  expect(editor.project?.groups?.[0].name).toMatch(/Group/);
  editor.undo();
  expect(editor.project?.groups).toBeUndefined();
});
it('duplicates complete hierarchies with fresh identifiers', () => {
  const p = createGroup(project(), ['a', 'b'], 'g', 'Design', null);
  let counter = 0;
  const result = duplicateObjects(p, new Set(['a', 'b']), () => `copy-${++counter}`);
  const copy = result.project.groups?.find((g) => g.id !== 'g');
  expect(copy).toBeDefined();
  expect(groupLeaves(result.project, copy!.id)).toEqual(result.ids);
  validateGroups(result.project);
});
it('roundtrips hierarchy through project archives and accepts older files', async () => {
  const p = createGroup(project(), ['a', 'b'], 'g', 'Design', null);
  expect(await deserializeProject(await serializeProject(p))).toEqual(p);
  const old = project();
  expect(await deserializeProject(await serializeProject(old))).toEqual(old);
});

it('composes local group frames on save/load without coordinate drift after rigid edits', async () => {
  const { transformObjects } = await import('libopenlaser/project');
  const { multiply, rotationAbout, translation } = await import('libopenlaser/geometry');
  editor.open(
    createGroup(
      createGroup(project(), ['a', 'b'], 'inner', 'Inner', null),
      ['inner', 'c'],
      'outer',
      'Outer',
      null,
    ),
  );
  editor.select(['a']);
  editor.commit((p) =>
    transformObjects(p, editor.selection, multiply(translation(17, 29), rotationAbout(37, 0, 0))),
  );
  const before = editor.project!;
  expect(before.groups?.find((g) => g.id === 'outer')?.transform).toBeDefined();
  const restored = await deserializeProject(await serializeProject(before));
  restored.objects.forEach((o, i) =>
    o.transform.forEach((v, j) => expect(v).toBeCloseTo(before.objects[i].transform[j], 9)),
  );
  expect(restored.groups?.map((g) => g.children)).toEqual(before.groups?.map((g) => g.children));
});
