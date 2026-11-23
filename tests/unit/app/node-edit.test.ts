import { describe, it, expect } from 'vitest';
import { moveNode, pathNodes } from '../../../src/app/canvas/node-edit';
import type { PathData } from 'libopenlaser/geometry';
const path: PathData = {
  start: { x: 0, y: 0 },
  closed: true,
  segments: [
    { type: 'C', c1: { x: 1, y: 0 }, c2: { x: 4, y: 5 }, to: { x: 5, y: 5 } },
    { type: 'C', c1: { x: 6, y: 5 }, c2: { x: 0, y: 1 }, to: { x: 0, y: 0 } },
  ],
};
describe('node editing', () => {
  it('deduplicates the closing anchor and exposes cubic handles', () => {
    expect(pathNodes([path]).filter((n) => !n.control)).toHaveLength(2);
    expect(pathNodes([path]).filter((n) => n.control)).toHaveLength(4);
  });
  it('moves the closing anchor and both adjacent handles without mutating the source', () => {
    const [next] = moveNode([path], { path: 0, index: -1 }, { x: 2, y: 3 });
    expect(next.start).toEqual({ x: 2, y: 3 });
    expect(next.segments[1].to).toEqual(next.start);
    expect(next.segments[0]).toMatchObject({ c1: { x: 3, y: 3 } });
    expect(next.segments[1]).toMatchObject({ c2: { x: 2, y: 4 } });
    expect(path.start).toEqual({ x: 0, y: 0 });
  });
  it('moves a curve handle independently', () => {
    const [next] = moveNode([path], { path: 0, index: 0, control: 'c1' }, { x: 8, y: 9 });
    expect(next.segments[0]).toMatchObject({ c1: { x: 8, y: 9 }, c2: { x: 4, y: 5 }, to: { x: 5, y: 5 } });
  });
});

import { insertNode } from '../../../src/app/canvas/node-edit';
import { cubicPoint } from 'libopenlaser/geometry';
it('splits cubic curves exactly without changing their geometry', () => {
  const [next] = insertNode([path], 0, 0, 0.4);
  expect(next.segments).toHaveLength(3);
  const left = next.segments[0],
    right = next.segments[1],
    original = path.segments[0];
  if (left.type !== 'C' || right.type !== 'C' || original.type !== 'C')
    throw new Error('Expected cubic segments');
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const expected = cubicPoint(path.start, original.c1, original.c2, original.to, t);
    const actual =
      t <= 0.4
        ? cubicPoint(path.start, left.c1, left.c2, left.to, t / 0.4)
        : cubicPoint(left.to, right.c1, right.c2, right.to, (t - 0.4) / 0.6);
    expect(actual.x).toBeCloseTo(expected.x, 10);
    expect(actual.y).toBeCloseTo(expected.y, 10);
  }
});
it('splits implicit closing lines and refuses endpoint duplicates', () => {
  const p: PathData = {
    start: { x: 0, y: 0 },
    closed: true,
    segments: [
      { type: 'L', to: { x: 10, y: 0 } },
      { type: 'L', to: { x: 10, y: 10 } },
    ],
  };
  const paths = [p];
  expect(insertNode(paths, 0, 2, 0.5)[0].segments[2].to).toEqual({ x: 5, y: 5 });
  expect(insertNode(paths, 0, 0, 0)).toBe(paths);
  expect(p.segments).toHaveLength(2);
});

import { deleteNode } from '../../../src/app/canvas/node-edit';
describe('deleting nodes', () => {
  const square: PathData = {
    start: { x: 0, y: 0 },
    closed: true,
    segments: [
      { type: 'L', to: { x: 10, y: 0 } },
      { type: 'L', to: { x: 10, y: 10 } },
      { type: 'L', to: { x: 0, y: 10 } },
    ],
  };
  const anchors = (p: PathData) =>
    pathNodes([p])
      .filter((n) => !n.control)
      .map((n) => n.point);
  it('removes a middle anchor of a closed path, keeping closure implicit', () => {
    const [next] = deleteNode([square], { path: 0, index: 0 });
    expect(anchors(next)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(next.closed).toBe(true);
    expect(next.segments).toHaveLength(2);
    expect(square.segments).toHaveLength(3);
  });
  it('removes the start anchor of a closed path', () => {
    const [next] = deleteNode([square], { path: 0, index: -1 });
    expect(anchors(next)).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });
  it('removes the start anchor of an explicitly closed cubic path and re-closes it', () => {
    const tri: PathData = {
      ...path,
      segments: [
        ...path.segments.slice(0, 1),
        { type: 'L', to: { x: 0, y: 5 } },
        { type: 'C', c1: { x: -1, y: 4 }, c2: { x: -1, y: 1 }, to: { x: 0, y: 0 } },
      ],
    };
    const [next] = deleteNode([tri], { path: 0, index: -1 });
    expect(next.start).toEqual({ x: 5, y: 5 });
    expect(next.segments.at(-1)).toMatchObject({
      type: 'C',
      c1: { x: -1, y: 4 },
      c2: { x: 4, y: 5 },
      to: { x: 5, y: 5 },
    });
    expect(pathNodes([next]).filter((n) => !n.control)).toHaveLength(2);
  });
  it('trims open path ends and joins middle segments', () => {
    const open: PathData = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        { type: 'L', to: { x: 5, y: 0 } },
        { type: 'C', c1: { x: 6, y: 1 }, c2: { x: 9, y: 1 }, to: { x: 10, y: 0 } },
      ],
    };
    expect(deleteNode([open], { path: 0, index: -1 })[0]).toMatchObject({ start: { x: 5, y: 0 } });
    expect(deleteNode([open], { path: 0, index: 1 })[0].segments).toHaveLength(1);
    expect(deleteNode([open], { path: 0, index: 0 })[0].segments).toEqual([
      { type: 'C', c1: { x: 0, y: 0 }, c2: { x: 9, y: 1 }, to: { x: 10, y: 0 } },
    ]);
  });
  it('refuses to leave fewer than two anchors or to delete handles', () => {
    const line: PathData = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [{ type: 'L', to: { x: 1, y: 1 } }],
    };
    const paths = [line];
    expect(deleteNode(paths, { path: 0, index: 0 })).toBe(paths);
    expect(deleteNode([path], { path: 0, index: 0, control: 'c1' })[0]).toBe(path);
  });
});
