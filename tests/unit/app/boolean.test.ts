import { beforeEach, expect, it } from 'vitest';
import {
  flattenPaths,
  IDENTITY,
  multiply,
  rotationAbout,
  signedArea,
  translation,
} from 'libopenlaser/geometry';
import {
  booleanObjects,
  booleanPaths,
  createProject,
  defaultLayer,
  type VectorObject,
} from 'libopenlaser/project';
import { editor } from '../../../src/app/state/editor.svelte';
import { booleanSelection, booleanSelectionIssue } from '../../../src/app/unite';

function square(id: string, x = 0, y = 0, size = 10): VectorObject {
  return {
    id,
    name: id,
    kind: 'vector',
    layerId: 'layer',
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, x, y],
    paths: [
      {
        start: { x: 0, y: 0 },
        closed: true,
        segments: [
          { type: 'L', to: { x: size, y: 0 } },
          { type: 'L', to: { x: size, y: size } },
          { type: 'L', to: { x: 0, y: size } },
        ],
      },
    ],
  };
}
const area = (paths: ReturnType<typeof booleanPaths>) =>
  Math.abs(flattenPaths(paths, IDENTITY).reduce((sum, p) => sum + signedArea(p.points), 0));
const project = (objects = [square('a'), square('b', 5)]) => ({
  ...createProject(),
  layers: [defaultLayer({ id: 'layer', mode: 'line' })],
  objects,
});
beforeEach(() => editor.open(project()));

it.each([
  ['union', 150],
  ['subtract', 50],
  ['intersect', 50],
  ['exclude', 100],
] as const)('%s overlapping shapes', (op, expected) => {
  expect(area(booleanPaths([square('a'), square('b', 5)], op))).toBeCloseTo(expected);
});
it('subtraction creates a hole and retains disconnected pieces', () => {
  const hole = booleanPaths([square('a'), square('b', 2, 2, 6)], 'subtract');
  expect(hole).toHaveLength(2);
  expect(area(hole)).toBeCloseTo(64);
  const cutter = square('c', 4, -1);
  cutter.transform = [0.2, 0, 0, 1.2, 4, -1];
  const split = booleanPaths([square('a'), cutter], 'subtract');
  expect(split).toHaveLength(2);
  expect(area(split)).toBeCloseTo(80);
});
it('subtracts all later operands', () => {
  expect(
    area(booleanPaths([square('a'), square('b', 0, 0, 2), square('c', 8, 8, 2)], 'subtract')),
  ).toBeCloseTo(92);
});
it('intersection keeps only the area common to every operand', () => {
  expect(area(booleanPaths([square('a'), square('b', 5), square('c', 7)], 'intersect'))).toBeCloseTo(30);
});
it.each(['intersect', 'exclude', 'subtract'] as const)('%s handles empty results', (op) => {
  const second = square('b', op === 'intersect' ? 20 : 0);
  expect(booleanPaths([square('a'), second], op)).toEqual([]);
});
it('XOR follows odd parity with three and four identical operands', () => {
  expect(area(booleanPaths([square('a'), square('b'), square('c')], 'exclude'))).toBeCloseTo(100);
  expect(booleanPaths([square('a'), square('b'), square('c'), square('d')], 'exclude')).toEqual([]);
});
it.each(['union', 'subtract', 'intersect', 'exclude'] as const)('%s preserves compound holes', (op) => {
  const compound = square('a');
  compound.paths.push(
    ...square('hole', 0, 0, 6).paths.map((p) => ({
      ...p,
      start: { x: 2, y: 2 },
      segments: p.segments.map((s) => ({ ...s, to: { x: s.to.x + 2, y: s.to.y + 2 } })),
    })),
  );
  const result = booleanPaths([compound, square('b', 20)], op);
  expect(area(result)).toBeCloseTo(op === 'intersect' ? 0 : op === 'subtract' ? 64 : 164);
});
it('applies translation, rotation, mirroring and nonuniform scaling before clipping', () => {
  const a = square('a');
  a.transform = multiply(translation(30, 40), multiply(rotationAbout(45, 0, 0), [-2, 0, 0, 3, 0, 0]));
  const b = { ...a, id: 'b' };
  expect(area(booleanPaths([a, b], 'intersect'))).toBeCloseTo(600, 0);
  expect(booleanPaths([a, b], 'exclude')).toEqual([]);
});
it('flattens curves with the shared tolerance', () => {
  const curved = square('a');
  curved.paths[0].segments[0] = { type: 'C', c1: { x: 3, y: -3 }, c2: { x: 7, y: -3 }, to: { x: 10, y: 0 } };
  const paths = booleanPaths([curved, { ...curved, id: 'b' }], 'union');
  expect(paths[0].segments.length).toBeGreaterThan(4);
  expect(area(paths)).toBeGreaterThan(100);
});
it('rejects open, empty, nonfinite, degenerate, unsupported and locked operands', () => {
  const open = square('open');
  open.paths[0].closed = false;
  const invalid = square('invalid');
  invalid.paths[0].start.x = NaN;
  const empty = square('empty');
  empty.paths = [];
  const degenerate = square('point', 0, 0, 0);
  for (const object of [open, invalid, empty, degenerate, { ...square('lock'), locked: true }])
    expect(() => booleanPaths([square('a'), object], 'union')).toThrow();
  expect(() =>
    booleanPaths([square('a'), { ...square('b'), kind: 'image' } as unknown as VectorObject], 'union'),
  ).toThrow(/vector/);
});
it('uses selection order and preserves the base layer, properties, unrelated objects and input', () => {
  const a = square('a');
  const b = { ...square('b', 5), layerId: 'other', drawn: true };
  const p = {
    ...project([a, b, square('unrelated', 30)]),
    layers: [...project().layers, defaultLayer({ id: 'other', mode: 'fill' })],
  };
  const result = booleanObjects(p, ['b', 'a'], 'subtract', 'result');
  expect(result.object).toMatchObject({ layerId: 'other', drawn: true, transform: IDENTITY });
  expect(area(result.object!.paths)).toBeCloseTo(50);
  expect(result.project.objects.find((o) => o.id === 'unrelated')).toBe(p.objects[2]);
  expect(p.objects).toHaveLength(3);
  expect(() => booleanObjects(p, ['a', 'b'], 'union', 'a')).toThrow(/ID/);
  expect(() => booleanObjects(p, ['a', 'missing'], 'union', 'result')).toThrow();
});
it.each(['union', 'subtract', 'intersect', 'exclude'] as const)(
  '%s commits exactly one undo step and supports redo',
  (op) => {
    const before = editor.project;
    editor.select(['b', 'a']);
    booleanSelection(op);
    const after = editor.project;
    expect(after).not.toBe(before);
    expect(editor.selection.size).toBe(1);
    editor.undo();
    expect(editor.project).toEqual(before);
    expect(editor.canUndo).toBe(false);
    editor.redo();
    expect(editor.project).toEqual(after);
  },
);
it('empty results delete operands in one undoable step', () => {
  editor.open(project([square('a'), square('b')]));
  editor.select(['a', 'b']);
  booleanSelection('exclude');
  expect(editor.project?.objects).toEqual([]);
  expect(editor.selection.size).toBe(0);
  editor.undo();
  expect(editor.project?.objects).toHaveLength(2);
  editor.redo();
  expect(editor.project?.objects).toHaveLength(0);
});
it('locked selection rejects the entire operation without a history entry', () => {
  editor.open(project([square('a'), { ...square('b'), locked: true }]));
  editor.select(['a', 'b']);
  const before = editor.project;
  expect(booleanSelectionIssue()).toMatch(/locked/);
  booleanSelection('union');
  expect(editor.project).toBe(before);
  expect(editor.canUndo).toBe(false);
});

it('keeps disconnected intersection regions', () => {
  const compound = square('compound');
  compound.paths.push(
    ...square('island').paths.map((p) => ({
      ...p,
      start: { x: 20, y: 0 },
      segments: p.segments.map((s) => ({ ...s, to: { x: s.to.x + 20, y: s.to.y } })),
    })),
  );
  const result = booleanPaths([compound, square('cover', 0, 0, 40)], 'intersect');
  expect(result).toHaveLength(2);
  expect(area(result)).toBeCloseTo(200);
});
it('does not mutate or record history for unsupported or open selections', () => {
  const open = square('b');
  open.paths[0].closed = false;
  editor.open(project([square('a'), open]));
  editor.select(['a', 'b']);
  const before = editor.project;
  expect(booleanSelectionIssue()).toMatch(/open/);
  booleanSelection('subtract');
  expect(editor.project).toBe(before);
  expect(editor.canUndo).toBe(false);
});

it('XOR of three overlapping objects retains odd-covered areas', () => {
  expect(area(booleanPaths([square('a'), square('b', 5), square('c', 7)], 'exclude'))).toBeCloseTo(100);
});
it('rejects invisible layers and repeated operands atomically', () => {
  const p = project();
  p.layers[0].visible = false;
  expect(() => booleanObjects(p, ['a', 'b'], 'union', 'result')).toThrow(/visible/);
  expect(() => booleanObjects(project(), ['a', 'a'], 'union', 'result')).toThrow(/distinct/);
});
