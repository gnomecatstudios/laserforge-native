<script lang="ts">
  /**
   * Drag and drop anywhere imports. Photos get a second target beside the usual one: dropped
   * there, each is cleaned down to its pen or marker ink (ink only mode), like Import a drawing.
   */
  import { onMount } from 'svelte';
  import Download from '@lucide/svelte/icons/download';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import { importFiles } from '../actions';

  let depth = $state(0);
  /** The drag carries photos, so the drawing target is offered. */
  let photos = $state(false);
  /** The pointer is over the drawing target. */
  let overDrawing = $state(false);
  let drawingTarget = $state<HTMLElement | null>(null);

  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
  /** Raster images; an SVG is line art already. Types are known during the drag in Chromium. */
  const carriesPhotos = (e: DragEvent) =>
    [...(e.dataTransfer?.items ?? [])].some(
      (item) => item.kind === 'file' && item.type.startsWith('image/') && item.type !== 'image/svg+xml',
    );
  /** The overlay ignores the pointer, so the target is found from where the drag is. */
  const onDrawing = (e: DragEvent) => {
    const r = drawingTarget?.getBoundingClientRect();
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };

  onMount(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (depth === 0) photos = carriesPhotos(e);
      depth++;
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      overDrawing = photos && onDrawing(e);
    };
    const leave = (e: DragEvent) => {
      if (hasFiles(e)) depth = Math.max(0, depth - 1);
      if (depth === 0) overDrawing = false;
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const inkOnly = photos && onDrawing(e);
      depth = 0;
      overDrawing = false;
      const items = [...(e.dataTransfer?.items ?? [])];
      const files = await Promise.all(
        items
          .filter((item) => item.kind === 'file')
          .map(async (item) => {
            const file = item.getAsFile()!;
            // Chromium hands out a writable handle, so a dropped .olaser can be saved in place.
            const getHandle = (
              item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }
            ).getAsFileSystemHandle;
            const handle = getHandle ? await getHandle.call(item).catch(() => null) : null;
            return {
              file,
              handle: handle && handle.kind === 'file' ? (handle as FileSystemFileHandle) : undefined,
            };
          }),
      );
      await importFiles(files, undefined, { inkOnly });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  });
</script>

{#if depth > 0}
  <div class="drop" aria-hidden="true" data-testid="drop-zone">
    <div class="targets">
      <div class="card" class:active={!overDrawing}>
        <Download size={22} /><span>Drop to import</span><span class="mono dim"
          >SVG · PNG · JPEG · WebP · AVIF · BMP · GIF · G-code · .olaser</span
        >
      </div>
      {#if photos}
        <div class="card" class:active={overDrawing} bind:this={drawingTarget} data-testid="drop-drawing">
          <PenLine size={22} /><span>Drop here for ink only mode</span><span class="dim"
            >For photos of pen or marker drawings</span
          >
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .drop {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ol-overlay);
    pointer-events: none;
  }

  .targets {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 16px;
    padding: 16px;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 32px 48px;
    border-radius: var(--ol-radius-xl);
    border: 2px dashed var(--ol-border-strong);
    background: var(--ol-surface);
    font-size: var(--ol-fs-lg);
    font-weight: 600;
    text-align: center;
  }

  .card.active {
    border-color: var(--ol-beam);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--ol-beam) 18%, transparent);
  }

  .card :global(svg) {
    color: var(--ol-text-muted);
  }

  .card.active :global(svg) {
    color: var(--ol-beam);
  }

  .dim {
    font-size: var(--ol-fs-sm);
    font-weight: 400;
  }
</style>
