/** Keep linked baselines in the text frame. Missing guides retain their last snapshot. */
import { apply, invert, multiply } from 'libopenlaser/geometry';
import type { Project } from 'libopenlaser/project';

export function syncLinkedText(project: Project): Project {
  let changed = false;
  const objects = project.objects.map((text) => {
    if (text.kind !== 'text' || !text.pathLayout?.guideId) return text;
    const guide = project.objects.find((o) => o.id === text.pathLayout!.guideId);
    if (guide?.kind !== 'vector' || guide.paths.length !== 1) return text;
    const inverse = invert(text.transform);
    if (!inverse) return text;
    const matrix = multiply(inverse, guide.transform);
    const map = (point: { x: number; y: number }) => apply(matrix, point);
    const source = guide.paths[0];
    const path = {
      ...source,
      start: map(source.start),
      segments: source.segments.map((s) =>
        s.type === 'C' ? { ...s, to: map(s.to), c1: map(s.c1), c2: map(s.c2) } : { ...s, to: map(s.to) },
      ),
    };
    if (JSON.stringify(path) === JSON.stringify(text.pathLayout.path)) return text;
    changed = true;
    // Empty caches cannot be sent to CAM while the asynchronous font refresh is pending.
    return { ...text, pathLayout: { ...text.pathLayout, path }, paths: [], outlineVersion: undefined };
  });
  return changed ? { ...project, objects } : project;
}
