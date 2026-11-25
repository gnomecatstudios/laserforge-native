<script lang="ts">
  /**
   * Bitmap mode: color separation for the project's images. Shows the original, where colors are
   * picked, next to the engraving it becomes at the layer's line density. The engraving settings
   * (dithering, line density, tone) belong to the image's layer and are edited in Design, in the
   * Layers panel.
   */
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import Wand from '@lucide/svelte/icons/wand-sparkles';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import Check from '@lucide/svelte/icons/check';
  import { DEFAULT_IMAGE_SETTINGS } from 'libopenlaser/cam';
  import type { ImageObject, ImageSettings, Layer } from 'libopenlaser/project';
  import { reportError } from '$lib/ui/errors';
  import { editor } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';
  import * as actions from '../actions';
  import { ditherInWorker } from '../lib/cam-client';
  import { Separation, separationFocus, type SeparationShow } from './separation.svelte';
  import SeparationCanvas from './SeparationCanvas.svelte';
  import SeparatePanel from './SeparatePanel.svelte';
  import ViewColors from './ViewColors.svelte';
  import BedThumbnail from './BedThumbnail.svelte';

  /** Colors are picked on the original, so it always shows; the engraving can show beside it. */
  type Compare = 'split' | 'original';

  const SHOW: Array<[SeparationShow, string, string]> = [
    ['highlight', 'Highlight', 'Tint the selection over the whole image'],
    ['selection', 'Selection', 'Only the selection, over the backdrop'],
    ['rest', 'Rest', 'Everything except the selection, over the backdrop'],
  ];

  const images = $derived((editor.project?.objects.filter((o) => o.kind === 'image') ?? []) as ImageObject[]);
  let pickedId = $state<string | null>(null);
  /** The selected image wins, then the last one picked here, then the first. */
  const current = $derived(
    images.find((o) => editor.selection.has(o.id)) ??
      images.find((o) => o.id === pickedId) ??
      images[0] ??
      null,
  );
  const layer = $derived<Layer | null>(
    current ? (editor.project?.layers.find((l) => l.id === current.layerId) ?? null) : null,
  );
  const asset = $derived(current ? editor.project?.assets[current.assetId] : undefined);
  const settings = $derived<ImageSettings>(layer?.image ?? DEFAULT_IMAGE_SETTINGS);

  /** Placed size in mm, transform included. */
  const sizeMm = $derived.by(() => {
    if (!current) return { w: 0, h: 0 };
    const t = current.transform;
    return {
      w: Math.abs(current.width * Math.hypot(t[0], t[1])),
      h: Math.abs(current.height * Math.hypot(t[2], t[3])),
    };
  });
  const grid = $derived({
    cols: Math.max(1, Math.round((sizeMm.w * settings.dpi) / 25.4)),
    rows: Math.max(1, Math.round((sizeMm.h * settings.dpi) / 25.4)),
  });
  let compare = $state<Compare>('split');
  let cleaning = $state(false);

  async function keepInk(id: string): Promise<void> {
    cleaning = true;
    try {
      await actions.keepOnlyInk(id);
    } finally {
      cleaning = false;
    }
  }
  // The original is drawn from a small decoded copy, which also previews color selections.
  const separation = new Separation();
  let share = $state(0);
  $effect(() => {
    if (!asset) {
      separation.unload();
      return;
    }
    separation.load(asset.id, asset.data).catch((error: unknown) => reportError(error, 'Bitmap original'));
  });
  // Picks belong to one image.
  let pickedFor: string | null = null;
  $effect(() => {
    const id = current?.id ?? null;
    if (id !== pickedFor) {
      pickedFor = id;
      separation.reset();
    }
  });
  // While Bitmap mode is open, undo and redo step through the picks before the project.
  $effect(() => {
    separationFocus.current = separation;
    return () => {
      if (separationFocus.current === separation) separationFocus.current = null;
    };
  });

  // Processed preview: dithered in the worker, debounced while settings are scrubbed.
  let canvas = $state<HTMLCanvasElement | null>(null);
  let busy = $state(false);
  let processed = $state<{ width: number; height: number; burn: Uint8ClampedArray } | null>(null);
  let ticket = 0;
  $effect(() => {
    if (!current || !asset || !layer || layer.mode !== 'image') {
      processed = null;
      return;
    }
    const request = {
      assetId: asset.id,
      blob: asset.data,
      settings: { ...settings },
      layer: { power: layer.power, minPower: layer.minPower },
      widthMm: sizeMm.w,
      heightMm: sizeMm.h,
    };
    const mine = ++ticket;
    busy = true;
    const timer = setTimeout(() => {
      ditherInWorker(request)
        .then((result) => {
          if (mine === ticket) processed = result;
        })
        .catch((error: unknown) => reportError(error, 'Bitmap preview'))
        .finally(() => {
          if (mine === ticket) busy = false;
        });
    }, 120);
    return () => clearTimeout(timer);
  });

  // Burn levels drawn as dark dots on a light material.
  $effect(() => {
    const target = canvas;
    const result = processed;
    if (!target || !result) return;
    target.width = result.width;
    target.height = result.height;
    const pixels = new Uint8ClampedArray(result.width * result.height * 4);
    for (let i = 0, o = 0; i < result.burn.length; i++, o += 4) {
      const v = 255 - result.burn[i];
      pixels[o] = v;
      pixels[o + 1] = v;
      pixels[o + 2] = v;
      pixels[o + 3] = 255;
    }
    target.getContext('2d')?.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
  });

  // The image shown is the selected one, so the Layers panel shows its layer and Done returns
  // to Design with it selected. Arriving from the tab with no image selected selects the first.
  $effect(() => {
    const id = current?.id;
    if (id && !images.some((o) => editor.selection.has(o.id))) editor.select([id]);
  });

  function pick(object: ImageObject) {
    pickedId = object.id;
    editor.select([object.id]);
  }
</script>

<div class="bitmap" data-testid="bitmap-view">
  {#if !current}
    <div class="empty">
      <ImagePlus size={32} />
      <p>No images in this project yet.</p>
      <p class="muted">Import a photo to prepare it for engraving.</p>
      <div class="empty-actions">
        <button
          type="button"
          class="btn start"
          onclick={() => actions.importArt()}
          data-testid="bitmap-import"
        >
          <ImagePlus size={15} />Import image
        </button>
        <button
          type="button"
          class="btn"
          onclick={() => actions.importDrawing()}
          title="For a photo of a pen or marker drawing: imports it in ink only mode, just the ink without the paper and shadows"
          data-testid="bitmap-import-drawing"
        >
          <PenLine size={15} />Import a drawing
        </button>
      </div>
    </div>
  {:else}
    {#if images.length > 1}
      <nav class="list" aria-label="Images">
        {#each images as object (object.id)}
          <button
            type="button"
            class="item"
            aria-pressed={object.id === current.id}
            onclick={() => pick(object)}
            title={object.name}
          >
            {object.name}
          </button>
        {/each}
      </nav>
    {/if}

    <section class="stage" aria-label="Bitmap preview">
      <div class="stage-head">
        <span class="name" title={current.name}>{current.name}</span>
        <span class="mono muted small" data-testid="bitmap-grid">
          {sizeMm.w.toFixed(1)} × {sizeMm.h.toFixed(1)} mm · {grid.cols} × {grid.rows} px @ {settings.dpi} dpi
        </span>
        <div class="segmented small" role="group" aria-label="Compare">
          {#each [['split', 'Split'], ['original', 'Original']] as const as [id, label] (id)}
            <button
              type="button"
              aria-pressed={compare === id}
              onclick={() => (compare = id)}
              data-testid="bitmap-compare-{id}">{label}</button
            >
          {/each}
        </div>
        <button
          type="button"
          class="btn small"
          onclick={() => (editor.view = 'design')}
          title="Back to Design, with this image selected"
          data-testid="bitmap-done"
        >
          <Check size={14} />Done
        </button>
      </div>
      <div class="panes" class:single={compare !== 'split'}>
        <figure class="pane">
          <div class="art">
            <SeparationCanvas {separation} name={current.name} picking onshare={(v) => (share = v)} />
          </div>
          <figcaption>
            <span class="caption">Original</span>
            <span class="pane-tools">
              <span class="segmented mini" role="group" aria-label="Show">
                {#each SHOW as [id, label, hint] (id)}
                  <button
                    type="button"
                    aria-pressed={separation.show === id}
                    title={hint}
                    onclick={() => (separation.show = id)}
                    data-testid="separate-show-{id}">{label}</button
                  >
                {/each}
              </span>
              <ViewColors />
            </span>
          </figcaption>
        </figure>
        {#if compare === 'split'}
          <figure class="pane material">
            <div class="art">
              {#if layer?.mode === 'image'}
                <canvas
                  bind:this={canvas}
                  aria-label="Processed {current.name}"
                  data-testid="bitmap-processed"
                ></canvas>
                {#if busy}<span class="busy">Processing…</span>{/if}
              {:else}
                <p class="note">Processing applies on an Image layer.</p>
              {/if}
            </div>
            <figcaption><span class="caption">Processed · as engraved</span></figcaption>
          </figure>
        {/if}
      </div>
    </section>

    <aside class="controls" aria-label="Separate colors">
      <BedThumbnail image={current} />
      <button
        type="button"
        class="btn start trace"
        onclick={() => (ui.traceImageId = current.id)}
        title="Turn this image into vector paths you can cut, score or edit node by node"
        data-testid="bitmap-trace"
      >
        <Wand size={15} />Trace to vectors
      </button>
      <h3>Separate colors</h3>
      <SeparatePanel {separation} image={current} {share} />
      <div class="more">
        <button
          type="button"
          class="btn ghost"
          disabled={cleaning}
          onclick={() => keepInk(current.id)}
          title="For a photo of a pen or marker drawing: removes shadows, uneven light and the paper, leaving black ink on a transparent background"
          data-testid="bitmap-keep-ink"
        >
          <PenLine size={15} />{cleaning ? 'Cleaning up…' : 'Ink only mode'}
        </button>
      </div>
    </aside>
  {/if}
</div>

<style>
  .bitmap {
    flex: 1;
    min-height: 0;
    display: flex;
    background: var(--ol-bg);
  }

  .empty {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
    color: var(--ol-text-muted);
  }

  .empty p {
    margin: 0;
  }

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .list {
    width: 160px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px;
    overflow-y: auto;
    border-right: 1px solid var(--ol-border);
  }

  .item {
    text-align: left;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--ol-radius-sm);
    background: none;
    color: var(--ol-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item[aria-pressed='true'] {
    background: var(--ol-surface-2);
  }

  .stage {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 12px;
    gap: 10px;
  }

  .stage-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stage-head .segmented {
    margin-left: auto;
  }

  .panes {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .panes.single {
    grid-template-columns: minmax(0, 1fr);
  }

  .pane {
    position: relative;
    margin: 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 12px 8px;
    border: 1px solid var(--ol-border);
    border-radius: var(--ol-radius-md);
    background: var(--ol-surface);
  }

  .art {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pane.material {
    background: #fff;
  }

  .pane :global(canvas) {
    max-width: 100%;
    max-height: 100%;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .pane.material canvas {
    image-rendering: pixelated;
  }

  figcaption {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    min-height: 26px;
    font-size: var(--ol-fs-sm);
    color: var(--ol-text-muted);
  }

  .caption {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-tools {
    margin-left: auto;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
  }

  /* A compact switch that fits the caption row. */
  .segmented.mini {
    padding: 2px;
  }

  .segmented.mini button {
    height: 22px;
    padding: 0 8px;
  }

  .material figcaption,
  .material .note {
    color: #555;
  }

  .busy {
    position: absolute;
    top: 8px;
    right: 10px;
    font-size: var(--ol-fs-sm);
    color: #555;
  }

  .controls {
    width: 260px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    overflow-y: auto;
    border-left: 1px solid var(--ol-border);
    background: var(--ol-surface);
  }

  h3 {
    margin: 0;
    font-size: var(--ol-fs-md);
  }

  .more {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding-top: 10px;
    border-top: 1px solid var(--ol-border);
  }

  .note {
    margin: 0;
    font-size: var(--ol-fs-sm);
    color: var(--ol-text-muted);
  }

  .small {
    font-size: var(--ol-fs-sm);
  }
</style>
