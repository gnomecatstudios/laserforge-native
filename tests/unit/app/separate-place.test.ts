import { describe, expect, it } from 'vitest';
import { apply } from 'libopenlaser/geometry';
import { createProject, defaultLayer } from 'libopenlaser/project';
import type { ImageObject, Layer, Project } from 'libopenlaser/project';
import { baseName, placeSeparation } from '$app/lib/separate-place';
import type { SeparateResult, SeparatedPart } from '$lib/workers/protocol';

const blob = new Blob([]);
const part = (x: number, y: number, width: number, height: number): SeparatedPart => ({
  x,
  y,
  width,
  height,
  blob,
});

function setup(): { project: Project; image: ImageObject } {
  let n = 0;
  const base = createProject({ name: 'Test', id: () => `p${n++}` });
  const layer = defaultLayer({ id: 'L1', mode: 'image', name: 'Photo' });
  const image: ImageObject = {
    id: 'img',
    kind: 'image',
    layerId: 'L1',
    name: 'photo.jpg',
    locked: false,
    visible: true,
    // 100 × 50 px shown at 50 × 25 mm, placed at (10, 20).
    transform: [1, 0, 0, 1, 10, 20],
    assetId: 'a0',
    width: 50,
    height: 25,
  };
  const project: Project = {
    ...base,
    layers: [layer, defaultLayer({ id: 'L2', mode: 'line' })],
    objects: [image, { ...image, id: 'other', assetId: 'a1' }],
    assets: {
      a0: { id: 'a0', mime: 'image/jpeg', name: 'photo.jpg', data: blob, widthPx: 100, heightPx: 50 },
      a1: { id: 'a1', mime: 'image/jpeg', name: 'other.jpg', data: blob, widthPx: 100, heightPx: 50 },
    },
  };
  return { project, image };
}

const ids = () => {
  let n = 0;
  return () => `n${n++}`;
};
const newLayer = (source: Layer): Layer => ({ ...source, id: 'NEW', name: 'Image 2' });
const result = (pieces: SeparatedPart[], rest: SeparatedPart | null): SeparateResult => ({
  sourceWidth: 100,
  sourceHeight: 50,
  pieces,
  rest,
});

describe('placeSeparation', () => {
  it('moves the selection to a new layer exactly where its pixels were', () => {
    const { project } = setup();
    // A piece covering px (20..60, 10..30): top-left corner of the image is px (0, 0).
    const out = placeSeparation(
      project,
      'img',
      result([part(20, 10, 40, 20)], part(0, 0, 100, 50)),
      'layer',
      ids(),
      newLayer,
    );
    expect(out.layerId).toBe('NEW');
    expect(out.project.layers.map((l) => l.id)).toEqual(['L1', 'NEW', 'L2']);
    const piece = out.project.objects.find((o) => o.id === out.pieceIds[0]) as ImageObject;
    expect(piece.layerId).toBe('NEW');
    expect(piece.name).toBe('photo part');
    expect(piece.width).toBeCloseTo(20);
    expect(piece.height).toBeCloseTo(10);
    // Bottom-left of the piece: px x = 20 → 10 mm; px bottom row 30 → 20 px above the image bottom → 10 mm.
    expect(apply(piece.transform, { x: 0, y: 0 })).toEqual({ x: 20, y: 30 });
    expect(out.project.assets[piece.assetId]).toMatchObject({ mime: 'image/png', widthPx: 40, heightPx: 20 });
    // The piece stacks right above the image, below later objects.
    expect(out.project.objects.map((o) => o.id)).toEqual(['img', piece.id, 'other']);
    // The image keeps its id but now shows the rest; the old asset is gone.
    const rest = out.project.objects.find((o) => o.id === 'img') as ImageObject;
    expect(rest.assetId).not.toBe('a0');
    expect(out.project.assets.a0).toBeUndefined();
    expect(out.project.assets.a1).toBeDefined();
    expect(out.restId).toBe('img');
  });

  it('puts every area on the new layer when split into regions', () => {
    const { project } = setup();
    const out = placeSeparation(
      project,
      'img',
      result([part(0, 0, 10, 10), part(80, 0, 20, 10)], part(0, 0, 100, 50)),
      'layer',
      ids(),
      newLayer,
    );
    expect(out.pieceIds).toHaveLength(2);
    const names = out.project.objects.filter((o) => o.layerId === 'NEW').map((o) => o.name);
    expect(names).toEqual(['photo part 1', 'photo part 2']);
  });

  it('erases the selection, removing the image when nothing is left', () => {
    const { project } = setup();
    const erased = placeSeparation(
      project,
      'img',
      result([part(0, 0, 10, 10)], part(10, 0, 90, 50)),
      'remove',
      ids(),
      newLayer,
    );
    expect(erased.pieceIds).toEqual([]);
    expect(erased.project.layers).toHaveLength(2);
    const rest = erased.project.objects.find((o) => o.id === 'img') as ImageObject;
    expect(rest.width).toBeCloseTo(45);
    expect(apply(rest.transform, { x: 0, y: 0 })).toEqual({ x: 15, y: 20 });

    const gone = placeSeparation(
      project,
      'img',
      result([part(0, 0, 100, 50)], null),
      'remove',
      ids(),
      newLayer,
    );
    expect(gone.restId).toBeNull();
    expect(gone.project.objects.map((o) => o.id)).toEqual(['other']);
    expect(gone.project.assets.a0).toBeUndefined();
  });

  it('keeps only the selection on the image’s own layer', () => {
    const { project } = setup();
    const out = placeSeparation(
      project,
      'img',
      result([part(0, 0, 10, 10), part(50, 0, 10, 10)], part(0, 0, 100, 50)),
      'keep',
      ids(),
      newLayer,
    );
    expect(out.layerId).toBeNull();
    expect(out.pieceIds[0]).toBe('img');
    expect(out.pieceIds).toHaveLength(2);
    expect(out.project.objects.filter((o) => o.layerId === 'L1').map((o) => o.id)).toEqual([
      'img',
      out.pieceIds[1],
      'other',
    ]);
    expect((out.project.objects[0] as ImageObject).width).toBeCloseTo(5);
  });

  it('names parts after the file without its extension', () => {
    expect(baseName('photo.jpeg')).toBe('photo');
    expect(baseName('logo')).toBe('logo');
  });
});
