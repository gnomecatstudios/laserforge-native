<script lang="ts">
  /** Asks which layer imported images go on: an existing image layer, or a new one you name. */
  import { untrack } from 'svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { nextLayerName } from 'libopenlaser/project';
  import type { Id } from 'libopenlaser/project';
  import { editor } from '../state/editor.svelte';
  import { imageLayerQuestion, type ImageLayerChoice } from '../state/image-layer.svelte';

  const question = $derived(imageLayerQuestion.pending);
  const count = $derived(question?.names.length ?? 0);
  const layers = $derived(editor.project?.layers ?? []);
  const imageLayers = $derived(layers.filter((l) => l.mode === 'image'));
  const others = $derived(layers.length - imageLayers.length);
  const imagesOn = (id: Id) => editor.project?.objects.filter((o) => o.layerId === id).length ?? 0;

  /** 'new', 'each', or a layer id. */
  let pick = $state<string>('new');
  let name = $state('');

  // Each question starts fresh: an empty image layer you made yourself is the likely target;
  // otherwise a new layer, one per image when there are several.
  $effect(() => {
    const q = question;
    if (!q) return;
    untrack(() => {
      const active = editor.activeLayer;
      const emptyActive = !!active && active.mode === 'image' && imagesOn(active.id) === 0;
      pick = emptyActive && active ? active.id : q.names.length > 1 ? 'each' : 'new';
      name = nextLayerName(editor.project?.layers ?? []);
    });
  });

  function choice(): ImageLayerChoice {
    if (pick === 'each') return { kind: 'each' };
    if (pick === 'new') return { kind: 'new', name: name.trim() || nextLayerName(layers) };
    return { kind: 'layer', id: pick };
  }

  const what = $derived(
    !question
      ? ''
      : count === 1
        ? question.names[0]
        : `${count} images: ${question.names.slice(0, 3).join(', ')}${count > 3 ? '…' : ''}`,
  );
</script>

<Dialog
  open={!!question}
  title="Choose a layer"
  description="Which layer the imported images go on"
  width={420}
  onclose={() => imageLayerQuestion.answer(null)}
  testid="image-layer-dialog"
>
  <p class="what" title={question?.names.join(', ')}>
    {what}{#if question?.inkOnly}<span class="muted"> · ink only mode</span>{/if}
  </p>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      imageLayerQuestion.answer(choice());
    }}
  >
    <div class="options" role="radiogroup" aria-label="Layer">
      <label class="option">
        <input type="radio" name="image-layer" value="new" bind:group={pick} data-testid="image-layer-new" />
        <span class="label">{count > 1 ? 'One new layer for all' : 'New layer'}</span>
        <input
          class="input name"
          aria-label="New layer name"
          bind:value={name}
          onfocus={() => (pick = 'new')}
          data-testid="image-layer-name"
        />
      </label>
      {#if count > 1}
        <label class="option">
          <input
            type="radio"
            name="image-layer"
            value="each"
            bind:group={pick}
            data-testid="image-layer-each"
          />
          <span class="label">A new layer for each image</span>
        </label>
      {/if}
      {#each imageLayers as layer (layer.id)}
        {@const n = imagesOn(layer.id)}
        <label class="option">
          <input
            type="radio"
            name="image-layer"
            value={layer.id}
            bind:group={pick}
            data-testid="image-layer-pick"
          />
          <span class="swatch" style:background={layer.color}></span>
          <span class="label">{layer.name}</span>
          <span class="muted small">{n === 0 ? 'empty' : n === 1 ? '1 image' : `${n} images`}</span>
        </label>
      {/each}
      {#if others > 0}
        <p class="muted small note">Line and fill layers burn shapes, so they are not listed for photos.</p>
      {/if}
    </div>
    <!-- Enter in the name field imports. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => imageLayerQuestion.answer(null)}>Cancel</button>
    <button
      type="button"
      class="btn signal"
      onclick={() => imageLayerQuestion.answer(choice())}
      data-testid="image-layer-confirm">Import</button
    >
  {/snippet}
</Dialog>

<style>
  .what {
    margin: 0 0 10px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 4px 8px;
    border-radius: var(--ol-radius-sm);
    cursor: pointer;
  }

  .option:hover {
    background: var(--ol-surface-2);
  }

  .option:has(input[type='radio']:checked) {
    background: var(--ol-surface-2);
    outline: 1px solid var(--ol-border-strong);
  }

  .label {
    flex-shrink: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    height: 28px;
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .option .small {
    margin-left: auto;
  }

  .small {
    font-size: var(--ol-fs-sm);
  }

  .note {
    margin: 6px 0 0;
  }
</style>
