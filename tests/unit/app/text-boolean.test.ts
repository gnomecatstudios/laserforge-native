import { afterEach, expect, it } from 'vitest';
import { IDENTITY, flattenPaths, signedArea } from 'libopenlaser/geometry';
import {
  booleanObjects,
  booleanPaths,
  createProject,
  defaultLayer,
  type TextObject,
  type VectorObject,
} from 'libopenlaser/project';
import { editor } from '$app/state/editor.svelte';
import { booleanSelection, booleanSelectionIssue } from '$app/unite';
import { textOutlines } from '$app/state/text.svelte';

const rectangle = (id: string, x = 0, y = 0, size = 10): VectorObject => ({
  id,
  name: id,
  kind: 'vector',
  layerId: 'l',
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
});
const text = (id = 'text'): TextObject => ({
  ...rectangle(id),
  kind: 'text',
  text: 'O',
  fontFamily: 'Geist',
  fontSize: 10,
  fontWeight: 400,
  italic: false,
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  paths: [
    rectangle('outer').paths[0],
    {
      start: { x: 2, y: 2 },
      closed: true,
      segments: [
        { type: 'L', to: { x: 8, y: 2 } },
        { type: 'L', to: { x: 8, y: 8 } },
        { type: 'L', to: { x: 2, y: 8 } },
      ],
    },
  ],
});
const area = (paths: ReturnType<typeof booleanPaths>) =>
  Math.abs(flattenPaths(paths, IDENTITY).reduce((s, p) => s + signedArea(p.points), 0));
afterEach(() => {
  editor.close();
  textOutlines.pending = new Set();
});
it.each(['union', 'subtract', 'intersect', 'exclude'] as const)(
  '%s supports text and compound glyph holes',
  (op) => {
    const glyph = text();
    const cover = rectangle('cover');
    const result = booleanPaths([glyph, cover], op);
    expect(area(result)).toBeCloseTo({ union: 100, subtract: 0, intersect: 64, exclude: 36 }[op]);
  },
);
it('subtracting text preserves its inner island, and operand order is explicit', () => {
  expect(area(booleanPaths([rectangle('cover'), text()], 'subtract'))).toBeCloseTo(36);
  expect(booleanPaths([text(), rectangle('cover')], 'subtract')).toEqual([]);
});
it('supports text-to-text and evaluated multiline/transformed geometry', () => {
  const glyph = { ...text(), text: 'O\nO', transform: [0, 2, -3, 0, 40, 20] as typeof IDENTITY };
  expect(area(booleanPaths([glyph, { ...glyph, id: 'other' }], 'intersect'))).toBeCloseTo(384);
  expect(booleanPaths([glyph, { ...glyph, id: 'other' }], 'exclude')).toEqual([]);
});
it('produces vectors, preserves base layer and restores original editable text in one undo', () => {
  const p = {
    ...createProject(),
    layers: [defaultLayer({ id: 'l', mode: 'fill' })],
    objects: [text(), rectangle('cover')],
  };
  editor.open(p);
  editor.select(['text', 'cover']);
  expect(booleanSelectionIssue()).toBeNull();
  expect(booleanSelection('union')).toBe(true);
  const result = editor.project!;
  expect(result.objects[0]).toMatchObject({ kind: 'vector', layerId: 'l', transform: IDENTITY });
  expect(result.objects[0]).not.toHaveProperty('fontFamily');
  editor.undo();
  expect(editor.project).toEqual(p);
  expect(editor.canUndo).toBe(false);
  editor.redo();
  expect(editor.project).toEqual(result);
});
it('rejects incomplete or pending font geometry without changing sources or history', () => {
  const p = {
    ...createProject(),
    layers: [defaultLayer({ id: 'l' })],
    objects: [text(), rectangle('cover')],
  };
  editor.open(p);
  editor.select(['text', 'cover']);
  textOutlines.pending = new Set(['text']);
  expect(booleanSelection('union')).toBe(false);
  expect(editor.project).toBe(p);
  expect(editor.canUndo).toBe(false);
  expect(() =>
    booleanObjects(
      { ...p, objects: [{ ...text(), missingGlyphs: ['O'] }, rectangle('cover')] },
      ['text', 'cover'],
      'union',
      'r',
    ),
  ).toThrow(/missing glyphs/);
});

it('retains a stale display cache but blocks clipping, print SVG and every CAM encoder input', async () => {
  const { compileJob } = await import('libopenlaser/cam');
  const { compileInput } = await import('../../../packages/libopenlaser/test/unit/cam/fixtures');
  const { designPrintSvg } = await import('$app/lib/print-svg');
  const source = { ...text(), outlineDirty: true };
  const p = { ...createProject(), layers: [defaultLayer({ id: 'l', mode: 'line' })], objects: [source] };
  expect(source.paths.length).toBeGreaterThan(0);
  expect(() => booleanPaths([source, rectangle('cover')], 'union')).toThrow(/stale/);
  const plan = compileJob(compileInput(p));
  expect(plan.toolpaths).toEqual([]);
  expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'text-not-ready', blocking: true }));
  expect(designPrintSvg(p, { bedWidth: 400, bedHeight: 400, originCorner: 'bl' }, () => '')).toBeNull();
});
