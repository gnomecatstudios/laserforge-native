<script lang="ts">
  /**
   * Bitmap mode's side panel, one column top to bottom: where the image sits on the bed, the area to
   * work on (Separate colors, optional), how to trace it, what the laser does with the trace, and the
   * Trace button, which stays in view below the scrolling settings.
   */
  import Wand from '@lucide/svelte/icons/wand-sparkles';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import NumberField from '$lib/ui/NumberField.svelte';
  import Toggle from '$lib/ui/Toggle.svelte';
  import { TRACE_PRESETS } from 'libopenlaser/trace';
  import type { ImageObject } from 'libopenlaser/project';
  import { editor } from '../state/editor.svelte';
  import * as actions from '../actions';
  import BedThumbnail from './BedThumbnail.svelte';
  import SeparatePanel from './SeparatePanel.svelte';
  import type { Separation } from './separation.svelte';
  import { tracing, type TraceArea } from './trace.svelte';

  interface Props {
    separation: Separation;
    image: ImageObject;
    share: number;
    /** The trace preview is showing, so the trace follows every change. */
    live: boolean;
    /** A trace setting was changed: the stage switches to the trace preview. */
    onsettings: () => void;
  }

  let { separation, image, share, live, onsettings }: Props = $props();

  const asset = $derived(editor.project?.assets[image.assetId]);
  const options = $derived(tracing.options);
  const bw = $derived(options.mode === 'bw');

  $effect(() => {
    if (asset) void tracing.load(asset.id, asset.data);
  });

  /** Picked colors limit the trace; with none picked, the whole image is traced. */
  const area = $derived<TraceArea>({ selection: separation.selection, empty: separation.empty });

  // The live preview re-traces a moment after any change to the settings or the picks.
  $effect(() => {
    if (!live || !tracing.pixels) return;
    void tracing.options;
    void tracing.autoThreshold;
    tracing.schedule(area);
  });

  const adds = $derived(separation.picks.filter((p) => p.mode === 'add').length);
  const subtracts = $derived(separation.picks.length - adds);
  const colors = (n: number) => `${n} picked ${n === 1 ? 'color' : 'colors'}`;
  /** The picks select nothing (say a subtract covers every add): there is nothing to trace. */
  const nothing = $derived(!area.empty && !!separation.preview && share === 0);
  const scope = $derived(
    area.empty
      ? 'Tracing whole image'
      : nothing
        ? 'The picks leave nothing to trace'
        : separation.invert
          ? `Tracing everything except ${colors(adds)}`
          : `Tracing ${colors(adds)}${subtracts ? `, minus ${subtracts}` : ''}`,
  );

  let applying = $state(false);
  async function apply() {
    applying = true;
    try {
      await tracing.apply(image, area);
    } finally {
      applying = false;
    }
  }

  function preset(id: (typeof TRACE_PRESETS)[number]['id']) {
    tracing.usePreset(id);
    onsettings();
  }

  function set<K extends keyof typeof options>(key: K, value: (typeof options)[K]) {
    tracing.set(key, value);
    onsettings();
  }

  let cleaning = $state(false);
  async function keepInk(): Promise<void> {
    cleaning = true;
    try {
      await actions.keepOnlyInk(image.id);
    } finally {
      cleaning = false;
    }
  }
</script>

<aside class="panel" aria-label="Edit image" data-testid="trace-panel">
  <div class="scroll">
    <BedThumbnail {image} />

    <section class="step" aria-labelledby="step-area">
      <h3 id="step-area"><span class="num">1</span>Pick the area<span class="optional">Optional</span></h3>
      <p class="lead">Leave this empty to trace the whole image. Picked colors limit the trace to them.</p>
      <SeparatePanel {separation} {image} {share} />
      <button
        type="button"
        class="btn ghost ink"
        disabled={cleaning}
        onclick={keepInk}
        title="For a photo of a pen or marker drawing: removes shadows, uneven light and the paper, leaving black ink on a transparent background"
        data-testid="bitmap-keep-ink"
      >
        <PenLine size={15} />{cleaning ? 'Cleaning up…' : 'Ink only mode'}
      </button>
    </section>

    <section class="step" aria-labelledby="step-trace">
      <h3 id="step-trace"><span class="num">2</span>Trace settings</h3>
      <div class="presets" role="radiogroup" aria-label="Presets">
        {#each TRACE_PRESETS as p (p.id)}
          <button
            type="button"
            class="chip"
            role="radio"
            aria-checked={tracing.preset === p.id}
            onclick={() => preset(p.id)}
            data-testid="trace-preset-{p.id}">{p.label}</button
          >
        {/each}
      </div>

      <div class="segmented fill" role="group" aria-label="Mode">
        <button
          type="button"
          aria-pressed={options.mode === 'color'}
          title="One layer per color"
          onclick={() => set('mode', 'color')}>Color</button
        >
        <button
          type="button"
          aria-pressed={options.mode === 'gray'}
          title="One layer per shade of gray"
          onclick={() => set('mode', 'gray')}>Gray</button
        >
        <button
          type="button"
          aria-pressed={bw}
          title="One layer: everything darker than the threshold"
          onclick={() => set('mode', 'bw')}>B&amp;W</button
        >
      </div>

      {#if bw}
        <Toggle
          label="Auto threshold"
          hint="Picks the threshold from the image's own tones"
          checked={tracing.autoThreshold}
          onchange={(c) => {
            tracing.autoThreshold = c;
            onsettings();
          }}
        />
        <NumberField
          label="Threshold"
          hint="Gray level that splits dark from light, 0 to 255"
          value={tracing.autoThreshold ? 128 : options.threshold}
          min={0}
          max={255}
          disabled={tracing.autoThreshold}
          onchange={(v) => set('threshold', v)}
        />
      {:else}
        <NumberField
          label="Colors"
          hint="How many colors the image is reduced to. Each becomes a layer"
          value={options.colors}
          min={2}
          max={64}
          onchange={(v) => set('colors', v)}
        />
        <Toggle
          label="Drop background color"
          hint="Leaves out the color along the image edges"
          checked={options.ignoreBackground}
          onchange={(c) => set('ignoreBackground', c)}
        />
      {/if}

      <button
        type="button"
        class="advanced-toggle"
        aria-expanded={tracing.advancedOpen}
        aria-controls="trace-advanced"
        onclick={() => (tracing.advancedOpen = !tracing.advancedOpen)}
        data-testid="trace-advanced"
      >
        <ChevronRight size={15} class="chevron" />Advanced
      </button>
      {#if tracing.advancedOpen}
        <div class="advanced" id="trace-advanced">
          <NumberField
            label="Smoothness"
            hint="How much the traced curves are smoothed. Higher drops small bumps"
            value={options.smoothness}
            min={0}
            max={100}
            onchange={(v) => set('smoothness', v)}
          />
          <NumberField
            label="Corners"
            hint="How readily a bend becomes a sharp corner. Higher keeps more corners"
            value={options.corners}
            min={0}
            max={100}
            onchange={(v) => set('corners', v)}
          />
          <NumberField
            label="Ignore specks under"
            hint="Drops regions smaller than this many pixels"
            unit="px"
            value={options.speckle}
            min={0}
            max={500}
            onchange={(v) => set('speckle', v)}
          />
          <NumberField
            label="Denoise"
            hint="Blurs grain away before tracing, in pixels"
            unit="px"
            value={options.denoise}
            min={0}
            max={3}
            onchange={(v) => set('denoise', v)}
          />
          {#if !bw}
            <Toggle
              label="Stack layers (overlap burns twice)"
              hint="Each color's shape also covers the colors under it, as in a print. Overlaps burn more than once"
              checked={options.stacked}
              onchange={(c) => set('stacked', c)}
            />
          {/if}
        </div>
      {/if}
    </section>

    <section class="step" aria-labelledby="step-laser">
      <h3 id="step-laser"><span class="num">3</span>On the laser</h3>
      <div class="segmented fill" role="group" aria-label="Layer mode">
        <button
          type="button"
          aria-pressed={tracing.layerMode === 'fill'}
          onclick={() => (tracing.layerMode = 'fill')}>Engrave areas</button
        >
        <button
          type="button"
          aria-pressed={tracing.layerMode === 'line'}
          onclick={() => (tracing.layerMode = 'line')}>Cut outlines</button
        >
      </div>
      {#if !bw}
        <Toggle
          label="Darker colors burn harder"
          hint="Sets each layer's power from how dark its color is"
          checked={tracing.powerByShade}
          onchange={(c) => (tracing.powerByShade = c)}
        />
      {/if}
      <Toggle
        label="Keep the image underneath"
        hint="Keeps the photo, hidden, under the trace"
        checked={tracing.keepImage}
        onchange={(c) => (tracing.keepImage = c)}
      />
    </section>
  </div>

  <footer class="foot">
    <p class="scope" class:warn={nothing} data-testid="trace-scope">{scope}</p>
    <button
      type="button"
      class="btn start go"
      disabled={!tracing.pixels || applying || image.locked || nothing}
      title={image.locked ? `Unlock “${image.name}” in the Layers panel to trace it` : undefined}
      onclick={apply}
      data-testid="trace-apply"
    >
      {#if applying}<LoaderCircle size={15} class="spin" />Tracing…{:else}<Wand size={15} />Trace{/if}
    </button>
  </footer>
</aside>

<style>
  .panel {
    width: 260px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--ol-border);
    background: var(--ol-surface);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px;
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--ol-border);
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: var(--ol-fs-md);
  }

  .num {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--ol-surface-2);
    border: 1px solid var(--ol-border);
    font-size: var(--ol-fs-xs);
    font-weight: 600;
    color: var(--ol-text-2);
  }

  .optional {
    margin-left: auto;
    font-size: var(--ol-fs-xs);
    font-weight: 500;
    color: var(--ol-text-muted);
  }

  .lead {
    margin: 0;
    font-size: var(--ol-fs-sm);
    color: var(--ol-text-2);
  }

  .ink {
    align-self: flex-start;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--ol-border);
    background: var(--ol-bg);
    font-size: var(--ol-fs-sm);
  }

  .chip[aria-checked='true'] {
    border-color: var(--ol-signal);
    background: var(--ol-signal-tint);
  }

  .segmented.fill {
    display: flex;
  }

  .segmented.fill button {
    flex: 1;
  }

  .advanced-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
    margin-left: -4px;
    padding: 2px 4px;
    border: 0;
    border-radius: var(--ol-radius-sm);
    background: none;
    color: var(--ol-text-2);
    font-size: var(--ol-fs-sm);
    font-weight: 600;
  }

  .advanced-toggle:hover {
    background: var(--ol-surface-2);
  }

  .advanced-toggle :global(.chevron) {
    color: var(--ol-text-muted);
    transition: transform 0.15s ease;
  }

  .advanced-toggle[aria-expanded='true'] :global(.chevron) {
    transform: rotate(90deg);
  }

  .advanced {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .foot {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px 14px;
    border-top: 1px solid var(--ol-border);
    background: var(--ol-surface);
  }

  .scope {
    margin: 0;
    font-size: var(--ol-fs-sm);
    color: var(--ol-text-2);
  }

  .scope.warn {
    color: var(--ol-hold);
  }

  .go {
    justify-content: center;
  }
</style>
