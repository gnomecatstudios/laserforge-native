<script lang="ts">
  /**
   * Colors Bitmap mode draws the original with: the checkerboard boxes behind transparent and
   * erased areas, and the Separate tab's selection highlight. A view setting, saved with the
   * preferences, so it never changes the project or the engraving.
   */
  import { Popover } from 'bits-ui';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { DEFAULT_BITMAP_VIEW, type BitmapViewColors } from '$lib/storage/preferences';
  import {
    BACKDROP_PRESETS,
    HIGHLIGHT_PRESETS,
    checkerCss,
    sameBackdrop,
    sameColor,
  } from '../lib/bitmap-view';
  import { preferences } from '../state/preferences.svelte';

  let open = $state(false);
  const colors = $derived(preferences.value.bitmapView);
  const isDefault = $derived(
    sameBackdrop(colors.backdrop, DEFAULT_BITMAP_VIEW.backdrop) &&
      sameColor(colors.highlight, DEFAULT_BITMAP_VIEW.highlight),
  );

  /** Shows the change at once; `save` stores it (not on every step of a color picker drag). */
  function set(change: Partial<BitmapViewColors>, save = true) {
    const next = { ...colors, ...change };
    if (save) void preferences.update({ bitmapView: next });
    else preferences.value = { ...preferences.value, bitmapView: next };
  }

  function setBox(index: 0 | 1, color: string, save: boolean) {
    const backdrop: [string, string] = [colors.backdrop[0], colors.backdrop[1]];
    backdrop[index] = color;
    set({ backdrop }, save);
  }

  function reset() {
    set({ backdrop: [...DEFAULT_BITMAP_VIEW.backdrop], highlight: DEFAULT_BITMAP_VIEW.highlight });
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class="view-colors-trigger"
    aria-label="Backdrop and highlight colors"
    title="Backdrop and highlight colors"
    data-testid="bitmap-colors"
  >
    <span class="mini" style:background={checkerCss(colors.backdrop, 4)}>
      <span class="dot" style:background={colors.highlight}></span>
    </span>
    Colors
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      class="ol-menu view-colors"
      side="top"
      align="end"
      sideOffset={6}
      data-testid="bitmap-colors-menu"
    >
      <section aria-labelledby="backdrop-head">
        <h4 id="backdrop-head">Backdrop</h4>
        <p class="hint">The boxes behind transparent and erased areas.</p>
        <div class="chips" role="group" aria-label="Backdrop presets">
          {#each BACKDROP_PRESETS as preset (preset.name)}
            <button
              type="button"
              class="chip"
              aria-pressed={sameBackdrop(preset.colors, colors.backdrop)}
              aria-label={preset.name}
              title={preset.name}
              style:background={checkerCss(preset.colors, 5)}
              onclick={() => set({ backdrop: [...preset.colors] })}
            ></button>
          {/each}
        </div>
        <div class="custom">
          {#each [0, 1] as const as i (i)}
            <label class="pick">
              <input
                type="color"
                value={colors.backdrop[i]}
                oninput={(e) => setBox(i, e.currentTarget.value, false)}
                onchange={(e) => setBox(i, e.currentTarget.value, true)}
                data-testid="bitmap-backdrop-{i + 1}"
              />
              Box {i + 1}
            </label>
          {/each}
        </div>
      </section>

      <section aria-labelledby="highlight-head">
        <h4 id="highlight-head">Selection highlight</h4>
        <p class="hint">Tints the picked colors in the Separate tab.</p>
        <div class="chips" role="group" aria-label="Highlight presets">
          {#each HIGHLIGHT_PRESETS as preset (preset.name)}
            <button
              type="button"
              class="chip"
              aria-pressed={sameColor(preset.color, colors.highlight)}
              aria-label={preset.name}
              title={preset.name}
              style:background={preset.color}
              onclick={() => set({ highlight: preset.color })}
            ></button>
          {/each}
        </div>
        <div class="custom">
          <label class="pick">
            <input
              type="color"
              value={colors.highlight}
              oninput={(e) => set({ highlight: e.currentTarget.value }, false)}
              onchange={(e) => set({ highlight: e.currentTarget.value })}
              data-testid="bitmap-highlight"
            />
            Custom
          </label>
        </div>
      </section>

      <button
        type="button"
        class="btn ghost small"
        disabled={isDefault}
        onclick={reset}
        data-testid="bitmap-colors-reset"
      >
        <RotateCcw size={14} />Reset colors
      </button>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.view-colors-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px 0 4px;
    border-radius: var(--ol-radius-sm);
    border: 1px solid var(--ol-border);
    background: var(--ol-bg);
    color: var(--ol-text-muted);
    font-size: var(--ol-fs-sm);
    font-weight: 500;
  }

  :global(.view-colors-trigger:hover),
  :global(.view-colors-trigger[data-state='open']) {
    color: var(--ol-text);
    border-color: var(--ol-border-strong);
  }

  .mini {
    position: relative;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid var(--ol-border-strong);
  }

  .dot {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--ol-surface);
  }

  :global(.view-colors) {
    min-width: 0 !important;
    width: 232px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 10px !important;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  h4 {
    margin: 0;
    font-size: var(--ol-fs-sm);
    font-weight: 600;
  }

  .hint {
    margin: -2px 0 0;
    font-size: var(--ol-fs-xs);
    color: var(--ol-text-muted);
  }

  .chips {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }

  .chip {
    aspect-ratio: 1;
    padding: 0;
    border-radius: 6px;
    border: 1px solid var(--ol-border-strong);
    outline: 2px solid transparent;
    outline-offset: 1px;
  }

  .chip[aria-pressed='true'] {
    outline-color: var(--ol-text);
  }

  .custom {
    display: flex;
    gap: 10px;
  }

  .pick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--ol-fs-sm);
    color: var(--ol-text-muted);
    cursor: pointer;
  }

  .pick input {
    width: 28px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--ol-border-strong);
    border-radius: 4px;
    background: none;
    cursor: pointer;
  }

  .pick input::-webkit-color-swatch-wrapper {
    padding: 2px;
  }

  .pick input::-webkit-color-swatch {
    border: 0;
    border-radius: 2px;
  }

  .btn.small {
    align-self: flex-start;
  }
</style>
