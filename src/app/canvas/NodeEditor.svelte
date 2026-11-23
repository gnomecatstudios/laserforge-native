<script lang="ts">
  import { apply, invert, cubicPoint } from 'libopenlaser/geometry';
  import type { Vec2 } from 'libopenlaser/geometry';
  import { updateObject, type VectorObject } from 'libopenlaser/project';
  import { editor } from '../state/editor.svelte';
  import { canvas } from '../state/canvas.svelte';
  import { bedToScreen, screenToBed, type BedFrame } from './viewport';
  import { insertNode, moveNode, pathNodes, type NodeRef } from './node-edit';
  import { nodeSelection } from '../state/nodes.svelte';
  let { bed }: { bed: BedFrame } = $props();
  let host: HTMLDivElement;
  const objects = $derived(
    editor.tool === 'node' && editor.view === 'design'
      ? (editor.project?.objects.filter(
          (o): o is VectorObject =>
            o.kind === 'vector' &&
            !o.locked &&
            o.visible &&
            editor.selection.has(o.id) &&
            editor.project!.layers.some((l) => l.id === o.layerId && l.visible),
        ) ?? [])
      : [],
  );
  let drag: { object: VectorObject; node: NodeRef; pointer: number } | null = null;
  // Forget the picked node when leaving the node tool, so Delete never hits a node picked earlier.
  $effect(() => {
    if (editor.tool !== 'node' || editor.view !== 'design') nodeSelection.current = null;
  });
  function screen(object: VectorObject, point: Vec2) {
    return bedToScreen(canvas.view, bed, apply(object.transform, point));
  }
  function move(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const inverse = invert(drag.object.transform);
    if (!inverse) return;
    const r = host.getBoundingClientRect();
    const point = apply(
      inverse,
      screenToBed(canvas.view, bed, { x: event.clientX - r.left, y: event.clientY - r.top }),
    );
    const { object, node } = drag;
    editor.commit(
      (p) => updateObject(p, object.id, { paths: moveNode(object.paths, node, point), shape: undefined }),
      { coalesce: 'node-drag' },
    );
  }
  function addNode(object: VectorObject, pi: number, index: number, event?: PointerEvent) {
    if (event && event.button !== 0) return;
    event?.stopPropagation();
    const path = object.paths[pi];
    const segment = path.segments[index] ?? { type: 'L' as const, to: path.start };
    const from = index ? path.segments[index - 1].to : path.start;
    let t = 0.5;
    if (event) {
      const rect = host.getBoundingClientRect();
      const target = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const at = (u: number) =>
        screen(
          object,
          segment.type === 'C'
            ? cubicPoint(from, segment.c1, segment.c2, segment.to, u)
            : { x: from.x + (segment.to.x - from.x) * u, y: from.y + (segment.to.y - from.y) * u },
        );
      const distance = (u: number) => {
        const p = at(u);
        return (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
      };
      // Find the nearest neighborhood in screen space, including scaled/skewed objects.
      let best = 0;
      for (let i = 1; i <= 64; i++) if (distance(i / 64) < distance(best / 64)) best = i;
      let lo = Math.max(0, (best - 1) / 64),
        hi = Math.min(1, (best + 1) / 64);
      for (let i = 0; i < 30; i++) {
        const a = lo + (hi - lo) / 3,
          b = hi - (hi - lo) / 3;
        if (distance(a) < distance(b)) hi = b;
        else lo = a;
      }
      t = (lo + hi) / 2;
    }
    const paths = insertNode(object.paths, pi, index, t);
    if (paths === object.paths) return;
    editor.sealHistory();
    editor.commit((p) => updateObject(p, object.id, { paths, shape: undefined }));
    editor.sealHistory();
  }
  function segmentDrawing(object: VectorObject, pi: number, index: number) {
    const path = object.paths[pi];
    const segment = path.segments[index] ?? { type: 'L' as const, to: path.start };
    const a = screen(object, index ? path.segments[index - 1].to : path.start);
    const b = screen(object, segment.to);
    if (segment.type === 'L') return `M${a.x},${a.y} L${b.x},${b.y}`;
    const c = screen(object, segment.c1),
      d = screen(object, segment.c2);
    return `M${a.x},${a.y} C${c.x},${c.y} ${d.x},${d.y} ${b.x},${b.y}`;
  }
  function end() {
    drag = null;
    editor.sealHistory();
  }
</script>

<div class="nodes" bind:this={host}>
  {#each objects as object (object.id)}
    <svg aria-label="Editable path segments">
      {#each object.paths as path, pi (pi)}
        {#each [...path.segments, ...(path.closed && (path.segments.at(-1)?.to.x !== path.start.x || path.segments.at(-1)?.to.y !== path.start.y) ? [{ type: 'L', to: path.start }] : [])] as _, index (index)}
          <path
            class="segment-hit"
            d={segmentDrawing(object, pi, index)}
            role="button"
            tabindex="0"
            aria-label="Insert node on path {pi + 1}, segment {index + 1}"
            data-testid="path-segment"
            onpointerdown={(event) => addNode(object, pi, index, event)}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                addNode(object, pi, index);
              }
            }}
          />
        {/each}
        {#each path.segments as segment, i (i)}
          {#if segment.type === 'C'}
            {@const a = screen(object, i ? path.segments[i - 1].to : path.start)}
            {@const b = screen(object, segment.c1)}
            {@const c = screen(object, segment.c2)}
            {@const d = screen(object, segment.to)}
            <path d="M{a.x},{a.y} L{b.x},{b.y} M{c.x},{c.y} L{d.x},{d.y}" />
          {/if}
        {/each}
      {/each}
    </svg>
    {#each pathNodes(object.paths) as node (`${node.path}:${node.index}:${node.control ?? 'anchor'}`)}
      {@const at = screen(object, node.point)}
      <button
        type="button"
        class:control={!!node.control}
        class:selected={nodeSelection.is(object.id, node)}
        aria-pressed={node.control ? undefined : nodeSelection.is(object.id, node)}
        style:left="{at.x}px"
        style:top="{at.y}px"
        aria-label="{node.control ? 'Curve handle' : 'Path node'} {node.path + 1}:{node.index + 2}"
        data-testid={node.control ? 'curve-handle' : 'path-node'}
        onpointerdown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          if (event.altKey && !node.control) {
            nodeSelection.remove(object, node);
            return;
          }
          nodeSelection.current = node.control ? null : { objectId: object.id, node };
          event.currentTarget.setPointerCapture(event.pointerId);
          editor.sealHistory();
          drag = { object, node, pointer: event.pointerId };
        }}
        onpointermove={move}
        onpointerup={end}
        onpointercancel={end}
        onlostpointercapture={end}
      ></button>
    {/each}
  {/each}
  {#if editor.tool === 'node' && editor.view === 'design'}
    <p>
      Click a path to add a node; drag nodes or curve handles to edit. Select a node and press Delete (or
      Alt+click it) to remove it.
    </p>
  {/if}
</div>

<style>
  .nodes {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  path {
    fill: none;
    stroke: var(--ol-signal);
    stroke-width: 1;
  }
  .segment-hit {
    stroke: transparent;
    stroke-width: 12;
    pointer-events: stroke;
    cursor: copy;
  }
  .segment-hit:focus-visible {
    stroke: var(--ol-signal);
    stroke-width: 3;
  }
  button {
    position: absolute;
    width: 12px;
    height: 12px;
    padding: 0;
    transform: translate(-50%, -50%);
    border: 2px solid var(--ol-signal);
    background: var(--ol-surface);
    pointer-events: auto;
    cursor: move;
    touch-action: none;
  }
  button.selected {
    background: var(--ol-signal);
  }
  button.control {
    border-radius: 50%;
    width: 10px;
    height: 10px;
  }
  p {
    position: absolute;
    max-width: calc(100% - 32px);
    bottom: 12px;
    left: 16px;
    color: var(--ol-text-dim);
    background: var(--ol-surface);
    padding: 6px 10px;
    border-radius: var(--ol-radius-md);
  }
</style>
