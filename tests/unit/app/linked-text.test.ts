import { afterEach, expect, it } from 'vitest';
import { editor } from '$app/state/editor.svelte';
import { syncLinkedText } from '$app/lib/linked-text';
import { createProject } from 'libopenlaser/project';
import type { TextObject, VectorObject } from 'libopenlaser/project';

const path = {
  start: { x: 0, y: 0 },
  closed: false,
  segments: [{ type: 'C' as const, c1: { x: 10, y: 20 }, c2: { x: 30, y: 20 }, to: { x: 40, y: 0 } }],
};
const guide: VectorObject = {
  id: 'g',
  kind: 'vector',
  name: 'Guide',
  layerId: 'l',
  locked: false,
  visible: true,
  transform: [1, 0, 0, 1, 10, 20],
  paths: [path],
};
const text: TextObject = {
  ...guide,
  id: 't',
  kind: 'text',
  text: 'Laser',
  fontFamily: 'Geist',
  fontSize: 10,
  fontWeight: 400,
  italic: false,
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  outlineVersion: 4,
  pathLayout: { guideId: 'g', path, offset: 3, normalOffset: 2, reverse: false },
};
afterEach(() => editor.close());
it('updates a linked baseline in text space and restores the cache and curve on undo', () => {
  const p = { ...createProject(), objects: [guide, text] };
  expect(syncLinkedText(p)).toBe(p);
  editor.open(p);
  editor.commit((p) => ({
    ...p,
    objects: p.objects.map((o) => (o.id === 'g' ? { ...guide, transform: [0, 1, -1, 0, 30, 40] } : o)),
  }));
  const linked = editor.project!.objects[1] as TextObject;
  expect(linked.pathLayout).toMatchObject({
    guideId: 'g',
    offset: 3,
    normalOffset: 2,
    path: {
      start: { x: 20, y: 20 },
      segments: [{ c1: { x: 0, y: 30 }, c2: { x: 0, y: 50 }, to: { x: 20, y: 60 } }],
    },
  });
  expect(linked.paths).toEqual([]);
  expect(linked.outlineVersion).toBeUndefined();
  editor.undo();
  expect(editor.project!.objects[1]).toEqual(text);
  editor.redo();
  expect((editor.project!.objects[1] as TextObject).pathLayout).toEqual(linked.pathLayout);
});
it('keeps the last baseline when the guide is deleted or is no longer a single path', () => {
  for (const objects of [[text], [{ ...guide, paths: [] }, text]]) {
    const p = { ...createProject(), objects };
    expect(syncLinkedText(p)).toBe(p);
  }
});
