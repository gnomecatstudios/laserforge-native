<script lang="ts">
  import {
    convertSelectedText,
    detachTextFromPath,
    weldSelectedText,
    addTextModifier,
  } from '../text-actions';
  import SectionToggle from '../workspace/SectionToggle.svelte';
  import { sections } from '../state/sections.svelte';
  import AlignStart from '@lucide/svelte/icons/text-align-start';
  import AlignCenter from '@lucide/svelte/icons/text-align-center';
  import AlignEnd from '@lucide/svelte/icons/text-align-end';
  import Italic from '@lucide/svelte/icons/italic';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { onMount } from 'svelte';
  import NumberField from '$lib/ui/NumberField.svelte';
  import { findFont, nearestWeight, styleLabel, type CatalogFont } from 'libopenlaser/fonts';
  import { fonts } from '../state/fonts.svelte';
  import type { TextAlign, TextObject, TextModifier, WarpPreset } from 'libopenlaser/project';
  import { editor } from '../state/editor.svelte';
  import { textOutlines } from '../state/text.svelte';
  import FontPicker from './FontPicker.svelte';
  import { dominantScript } from 'libopenlaser/fonts';

  let { object }: { object: TextObject } = $props();

  onMount(() => void fonts.init());

  const font = $derived(findFont(fonts.all, object.fontFamily));
  const weights = $derived(font?.weights ?? [400, 700]);
  const canItalic = $derived(font?.italic ?? true);
  const projectFonts = $derived([
    ...new Set(editor.project?.objects.flatMap((o) => (o.kind === 'text' ? [o.fontFamily] : [])) ?? []),
  ]);
  const ALIGNS: Array<{ id: TextAlign; label: string; icon: typeof AlignStart }> = [
    { id: 'left', label: 'Align left', icon: AlignStart },
    { id: 'center', label: 'Align center', icon: AlignCenter },
    { id: 'right', label: 'Align right', icon: AlignEnd },
  ];

  function updateModifier(index: number, patch: Partial<TextModifier>, live = false) {
    const modifiers = (object.modifiers ?? []).map((m, i) =>
      i === index ? ({ ...m, ...patch } as TextModifier) : m,
    );
    textOutlines.update(object.id, { modifiers }, { live, field: `modifier-${index}` });
  }
  function resetModifier(index: number) {
    const modifier = object.modifiers?.[index];
    if (!modifier) return;
    if (modifier.type === 'curve') updateModifier(index, { type: 'curve', parameters: { intensity: 0.25 } });
    else updateModifier(index, { type: 'warp', parameters: { preset: 'wave', intensity: 0.2 } });
  }
  function moveModifier(index: number, delta: number) {
    const modifiers = [...(object.modifiers ?? [])];
    const next = index + delta;
    if (next < 0 || next >= modifiers.length) return;
    [modifiers[index], modifiers[next]] = [modifiers[next], modifiers[index]];
    textOutlines.update(object.id, { modifiers });
  }
  function pickFont(next: CatalogFont) {
    textOutlines.update(object.id, {
      fontFamily: next.family,
      fontWeight: nearestWeight(next.weights, object.fontWeight),
      italic: object.italic && next.italic,
    });
  }
</script>

<section class="text" aria-label="Text" data-testid="text-inspector">
  <div class="head">
    <SectionToggle id="inspector">Text</SectionToggle>
    {#if textOutlines.pending.has(object.id)}<LoaderCircle
        size={14}
        class="spin"
        aria-label="Loading font"
      />{/if}
  </div>
  {#if sections.isOpen('inspector')}
    <textarea
      class="input content"
      rows={Math.min(6, Math.max(2, object.text.split('\n').length))}
      value={object.text}
      aria-label="Text"
      spellcheck="false"
      oninput={(e) =>
        textOutlines.update(object.id, { text: e.currentTarget.value }, { live: true, field: 'text' })}
      onblur={() => editor.sealHistory()}
      data-testid="text-content"
    ></textarea>
    <FontPicker
      value={object.fontFamily}
      {projectFonts}
      script={dominantScript(object.text)}
      onpick={pickFont}
    />
    <div class="row">
      <select
        class="input weight"
        aria-label="Weight"
        value={nearestWeight(weights, object.fontWeight)}
        onchange={(e) => textOutlines.update(object.id, { fontWeight: Number(e.currentTarget.value) })}
      >
        {#each weights as w (w)}<option value={w}>{styleLabel(w)}</option>{/each}
      </select>
      <button
        type="button"
        class="icon-btn"
        aria-label="Italic"
        aria-pressed={object.italic}
        disabled={!canItalic}
        onclick={() => textOutlines.update(object.id, { italic: !object.italic })}
        ><Italic size={16} /></button
      >
      <div class="segmented align" role="group" aria-label="Alignment">
        {#each ALIGNS as a (a.id)}
          <button
            type="button"
            aria-pressed={object.align === a.id}
            aria-label={a.label}
            title={a.label}
            onclick={() => textOutlines.update(object.id, { align: a.id })}
          >
            <a.icon size={15} />
          </button>
        {/each}
      </div>
    </div>
    <button
      type="button"
      class="btn"
      data-testid="text-to-paths"
      disabled={object.locked ||
        textOutlines.pending.has(object.id) ||
        object.outlineDirty ||
        !object.paths.length ||
        !!object.missingGlyphs?.length}
      onclick={convertSelectedText}>Convert text to paths</button
    >
    <button
      type="button"
      class="btn"
      disabled={object.locked ||
        textOutlines.pending.has(object.id) ||
        object.outlineDirty ||
        !object.paths.length ||
        !!object.missingGlyphs?.length}
      onclick={weldSelectedText}>Weld Letters</button
    >
    <fieldset disabled={object.locked}>
      <legend>Text modifiers</legend>
      {#each object.modifiers ?? [] as modifier, index (modifier.id)}
        <div class="modifier">
          <label
            ><input
              type="checkbox"
              checked={modifier.enabled}
              onchange={(e) => updateModifier(index, { enabled: e.currentTarget.checked })}
            />
            {modifier.type === 'curve' ? 'Curve' : 'Warp'}</label
          >
          {#if modifier.type === 'warp'}
            <select
              class="input"
              aria-label="Warp preset"
              value={modifier.parameters.preset}
              onchange={(e) =>
                updateModifier(index, {
                  parameters: { ...modifier.parameters, preset: e.currentTarget.value as WarpPreset },
                })}
            >
              {#each ['arch', 'inverted-arch', 'wave', 'bulge', 'squeeze', 'perspective', 'slant'] as preset (preset)}<option
                  value={preset}>{preset}</option
                >{/each}
            </select>
          {:else}
            <NumberField
              label="Curve radius (0 = automatic)"
              unit="mm"
              min={0}
              value={modifier.parameters.radius ?? 0}
              onchange={(value, live) =>
                updateModifier(index, { parameters: { ...modifier.parameters, radius: value } }, live)}
            />
            <NumberField
              label="Curve starting angle"
              unit="°"
              value={modifier.parameters.startAngle ?? 0}
              onchange={(value, live) =>
                updateModifier(index, { parameters: { ...modifier.parameters, startAngle: value } }, live)}
            />
            <NumberField
              label="Curve angular offset"
              unit="°"
              value={modifier.parameters.angularOffset ?? 0}
              onchange={(value, live) =>
                updateModifier(index, { parameters: { ...modifier.parameters, angularOffset: value } }, live)}
            />
            <label
              ><input
                type="checkbox"
                checked={modifier.parameters.reverse ?? false}
                onchange={(e) =>
                  updateModifier(index, {
                    parameters: { ...modifier.parameters, reverse: e.currentTarget.checked },
                  })}
              /> Reverse curve direction</label
            >
            <label
              ><input
                type="checkbox"
                checked={modifier.parameters.inside ?? false}
                onchange={(e) =>
                  updateModifier(index, {
                    parameters: { ...modifier.parameters, inside: e.currentTarget.checked },
                  })}
              /> Inside orientation</label
            >
          {/if}
          <NumberField
            label="Modifier intensity"
            value={modifier.parameters.intensity}
            min={-1}
            max={1}
            step={0.05}
            decimals={2}
            onchange={(value, live) =>
              updateModifier(index, { parameters: { ...modifier.parameters, intensity: value } }, live)}
          />
          <div class="row">
            <button
              type="button"
              class="btn ghost"
              aria-label="Move modifier up"
              disabled={index === 0}
              onclick={() => moveModifier(index, -1)}>↑</button
            >
            <button
              type="button"
              class="btn ghost"
              aria-label="Move modifier down"
              disabled={index === (object.modifiers?.length ?? 0) - 1}
              onclick={() => moveModifier(index, 1)}>↓</button
            >
            <button type="button" class="btn ghost" onclick={() => resetModifier(index)}>Reset</button>
            <button
              type="button"
              class="btn ghost"
              onclick={() =>
                textOutlines.update(object.id, {
                  modifiers: object.modifiers?.filter((_, i) => i !== index),
                })}>Remove</button
            >
          </div>
        </div>
      {/each}
      <div class="row">
        <button type="button" class="btn" onclick={() => addTextModifier('curve')}>Add Curve</button><button
          type="button"
          class="btn"
          onclick={() => addTextModifier('warp')}>Add Warp</button
        >
      </div>
    </fieldset>
    <p class="hint">Conversion enables node editing. Undo restores editable text.</p>
    <label class="hint" for="arc-angle">Arc text: {object.arcAngle ?? 0}°</label>
    <input
      id="arc-angle"
      type="range"
      min="-180"
      max="180"
      step="1"
      aria-label="Arc text angle"
      data-testid="text-arc-angle"
      value={object.arcAngle ?? 0}
      disabled={object.locked || !!object.pathLayout}
      oninput={(e) =>
        textOutlines.update(
          object.id,
          { arcAngle: Number(e.currentTarget.value) },
          { live: true, field: 'arc' },
        )}
      onchange={() => editor.sealHistory()}
    />
    <p class="hint">Negative bends down; positive bends up. Set 0° for straight text.</p>
    {#if object.pathLayout}
      <div class="grid" aria-label="Text on path">
        <NumberField
          label="Path offset"
          unit="mm"
          decimals={2}
          value={object.pathLayout.offset}
          onchange={(v, live) =>
            textOutlines.update(
              object.id,
              { pathLayout: { ...object.pathLayout!, offset: v } },
              { live, field: 'path-offset' },
            )}
        />
        <NumberField
          label="Baseline offset"
          unit="mm"
          decimals={2}
          value={object.pathLayout.normalOffset}
          onchange={(v, live) =>
            textOutlines.update(
              object.id,
              { pathLayout: { ...object.pathLayout!, normalOffset: v } },
              { live, field: 'baseline-offset' },
            )}
        />
      </div>
      <label
        ><input
          type="checkbox"
          checked={object.pathLayout.reverse}
          onchange={(e) =>
            textOutlines.update(object.id, {
              pathLayout: { ...object.pathLayout!, reverse: e.currentTarget.checked },
            })}
        /> Reverse path direction</label
      >
      <button type="button" class="btn" onclick={() => detachTextFromPath(object)}
        >Detach text from path</button
      >
      <p class="hint">
        Text stays editable and follows its guide curve. Long text wraps around closed paths or extends beyond
        open endpoints. Hide or disable output for the guide layer if it should not burn.
      </p>
    {:else}
      <p class="hint">For text on a path, select this text and one vector with a single path.</p>
    {/if}
    <div class="grid">
      <NumberField
        label="Size"
        unit="mm"
        decimals={1}
        step={0.5}
        min={0.5}
        max={500}
        value={object.fontSize}
        onchange={(v, live) => textOutlines.update(object.id, { fontSize: v }, { live, field: 'size' })}
        testid="text-size"
      />
      <NumberField
        label="Line height"
        unit="×"
        decimals={2}
        step={0.05}
        min={0.5}
        max={5}
        value={object.lineHeight}
        onchange={(v, live) => textOutlines.update(object.id, { lineHeight: v }, { live, field: 'leading' })}
      />
      <NumberField
        label="Letter spacing"
        unit="‰"
        step={5}
        min={-500}
        max={2000}
        value={object.letterSpacing}
        onchange={(v, live) =>
          textOutlines.update(object.id, { letterSpacing: v }, { live, field: 'tracking' })}
      />
    </div>
  {/if}
</section>

<style>
  fieldset {
    border: 1px solid var(--ol-border);
    padding: 10px;
    min-width: 0;
  }
  .modifier {
    display: grid;
    gap: 8px;
    margin-bottom: 12px;
  }
  .hint {
    margin: 0;
    font-size: var(--ol-fs-sm);
    color: var(--ol-text-muted);
  }

  .text {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-bottom: 1px solid var(--ol-border);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .content {
    height: auto;
    padding: 8px 10px;
    resize: vertical;
    line-height: 1.4;
  }

  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .weight {
    flex: 1;
    min-width: 0;
    appearance: auto;
  }

  .align button {
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
</style>
