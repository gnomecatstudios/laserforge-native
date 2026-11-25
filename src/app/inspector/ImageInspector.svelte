<script lang="ts">
  import SectionToggle from '../workspace/SectionToggle.svelte';
  import { sections } from '../state/sections.svelte';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Split from '@lucide/svelte/icons/split';
  import { toast } from '$lib/ui/toasts.svelte';
  import { editor } from '../state/editor.svelte';
  import type { ImageObject } from 'libopenlaser/project';

  let { object }: { object: ImageObject } = $props();
  const asset = $derived(object.name);

  // Engraving settings (dithering, line density, tone) belong to the layer and are edited in the
  // Layers panel above. What depends on this one image is shown here.
  const layer = $derived(editor.project?.layers.find((l) => l.id === object.layerId) ?? null);
  const engraved = $derived(layer?.mode === 'image');

  /** Images on this image's layer: its engraving settings are theirs too. */
  const sharing = $derived(
    layer
      ? (editor.project?.objects.filter((o) => o.kind === 'image' && o.layerId === layer.id).length ?? 0)
      : 0,
  );

  /** Source pixels per inch at the placed size; well below the line density the image is upscaled. */
  const sourceDpi = $derived.by(() => {
    const widthPx = editor.project?.assets[object.assetId]?.widthPx;
    const t = object.transform;
    const widthMm = Math.abs(object.width * Math.hypot(t[0], t[1]));
    return widthPx && widthMm > 0 ? Math.round(widthPx / (widthMm / 25.4)) : null;
  });
  const lineDensity = $derived(layer?.image?.dpi ?? null);

  function ownSettings() {
    const moved = editor.ownLayer(object.id);
    if (moved)
      toast.success(`${object.name} is on its own layer, “${moved.name}”, with the same settings to start.`);
  }
</script>

<section class="image" aria-label="Image" data-testid="image-inspector">
  <div class="head">
    <SectionToggle id="inspector">Image</SectionToggle>
    <span class="muted file" title={asset}>{asset}</span>
  </div>
  {#if sections.isOpen('inspector')}
    {#if engraved && layer && sharing > 1}
      <div class="shared" data-testid="image-shared-layer">
        <p class="muted note">
          Its engraving settings change all {sharing} images on “{layer.name}”.
        </p>
        <button type="button" class="btn small" onclick={ownSettings} data-testid="image-own-layer">
          <Split size={14} />Give this image its own settings
        </button>
      </div>
    {/if}
    {#if engraved && sourceDpi !== null && lineDensity !== null && sourceDpi < lineDensity * 0.5}
      <p class="note warn" data-testid="image-low-res">
        The photo is only {sourceDpi} dpi at this size, so it is upscaled to {lineDensity} dpi. Shrink it or use
        a larger original for sharper detail.
      </p>
    {/if}
    <button
      type="button"
      class="btn"
      onclick={() => editor.editImage(object.id)}
      title="Trace to vectors, remove the background, keep only ink, or split the photo into layers by color. Or double-click the image, or press Enter"
      data-testid="edit-image"
    >
      <SlidersHorizontal size={15} />Edit image
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

  .file {
    font-size: var(--ol-fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shared {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .note {
    margin: 0;
    font-size: var(--ol-fs-sm);
  }

  .note.warn {
    color: var(--ol-hold);
  }
</style>
