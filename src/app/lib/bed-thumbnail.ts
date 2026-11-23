/**
 * A small map of the bed for Bitmap mode: where the image being edited sits among everything
 * else, drawn the way the Design canvas draws it (same origin corner and axis directions).
 */
import { apply } from 'libopenlaser/geometry';
import type { Vec2 } from 'libopenlaser/geometry';
import type { Id, Project } from 'libopenlaser/project';
import { bedToScreenMatrix, type BedFrame } from '../canvas/viewport';
import { boundsOf } from './selection';

export interface ThumbShape {
  id: Id;
  /** Corners in thumbnail px: an image's four (rotation included), another object's bounds. */
  points: Vec2[];
  /** The layer color. */
  color: string;
  image: boolean;
}

export interface BedThumbnail {
  width: number;
  height: number;
  /** Everything visible except `current`, drawn first. */
  shapes: ThumbShape[];
  current: ThumbShape | null;
  /** Machine 0,0 in thumbnail px. */
  origin: Vec2;
}

/** Below this size in px the current image also gets a ring, so a small image stays findable. */
export const RING_BELOW = 8;

/** Lays out the bed at the largest size fitting `box`, keeping its proportions. */
export function bedThumbnail(
  project: Project,
  bed: BedFrame,
  box: { width: number; height: number },
  currentId: Id | null,
): BedThumbnail {
  const zoom = Math.min(box.width / bed.width, box.height / bed.height);
  const toThumb = bedToScreenMatrix({ zoom, offsetX: 0, offsetY: 0 }, bed);
  const layers = new Map(project.layers.map((l) => [l.id, l]));
  const shapes: ThumbShape[] = [];
  let current: ThumbShape | null = null;
  for (const object of project.objects) {
    const layer = layers.get(object.layerId);
    if (!object.visible || !layer?.visible) continue;
    let corners: Vec2[];
    if (object.kind === 'image') {
      const { width: w, height: h } = object;
      corners = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ].map((p) => apply(object.transform, p));
    } else {
      const b = boundsOf([object]);
      if (!b) continue;
      corners = [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
      ];
    }
    const shape: ThumbShape = {
      id: object.id,
      points: corners.map((p) => apply(toThumb, p)),
      color: layer.color,
      image: object.kind === 'image',
    };
    if (object.id === currentId) current = shape;
    else shapes.push(shape);
  }
  return {
    width: bed.width * zoom,
    height: bed.height * zoom,
    shapes,
    current,
    origin: apply(toThumb, { x: 0, y: 0 }),
  };
}

/** SVG `points` attribute for a shape. */
export function svgPoints(points: Vec2[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/** Centre and size of a shape's box in px, for the ring around a small current image. */
export function shapeBox(points: Vec2[]): { cx: number; cy: number; size: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: Math.max(maxX - minX, maxY - minY) };
}
