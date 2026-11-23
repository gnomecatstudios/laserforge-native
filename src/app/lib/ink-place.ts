/**
 * Puts the result of "Ink only mode" into the project: the photo's object keeps its id, layer
 * and place, but now shows the ink alone, cropped to the drawing and sitting exactly where the
 * drawing was on the photo. One undo step brings the photo back.
 */
import { removeUnusedAssets } from 'libopenlaser/project';
import type { Id, ImageObject, MakeId, Project } from 'libopenlaser/project';
import type { InkResult } from '$lib/workers/protocol';
import { baseName, partObject } from './separate-place';

export function placeInk(project: Project, imageId: Id, result: InkResult, makeId: MakeId): Project {
  const image = project.objects.find((o): o is ImageObject => o.id === imageId && o.kind === 'image');
  if (!image) throw new Error('The image is no longer in the project.');
  if (!result.ink) throw new Error('No ink was found in the image.');
  const { object, asset } = partObject(
    image,
    result,
    result.ink,
    { object: image.id, asset: makeId() },
    image.name,
    image.layerId,
  );
  asset.name = `${baseName(image.name)} ink.png`;
  return removeUnusedAssets({
    ...project,
    assets: { ...project.assets, [asset.id]: asset },
    objects: project.objects.map((o) => (o.id === image.id ? object : o)),
  });
}
