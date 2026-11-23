import type { PathData, Vec2 } from 'libopenlaser/geometry';

export interface NodeRef {
  path: number;
  index: number;
  control?: 'c1' | 'c2';
}

export function pathNodes(paths: PathData[]): (NodeRef & { point: Vec2 })[] {
  return paths.flatMap((p, path) => {
    const nodes: (NodeRef & { point: Vec2 })[] = [{ path, index: -1, point: p.start }];
    p.segments.forEach((s, index) => {
      const closing =
        p.closed && index === p.segments.length - 1 && s.to.x === p.start.x && s.to.y === p.start.y;
      if (!closing) nodes.push({ path, index, point: s.to });
      if (s.type === 'C') {
        nodes.push({ path, index, control: 'c1', point: s.c1 }, { path, index, control: 'c2', point: s.c2 });
      }
    });
    return nodes;
  });
}

/** Move an anchor with its adjacent handles; preserve explicit closing endpoints. */
export function moveNode(paths: PathData[], node: NodeRef, to: Vec2): PathData[] {
  return paths.map((original, i) => {
    if (i !== node.path) return original;
    const p = { ...original, segments: original.segments.map((segment) => ({ ...segment })) };
    const s = p.segments[node.index];
    if (node.control) {
      if (s?.type === 'C') s[node.control] = to;
      return p;
    }
    const before = node.index === -1 ? p.start : s.to;
    const delta = { x: to.x - before.x, y: to.y - before.y };
    const shift = (v: Vec2) => ({ x: v.x + delta.x, y: v.y + delta.y });
    const last = p.segments.at(-1);
    const closes = p.closed && last?.to.x === p.start.x && last?.to.y === p.start.y;
    if (node.index === -1) {
      if (closes && last) {
        last.to = to;
        if (last.type === 'C') last.c2 = shift(last.c2);
      }
      p.start = to;
    } else {
      s.to = to;
      if (s.type === 'C') s.c2 = shift(s.c2);
    }
    const next = p.segments[node.index + 1];
    if (next?.type === 'C') next.c1 = shift(next.c1);
    return p;
  });
}

/** Split a line or cubic exactly; index === segments.length addresses implicit closure. */
export function insertNode(paths: PathData[], pathIndex: number, index: number, t: number): PathData[] {
  const path = paths[pathIndex];
  if (!path || !Number.isFinite(t) || t <= 1e-6 || t >= 1 - 1e-6 || index < 0 || index > path.segments.length)
    return paths;
  const segment = path.segments[index] ?? (path.closed ? { type: 'L' as const, to: path.start } : null);
  if (!segment) return paths;
  const from = index ? path.segments[index - 1].to : path.start;
  const lerp = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  let pieces: PathData['segments'];
  if (segment.type === 'L') pieces = [{ type: 'L', to: lerp(from, segment.to) }, segment];
  else {
    const a = lerp(from, segment.c1),
      b = lerp(segment.c1, segment.c2),
      c = lerp(segment.c2, segment.to);
    const d = lerp(a, b),
      e = lerp(b, c),
      point = lerp(d, e);
    pieces = [
      { type: 'C', c1: a, c2: d, to: point },
      { type: 'C', c1: e, c2: c, to: segment.to },
    ];
  }
  return paths.map((p, i) =>
    i === pathIndex
      ? { ...p, segments: [...p.segments.slice(0, index), ...pieces, ...p.segments.slice(index + 1)] }
      : p,
  );
}

type Segment = PathData['segments'][number];

/** Join two consecutive segments into one, keeping the outer curve handles. */
function joinSegments(from: Vec2, a: Segment, b: Segment): Segment {
  if (a.type === 'L' && b.type === 'L') return { type: 'L', to: b.to };
  return {
    type: 'C',
    c1: a.type === 'C' ? a.c1 : from,
    c2: b.type === 'C' ? b.c2 : b.to,
    to: b.to,
  };
}

/**
 * Remove one anchor, joining its two neighbouring segments. Curve handles are not deletable.
 * Returns `paths` unchanged when the node is invalid or the path would fall below two anchors.
 */
export function deleteNode(paths: PathData[], node: NodeRef): PathData[] {
  const path = paths[node.path];
  if (!path || node.control) return paths;
  const last = path.segments.at(-1);
  const explicitClose = path.closed && last?.to.x === path.start.x && last?.to.y === path.start.y;
  // Anchors and the segments leaving each one; closed paths wrap around.
  const anchors = [path.start, ...path.segments.map((s) => s.to)];
  const segments = [...path.segments];
  if (explicitClose) anchors.pop();
  else if (path.closed) segments.push({ type: 'L', to: path.start });
  const j = node.index + 1;
  if (j < 0 || j >= anchors.length || anchors.length <= 2) return paths;

  let next: PathData;
  if (!path.closed) {
    if (j === 0) next = { ...path, start: anchors[1], segments: segments.slice(1) };
    else if (j === anchors.length - 1) next = { ...path, segments: segments.slice(0, -1) };
    else {
      const joined = joinSegments(anchors[j - 1], segments[j - 1], segments[j]);
      next = { ...path, segments: [...segments.slice(0, j - 1), joined, ...segments.slice(j + 1)] };
    }
  } else {
    const m = anchors.length;
    const inIndex = (j - 1 + m) % m;
    const joined = joinSegments(anchors[inIndex], segments[inIndex], segments[j]);
    const kept = segments.map((s, i) => (i === inIndex ? joined : s)).filter((_, i) => i !== j);
    const start = j === 0 ? anchors[1] : path.start;
    // Keep an implicit closure implicit when the closing segment is still a straight line.
    const tail = kept.at(-1);
    const result = !explicitClose && tail?.type === 'L' ? kept.slice(0, -1) : kept;
    next = { ...path, start, segments: result };
  }
  return paths.map((p, i) => (i === node.path ? next : p));
}
