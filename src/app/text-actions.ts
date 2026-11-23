/** Text conversion and baseline attachment, each as one undoable operation. */
import { IDENTITY, apply, invert, multiply } from 'libopenlaser/geometry';
import type { PathData } from 'libopenlaser/geometry';
import type { SceneObject, TextObject, VectorObject, TextModifier } from 'libopenlaser/project';
import { booleanPaths, makeId } from 'libopenlaser/project';
import { sections } from './state/sections.svelte';
import { toast } from '$lib/ui/toasts.svelte';
import { editor } from './state/editor.svelte';
import { canvas } from './state/canvas.svelte';
import { textOutlines } from './state/text.svelte';

export function textAsVector(text: TextObject): VectorObject {
  return {
    id: text.id,
    kind: 'vector',
    layerId: text.layerId,
    name: text.name,
    locked: text.locked,
    visible: text.visible,
    transform: text.transform,
    paths: text.paths,
  };
}

export function convertSelectedText(): void {
  const selected = editor.project?.objects.filter((o) => editor.selection.has(o.id)) ?? [];
  const texts = selected.filter((o): o is TextObject => o.kind === 'text' && !o.locked && o.visible);
  if (!texts.length) return;
  if (
    texts.some(
      (o) => textOutlines.pending.has(o.id) || o.outlineDirty || !o.paths.length || o.missingGlyphs?.length,
    )
  ) {
    toast.warning('Wait for complete font outlines before converting text.');
    return;
  }
  const ids = new Set(texts.map((o) => o.id));
  editor.sealHistory();
  editor.commit((p) => ({
    ...p,
    objects: p.objects.map((o) => (o.kind === 'text' && ids.has(o.id) ? textAsVector(o) : o)),
  }));
  canvas.editingTextId = null;
  editor.select(ids);
  editor.tool = 'node';
}

export function canAttachTextToPath(selected: SceneObject[]): boolean {
  return (
    selected.length === 2 &&
    selected.every((o) => !o.locked && o.visible) &&
    selected.filter((o) => o.kind === 'text').length === 1 &&
    selected.some((o) => o.kind === 'vector' && o.paths.length === 1 && o.paths[0].segments.length > 0)
  );
}

export function attachTextToPath(): void {
  const selected = editor.project?.objects.filter((o) => editor.selection.has(o.id)) ?? [];
  if (!canAttachTextToPath(selected)) return;
  const text = selected.find((o): o is TextObject => o.kind === 'text')!;
  const vector = selected.find((o): o is VectorObject => o.kind === 'vector')!;
  const inverse = invert(text.transform);
  if (!inverse) return;
  const matrix = multiply(inverse, vector.transform);
  const map = (point: { x: number; y: number }) => apply(matrix, point);
  const source = vector.paths[0];
  const path: PathData = {
    ...source,
    start: map(source.start),
    segments: source.segments.map((s) =>
      s.type === 'C' ? { ...s, to: map(s.to), c1: map(s.c1), c2: map(s.c2) } : { ...s, to: map(s.to) },
    ),
  };
  textOutlines.update(text.id, {
    pathLayout: { path, guideId: vector.id, offset: 0, normalOffset: 0, reverse: false },
  });
  canvas.editingTextId = null;
  editor.select([text.id]);
  editor.tool = 'select';
}

export function detachTextFromPath(text: TextObject): void {
  // Keep the object's frame; its editable straight outlines refresh asynchronously.
  textOutlines.update(text.id, { pathLayout: undefined, arcAngle: 0 });
}

/** The outliner has already merged overlapping glyphs; normalize evaluated contours once more. */
export function weldSelectedText(): void {
  const texts =
    editor.project?.objects.filter(
      (o): o is TextObject => editor.selection.has(o.id) && o.kind === 'text' && !o.locked && o.visible,
    ) ?? [];
  if (!texts.length) return;
  try {
    if (
      texts.some(
        (o) => textOutlines.pending.has(o.id) || o.outlineDirty || !o.paths.length || o.missingGlyphs?.length,
      )
    )
      throw new Error('Wait for complete font outlines before welding text.');
    const vectors = new Map(
      texts.map((text) => {
        const vector = textAsVector(text);
        const local = { ...vector, transform: IDENTITY };
        return [text.id, { ...vector, paths: booleanPaths([local, local], 'union') }] as const;
      }),
    );
    editor.sealHistory();
    editor.commit((p) => ({ ...p, objects: p.objects.map((o) => vectors.get(o.id) ?? o) }));
    canvas.editingTextId = null;
    editor.tool = 'node';
  } catch (error) {
    toast.warning(error instanceof Error ? error.message : 'Unable to weld text geometry.');
  }
}

export function focusTextProperty(label: string): void {
  const text = editor.project?.objects.find((o) => editor.selection.has(o.id) && o.kind === 'text');
  if (!text || text.locked) return;
  const parent = editor.project?.groups?.find((g) => g.children.includes(text.id));
  if (parent && editor.groupScope !== parent.id) editor.enterGroup(parent.id);
  editor.select([text.id]);
  editor.tool = 'select';
  sections.set('inspector', true);
  // Menu dismissal restores canvas focus first, then the requested existing property takes focus.
  setTimeout(() => {
    const panel = document.querySelector('[data-testid="text-inspector"]');
    const control = Array.from(
      panel?.querySelectorAll<HTMLElement>('input, textarea, select, button') ?? [],
    ).find((element) =>
      label === 'Search fonts'
        ? element.getAttribute('data-testid') === 'font-picker'
        : element.getAttribute('aria-label') === label,
    );
    if (label === 'Search fonts') control?.click();
    control?.scrollIntoView({ block: 'nearest' });
    control?.focus();
  }, 100);
}

export function addTextModifier(type: 'curve' | 'warp'): void {
  const texts =
    editor.project?.objects.filter(
      (o): o is TextObject => editor.selection.has(o.id) && o.kind === 'text' && !o.locked,
    ) ?? [];
  if (!texts.length) return;
  const changes = new Map<string, { modifiers: TextModifier[] }>();
  for (const text of texts)
    changes.set(text.id, {
      modifiers: [
        ...(text.modifiers ?? []),
        type === 'curve'
          ? { id: makeId(), type, enabled: true, parameters: { intensity: 0.25 } }
          : { id: makeId(), type, enabled: true, parameters: { preset: 'wave', intensity: 0.2 } },
      ],
    });
  textOutlines.updateMany(changes);
}
