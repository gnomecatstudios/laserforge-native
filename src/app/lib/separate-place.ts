/**
 * Turns a color separation (see `separateRaster`) into project changes: the selected part moves
 * to a layer of its own, is erased, or is all that is kept. Every part is placed exactly where its
 * pixels were, so the parts stack back into the original picture.
 */
import { multiply, translation } from 'libopenlaser/geometry';
import { addLayer, removeObjects, removeUnusedAssets } from 'libopenlaser/project';
import type { Asset, Id, ImageObject, Layer, MakeId, Project } from 'libopenlaser/project';
import type { SeparatedPart, SeparateResult } from '$lib/workers/protocol';

/**
 * - `layer`: the selection moves to a new layer above the image's own; the rest stays.
 * - `remove`: the selection is erased (made transparent).
 * - `keep`: everything but the selection is erased.
 */
export type SeparateMode = 'layer' | 'remove' | 'keep';

export interface SeparationOutcome {
  project: Project;
  /** Objects holding the selection (empty when it was erased). */
  pieceIds: Id[];
  /** The image's remaining object, or null when nothing of it is left. */
  restId: Id | null;
  /** The new layer, for `layer`. */
  layerId: Id | null;
}

/** The part of `image` that `part` covers, as an object of its own with a new asset. */
export function partObject(
  image: ImageObject,
  result: Pick<SeparateResult, 'sourceWidth' | 'sourceHeight'>,
  part: SeparatedPart,
  ids: { object: Id; asset: Id },
  name: string,
  layerId: Id,
): { object: ImageObject; asset: Asset } {
  const sx = image.width / result.sourceWidth;
  const sy = image.height / result.sourceHeight;
  // Object space is Y-up with bitmap row 0 at the top edge (y = height).
  const offset = translation(part.x * sx, (result.sourceHeight - part.y - part.height) * sy);
  return {
    object: {
      ...image,
      id: ids.object,
      name,
      layerId,
      assetId: ids.asset,
      width: part.width * sx,
      height: part.height * sy,
      transform: multiply(image.transform, offset),
    },
    asset: {
      id: ids.asset,
      mime: 'image/png',
      name: `${name}.png`,
      data: part.blob,
      widthPx: part.width,
      heightPx: part.height,
    },
  };
}

/** "photo.jpg" → "photo". */
export const baseName = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '') || name;

export function placeSeparation(
  project: Project,
  imageId: Id,
  result: SeparateResult,
  mode: SeparateMode,
  makeId: MakeId,
  newLayer: (source: Layer) => Layer,
): SeparationOutcome {
  const image = project.objects.find((o): o is ImageObject => o.id === imageId && o.kind === 'image');
  if (!image) throw new Error('The image is no longer in the project.');
  const source = project.layers.find((l) => l.id === image.layerId);
  const name = baseName(image.name);
  const make = (part: SeparatedPart, label: string, layerId: Id, objectId = makeId()) =>
    partObject(image, result, part, { object: objectId, asset: makeId() }, label, layerId);

  // What stays in the image's own object: the rest, or for `keep` the largest piece.
  const kept = mode === 'keep' ? result.pieces[0] : result.rest;
  const replacement = kept ? make(kept, image.name, image.layerId, image.id) : null;
  const pieceLabel = (i: number, n: number) => (n > 1 ? `${name} part ${i + 1}` : `${name} part`);

  let layer: Layer | null = null;
  const extra: Array<{ object: ImageObject; asset: Asset }> = [];
  if (mode === 'layer' && result.pieces.length > 0) {
    if (!source) throw new Error('The image has no layer.');
    layer = newLayer(source);
    const target = layer.id;
    result.pieces.forEach((p, i) => extra.push(make(p, pieceLabel(i, result.pieces.length), target)));
  } else if (mode === 'keep') {
    const others = result.pieces.slice(1);
    others.forEach((p, i) => extra.push(make(p, pieceLabel(i + 1, result.pieces.length), image.layerId)));
  }

  let next = project;
  if (layer && source) next = addLayer(next, layer, next.layers.indexOf(source) + 1);
  const assets = { ...next.assets };
  for (const part of [replacement, ...extra]) if (part) assets[part.asset.id] = part.asset;
  // The new objects sit just above the image, so the stacking order stays the picture's.
  const objects = next.objects.flatMap((o) =>
    o.id === image.id ? [...(replacement ? [replacement.object] : []), ...extra.map((e) => e.object)] : [o],
  );
  next = { ...next, assets, objects };
  // removeObjects also prunes the image from any group it was in.
  next = replacement ? removeUnusedAssets(next) : removeObjects(next, new Set([image.id]));
  return {
    project: next,
    pieceIds:
      mode === 'keep'
        ? (replacement ? [image.id] : []).concat(extra.map((e) => e.object.id))
        : extra.map((e) => e.object.id),
    restId: replacement ? image.id : null,
    layerId: layer?.id ?? null,
  };
}
