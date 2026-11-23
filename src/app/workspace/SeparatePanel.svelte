<script lang="ts">
  /**
   * Separate tab of Bitmap mode: key colors out of an image (a backdrop, a sky, one object among
   * several) and move them to a layer of their own, erase them, or keep only them. Repeating it
   * peels a picture into foreground, midground and background layers that stack back together.
   */
  import Layers from '@lucide/svelte/icons/layers';
  import Eraser from '@lucide/svelte/icons/eraser';
  import Crop from '@lucide/svelte/icons/crop';
  import ScanSearch from '@lucide/svelte/icons/scan-search';
  import X from '@lucide/svelte/icons/x';
  import Plus from '@lucide/svelte/icons/plus';
  import Minus from '@lucide/svelte/icons/minus';
  import NumberField from '$lib/ui/NumberField.svelte';
  import Toggle from '$lib/ui/Toggle.svelte';
  import { toast } from '$lib/ui/toasts.svelte';
  import { reportError } from '$lib/ui/errors';
  import { makeId } from 'libopenlaser/project';
  import type { ImageObject, Layer } from 'libopenlaser/project';
  import { editor } from '../state/editor.svelte';
  import { separateInWorker } from '../lib/cam-client';
  import { placeSeparation, type SeparateMode } from '../lib/separate-place';
  import type { KeyMode } from 'libopenlaser/cam';
  import { keySwatch, type Separation } from './separation.svelte';

  let { separation, image, share }: { separation: Separation; image: ImageObject; share: number } = $props();

  const asset = $derived(editor.project?.assets[image.assetId]);
  const ready = $derived(!separation.empty && share > 0 && !separation.busy && !image.locked);
  const percent = $derived(share > 0 && share < 0.001 ? '<0.1' : (share * 100).toFixed(share < 0.1 ? 1 : 0));

  const MODES: Array<[KeyMode, string]> = [
    ['add', 'Add'],
    ['subtract', 'Subtract'],
  ];
  /** The tolerance and softness shown are those of the switch's mode. */
  const matching = $derived(separation.matching[separation.mode]);
  const modeWord = $derived(separation.mode === 'add' ? 'add' : 'subtract');

  /** Same engraving settings as the image's layer; its own name and color to tell them apart. */
  const newLayer = (source: Layer): Layer => editor.layerLike(source);

  async function apply(mode: SeparateMode) {
    if (!asset || !ready) return;
    const assetId = asset.id;
    const imageId = image.id;
    separation.busy = true;
    try {
      const result = await separateInWorker({
        assetId,
        blob: asset.data,
        selection: $state.snapshot(separation.selection),
        regions: separation.regions && mode !== 'remove',
      });
      const now = editor.project?.objects.find((o) => o.id === imageId);
      if (!now || now.kind !== 'image' || now.assetId !== assetId) {
        toast.warning('The image changed while it was being separated. Try again.');
        return;
      }
      if (result.pieces.length === 0) {
        toast.info('Nothing in the image matches the picked colors.');
        return;
      }
      if (mode === 'keep' && !result.rest) {
        toast.info('The selection already covers the whole image.');
        return;
      }
      let outcome: ReturnType<typeof placeSeparation> | null = null;
      editor.commit((p) => {
        outcome = placeSeparation(p, imageId, result, mode, makeId, newLayer);
        return outcome.project;
      });
      editor.sealHistory();
      // The picks are spent; undo now steps back through the project.
      separation.reset();
      const done = outcome as ReturnType<typeof placeSeparation> | null;
      if (!done) return;
      if (mode === 'layer') {
        const layer = editor.project?.layers.find((l) => l.id === done.layerId);
        const count = done.pieceIds.length;
        toast.success(
          `Moved ${count > 1 ? `${count} objects` : 'the selection'} to “${layer?.name ?? 'a new layer'}”.`,
        );
        // Stay on what is left, ready to peel the next layer off it.
        editor.select(done.restId ? [done.restId] : done.pieceIds);
      } else if (mode === 'remove') {
        toast.success(done.restId ? 'Erased the selection.' : 'Erased the whole image.');
        if (done.restId) editor.select([done.restId]);
      } else {
        editor.select(done.pieceIds);
      }
    } catch (error) {
      reportError(error, 'Separate colors');
    } finally {
      separation.busy = false;
    }
  }
</script>

<div class="separate" data-testid="separate-panel">
  <p class="muted small">
    Click the image to pick a color, or drag across a gradient for its whole range. Alt subtracts, Shift adds.
  </p>

  <div class="segmented small mode" role="group" aria-label="Pick mode">
    {#each MODES as [id, label] (id)}
      <button
        type="button"
        aria-pressed={separation.mode === id}
        onclick={() => (separation.mode = id)}
        data-testid="separate-mode-{id}"
        >{#if id === 'add'}<Plus size={14} />{:else}<Minus size={14} />{/if}{label}</button
      >
    {/each}
  </div>

  <div class="row">
    <button
      type="button"
      class="btn ghost"
      onclick={() => separation.selectBackground() || toast.info('No background color found at the edges.')}
      disabled={!separation.preview}
      data-testid="separate-background"
    >
      <ScanSearch size={15} />Select background
    </button>
    {#if separation.picks.length > 0 || separation.invert}
      <button type="button" class="btn ghost" onclick={() => separation.clear()} data-testid="separate-clear">
        Clear
      </button>
    {/if}
  </div>

  {#if separation.picks.length > 0}
    <ul class="keys" aria-label="Picked colors" data-testid="separate-keys">
      {#each separation.picks as pick, i (i)}
        {@const subtract = pick.mode === 'subtract'}
        <li class:subtract data-mode={pick.mode}>
          <span class="swatch" class:range={pick.stops.length > 1} style:background={keySwatch(pick)}>
            {#if subtract}<span class="badge" aria-hidden="true">−</span>{/if}
          </span>
          <span class="small muted"
            >{subtract ? 'Subtract' : 'Add'} · {pick.stops.length > 1
              ? `range of ${pick.stops.length}`
              : 'color'}</span
          >
          <button
            type="button"
            class="icon-btn sm"
            aria-label={subtract
              ? `Add picked color ${i + 1} instead`
              : `Subtract picked color ${i + 1} instead`}
            title={subtract ? 'Switch to add' : 'Switch to subtract'}
            onclick={() => separation.togglePick(i)}
            data-testid="separate-toggle-{i}"
            >{#if subtract}<Plus size={14} />{:else}<Minus size={14} />{/if}</button
          >
          <button
            type="button"
            class="icon-btn sm"
            aria-label="Remove picked color {i + 1}"
            onclick={() => separation.removePick(i)}><X size={14} /></button
          >
        </li>
      {/each}
    </ul>
  {/if}

  <p class="group-head" data-testid="separate-matching-mode">
    Matching for {modeWord} picks
  </p>
  <NumberField
    label="Tolerance"
    hint="How different a color can be from a pick and still be selected. Add and subtract picks each have their own"
    value={matching.tolerance}
    min={0}
    max={100}
    onchange={(v) => separation.setMatching(separation.mode, { tolerance: v })}
    testid="separate-tolerance"
  />
  <NumberField
    label="Edge softness"
    hint="Blends the border of the selection, so cut-out edges stay smooth. Add and subtract picks each have their own"
    value={matching.softness}
    min={0}
    max={100}
    onchange={(v) => separation.setMatching(separation.mode, { softness: v })}
    testid="separate-softness"
  />
  <p class="group-head">Options</p>
  <div class="toggles">
    <Toggle
      label="Connected areas only"
      hint="Only areas joined to where you clicked. The same color elsewhere in the picture stays"
      checked={separation.connected}
      onchange={(c) => separation.setConnected(c)}
    />
    <Toggle
      label="Invert"
      hint="Select everything except the picked colors. Applied after subtracting"
      checked={separation.invert}
      onchange={(c) => separation.setInvert(c)}
    />
    <Toggle
      label="One object per area"
      hint="Each separate patch of the selection becomes its own object, so several subjects can be moved apart"
      checked={separation.regions}
      onchange={(c) => (separation.regions = c)}
    />
  </div>

  <p class="small mono muted share" data-testid="separate-share">
    {separation.empty ? 'Nothing selected' : `${percent}% of the image selected`}
  </p>
  {#if image.locked}
    <p class="note">“{image.name}” is locked. Unlock it in the Layers panel to change it.</p>
  {/if}

  <button
    type="button"
    class="btn start"
    disabled={!ready}
    onclick={() => apply('layer')}
    data-testid="separate-layer"
  >
    <Layers size={15} />{separation.busy ? 'Separating…' : 'Move to new layer'}
  </button>
  <div class="row">
    <button
      type="button"
      class="btn ghost"
      disabled={!ready}
      onclick={() => apply('remove')}
      title="Make the selected pixels transparent"
      data-testid="separate-remove"
    >
      <Eraser size={15} />Erase
    </button>
    <button
      type="button"
      class="btn ghost"
      disabled={!ready}
      onclick={() => apply('keep')}
      title="Make everything except the selection transparent"
      data-testid="separate-keep"
    >
      <Crop size={15} />Keep only
    </button>
  </div>
</div>

<style>
  .separate {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .row .btn {
    flex: 1;
  }

  .keys {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .keys li {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mode {
    display: flex;
  }

  .mode button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .keys .small {
    flex: 1;
  }

  .swatch {
    position: relative;
    width: 22px;
    height: 16px;
    flex-shrink: 0;
    border-radius: var(--ol-radius-sm);
    border: 1px solid var(--ol-border);
  }

  .swatch.range {
    width: 44px;
  }

  .subtract .swatch {
    border: 2px solid var(--ol-stop);
  }

  .badge {
    position: absolute;
    right: -6px;
    top: -7px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    color: #fff;
    background: var(--ol-stop);
  }

  .toggles {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .small {
    font-size: var(--ol-fs-sm);
  }

  .share {
    padding-top: 10px;
    border-top: 1px solid var(--ol-border);
  }

  .group-head {
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid var(--ol-border);
    font-size: var(--ol-fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ol-text-muted);
  }

  .note {
    margin: 0;
    font-size: var(--ol-fs-sm);
    color: var(--ol-hold);
  }

  p {
    margin: 0;
  }
</style>
