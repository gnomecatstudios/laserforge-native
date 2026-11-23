<script lang="ts">
  import SectionToggle from '../workspace/SectionToggle.svelte';
  import { sections } from '../state/sections.svelte';
  import Wand from '@lucide/svelte/icons/wand-sparkles';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import { editor } from '../state/editor.svelte';
  import { keepOnlyInk } from '../actions';
  import type { ImageObject } from 'libopenlaser/project';
  import { ui } from '../state/ui.svelte';

  let { object }: { object: ImageObject } = $props();
  const asset = $derived(object.name);
  let cleaning = $state(false);

  async function cleanUp(): Promise<void> {
    cleaning = true;
    try {
      await keepOnlyInk(object.id);
    } finally {
      cleaning = false;
    }
  }
</script>

<section class="image" aria-label="Image" data-testid="image-inspector">
  <div class="head">
    <SectionToggle id="inspector">Image</SectionToggle>
    <span class="muted small" title={asset}>{asset}</span>
  </div>
  {#if sections.isOpen('inspector')}
    <button
      type="button"
      class="btn"
      onclick={() => editor.editImage(object.id)}
      title="Open in Bitmap mode: the engraving preview, dithering and tone, and color separation. Or double-click the image, or press Enter"
      data-testid="edit-image"
    >
      <SlidersHorizontal size={15} />Edit image
    </button>
    <button type="button" class="btn" onclick={() => (ui.traceImageId = object.id)} data-testid="trace-open">
      <Wand size={15} />Trace to vectors
    </button>
    <button
      type="button"
      class="btn"
      disabled={cleaning}
      onclick={cleanUp}
      title="For a photo of a pen or marker drawing: removes shadows, uneven light and the paper, leaving black ink on a transparent background"
      data-testid="keep-ink"
    >
      <PenLine size={15} />{cleaning ? 'Cleaning up…' : 'Ink only mode'}
    </button>
  {/if}
</section>

<style>
  .image {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-bottom: 1px solid var(--ol-border);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .small {
    font-size: var(--ol-fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
