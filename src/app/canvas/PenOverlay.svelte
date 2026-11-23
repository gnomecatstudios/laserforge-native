<script lang="ts">
  import { editor } from '../state/editor.svelte';
  import { canvas } from '../state/canvas.svelte';
  import { pen } from '../state/pen.svelte';
  import { bedToScreen, type BedFrame } from './viewport';
  let { bed }: { bed: BedFrame } = $props();
  const points = $derived(pen.points.map((p) => bedToScreen(canvas.view, bed, p)));
  $effect(() => {
    if (editor.tool !== 'pen' || editor.view !== 'design' || !editor.project) pen.points = [];
  });
</script>

{#if editor.tool === 'pen' && editor.view === 'design'}
  <svg aria-hidden="true">
    <polyline
      points={[...points, ...(canvas.cursor ? [bedToScreen(canvas.view, bed, canvas.cursor)] : [])]
        .map((p) => `${p.x},${p.y}`)
        .join(' ')}
    />
    {#each points as point, i (i)}<circle cx={point.x} cy={point.y} r="4" />{/each}
  </svg>
  <p>Click to draw nodes. Click the first node to close. Enter finishes an open path. Esc cancels.</p>
{/if}

<style>
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  polyline {
    fill: none;
    stroke: var(--ol-signal);
    stroke-width: 1.5;
  }
  circle {
    fill: var(--ol-surface);
    stroke: var(--ol-signal);
    stroke-width: 2;
  }
  p {
    position: absolute;
    max-width: calc(100% - 32px);
    bottom: 12px;
    left: 16px;
    pointer-events: none;
    color: var(--ol-text-dim);
    background: var(--ol-surface);
    padding: 6px 10px;
  }
</style>
