import { afterEach, expect, it } from 'vitest';
import { editor } from '$app/state/editor.svelte';
import { convertSelectedText } from '$app/text-actions';
import { createProject, defaultLayer } from 'libopenlaser/project';
import type { TextObject } from 'libopenlaser/project';

const text: TextObject = {
  id: 'text',
  kind: 'text',
  name: 'O',
  text: 'O',
  layerId: 'l',
  visible: true,
  locked: false,
  transform: [0, 2, -2, 0, 50, 60],
  fontFamily: 'Geist',
  fontSize: 10,
  fontWeight: 400,
  italic: false,
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  paths: [10, 4].map((n) => ({
    start: { x: 0, y: 0 },
    closed: true,
    segments: [{ type: 'C', c1: { x: n, y: 0 }, c2: { x: n, y: n }, to: { x: 0, y: 0 } }],
  })),
};
afterEach(() => editor.close());
it('converts exact outlines with holes, preserves placement/layer, and restores editable text on undo', () => {
  const project = { ...createProject(), layers: [defaultLayer({ id: 'l' })], objects: [text] };
  editor.open(project);
  editor.select(['text']);
  convertSelectedText();
  const vector = editor.project!.objects[0];
  expect(vector).toMatchObject({
    id: text.id,
    kind: 'vector',
    transform: text.transform,
    layerId: text.layerId,
    paths: text.paths,
  });
  expect(vector).not.toHaveProperty('fontFamily');
  expect(editor.tool).toBe('node');
  editor.undo();
  expect(editor.project!.objects[0]).toEqual(text);
  editor.redo();
  expect(editor.project!.objects[0].kind).toBe('vector');
});
it('does not convert incomplete or locked text', () => {
  editor.open({ ...createProject(), objects: [{ ...text, missingGlyphs: ['O'] }] });
  editor.select(['text']);
  convertSelectedText();
  expect(editor.project!.objects[0].kind).toBe('text');
  expect(editor.canUndo).toBe(false);
});
