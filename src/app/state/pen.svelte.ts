import { IDENTITY, type Vec2 } from 'libopenlaser/geometry';
import { makeId } from 'libopenlaser/project';
import { editor } from './editor.svelte';

class Pen {
  points = $state<Vec2[]>([]);
  add(point: Vec2) {
    this.points = [...this.points, point];
  }
  finish(closed = false) {
    const points = this.points;
    if (points.length < (closed ? 3 : 2)) return;
    editor.addOnLayer('line', (layerId) => [
      {
        id: makeId(),
        kind: 'vector',
        name: closed ? 'Drawn shape' : 'Drawn path',
        layerId,
        visible: true,
        locked: false,
        transform: IDENTITY,
        paths: [{ start: points[0], segments: points.slice(1).map((to) => ({ type: 'L', to })), closed }],
      },
    ]);
    this.points = [];
    editor.tool = 'node';
  }
}
export const pen = new Pen();
