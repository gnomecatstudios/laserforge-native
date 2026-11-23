<script lang="ts">
  /**
   * Where the image being edited sits on the bed, among everything else, so Bitmap mode never
   * loses sight of the layout. Drawn like the Design canvas: same origin corner and directions.
   */
  import type { ImageObject } from 'libopenlaser/project';
  import { editor } from '../state/editor.svelte';
  import { currentBed } from '../state/work-area';
  import { RING_BELOW, bedThumbnail, shapeBox, svgPoints } from '../lib/bed-thumbnail';

  let { image }: { image: ImageObject } = $props();

  /** Fits the controls column; a square bed comes out 128 px. */
  const BOX = { width: 232, height: 128 };

  const bed = $derived(currentBed());
  const thumb = $derived(editor.project ? bedThumbnail(editor.project, bed, BOX, image.id) : null);
  const ring = $derived.by(() => {
    if (!thumb?.current) return null;
    const box = shapeBox(thumb.current.points);
    return box.size < RING_BELOW ? box : null;
  });
  const size = (v: number) => (Number.isInteger(v) ? v : v.toFixed(1));
</script>

{#if thumb}
  <figure class="thumb" data-testid="bitmap-bed">
    <svg
      viewBox="-2 -2 {thumb.width + 4} {thumb.height + 4}"
      width={thumb.width + 4}
      height={thumb.height + 4}
      role="img"
      aria-label="Where {image.name} sits on the {size(bed.width)} × {size(bed.height)} mm bed"
    >
      <rect class="bed" x="0" y="0" width={thumb.width} height={thumb.height} rx="2" />
      {#each thumb.shapes as shape (shape.id)}
        <polygon
          class="other"
          class:image={shape.image}
          points={svgPoints(shape.points)}
          style:stroke={shape.color}
          style:fill={shape.image ? shape.color : 'none'}
        />
      {/each}
      {#if thumb.current}
        <polygon class="current" points={svgPoints(thumb.current.points)} data-testid="bitmap-bed-current" />
      {/if}
      {#if ring}
        <circle class="ring" cx={ring.cx} cy={ring.cy} r="7" />
      {/if}
      <circle class="origin" cx={thumb.origin.x} cy={thumb.origin.y} r="2.5" />
    </svg>
    <figcaption>On the bed · {size(bed.width)} × {size(bed.height)} mm</figcaption>
  </figure>
{/if}

<style>
  .thumb {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  svg {
    display: block;
    overflow: hidden;
  }

  .bed {
    fill: var(--ol-bg);
    stroke: var(--ol-border-strong);
    stroke-width: 1;
  }

  .other {
    stroke-width: 1;
    opacity: 0.6;
  }

  .other.image {
    fill-opacity: 0.18;
  }

  .current {
    fill: var(--ol-beam);
    fill-opacity: 0.35;
    stroke: var(--ol-beam);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  .ring {
    fill: none;
    stroke: var(--ol-beam);
    stroke-width: 1.5;
  }

  .origin {
    fill: var(--ol-text-muted);
  }

  figcaption {
    font-size: var(--ol-fs-xs);
    color: var(--ol-text-muted);
  }
</style>
