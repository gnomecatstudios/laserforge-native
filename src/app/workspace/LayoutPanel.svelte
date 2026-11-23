<script lang="ts">
  import { onDestroy } from 'svelte';
  import NumberField from '$lib/ui/NumberField.svelte';
  import { addObjects, makeId, setObjectTransforms, cloneGroupMetadata } from 'libopenlaser/project';
  import { editor } from '../state/editor.svelte';
  import { textOutlines } from '../state/text.svelte';
  import { canvas } from '../state/canvas.svelte';
  import { currentBed } from '../state/work-area';
  import { flipsX, yGrowsDown } from '../canvas/viewport';
  import { boundsOf } from '../lib/selection';
  import {
    rigidLayout,
    alignObjects,
    distributeObjects,
    arrayCopies,
    MAX_ARRAY_OBJECTS,
    type Alignment,
  } from '../lib/layout';
  import { attachTextToPath, canAttachTextToPath } from '../text-actions';

  const selected = $derived(editor.project?.objects.filter((o) => editor.selection.has(o.id)) ?? []);
  const movable = $derived(selected.filter((o) => !o.locked && o.visible));
  const bounds = $derived(boundsOf(movable));
  const bed = $derived(currentBed());
  let target = $state('selection');
  let array = $state('none');
  let rows = $state(2),
    columns = $state(2),
    gapX = $state(5),
    gapY = $state(5);
  let count = $state(6),
    cx = $state(0),
    cy = $state(0),
    sweep = $state(360),
    rotate = $state(false);
  const last = $derived(editor.project?.objects.find((o) => o.id === [...editor.selection].at(-1)));
  const ready = $derived(
    movable.length > 0 &&
      movable.length === selected.length &&
      !movable.some((o) => o.kind === 'text' && (textOutlines.pending.has(o.id) || !o.paths.length)),
  );
  const total = $derived((array === 'grid' ? rows * columns : count) * movable.length);
  const copies = $derived(
    !ready || array === 'none'
      ? []
      : arrayCopies(
          movable,
          array === 'grid'
            ? {
                kind: 'grid',
                rows,
                columns,
                gapX,
                gapY,
                directionX: flipsX(bed) ? -1 : 1,
                directionY: yGrowsDown(bed) ? 1 : -1,
              }
            : { kind: 'circle', count, center: { x: cx, y: cy }, sweep, rotate },
        ),
  );
  $effect(() => {
    canvas.layoutPreview = editor.view === 'design' ? copies : [];
  });
  onDestroy(() => {
    canvas.layoutPreview = [];
  });

  function align(value: Alignment) {
    if (!bounds) return;
    const reference =
      target === 'bed'
        ? { minX: 0, minY: 0, maxX: bed.width, maxY: bed.height }
        : target === 'last' && last
          ? boundsOf([last])
          : bounds;
    if (!reference) return;
    const actual =
      flipsX(bed) && value === 'left'
        ? 'right'
        : flipsX(bed) && value === 'right'
          ? 'left'
          : yGrowsDown(bed) && value === 'top'
            ? 'bottom'
            : yGrowsDown(bed) && value === 'bottom'
              ? 'top'
              : value;
    const transforms = rigidLayout(editor.project!, movable, editor.groupScope, (units) =>
      alignObjects(
        target === 'last' ? units.filter((o) => o.id !== (last ? editor.scopeUnit(last.id) : null)) : units,
        reference,
        actual,
      ),
    );
    editor.commit((p) => setObjectTransforms(p, transforms));
  }
  function distribute(axis: 'x' | 'y', mode: 'centers' | 'gaps') {
    editor.commit((p) =>
      setObjectTransforms(
        p,
        rigidLayout(p, movable, editor.groupScope, (units) => distributeObjects(units, axis, mode)),
      ),
    );
  }
  function applyArray() {
    if (!copies.length) return;
    const added = copies.map((o) => ({ ...o, id: makeId() }));
    const original = movable.map((o) => o.id);
    editor.commit((p) => {
      const groups = [];
      for (let start = 0; start < added.length; start += movable.length) {
        const mapping = new Map(movable.map((o, i) => [o.id, added[start + i].id]));
        groups.push(...cloneGroupMetadata(p, mapping, makeId));
        for (let i = start; i < start + movable.length; i++) {
          const object = added[i];
          if (object.kind === 'text' && object.pathLayout?.guideId && mapping.has(object.pathLayout.guideId))
            added[i] = {
              ...object,
              pathLayout: { ...object.pathLayout, guideId: mapping.get(object.pathLayout.guideId) },
            };
        }
      }
      return addObjects({ ...p, groups: [...(p.groups ?? []), ...groups] }, added);
    });
    array = 'none';
    editor.select([...original, ...added.map((o) => o.id)]);
  }
</script>

{#if editor.view === 'design' && selected.length}
  <section class="layout" aria-label="Layout" data-testid="layout-panel">
    <h3>Layout</h3>
    <label class="target"
      >Align to
      <select class="input" bind:value={target} aria-label="Align to">
        <option value="selection">Selection bounds</option>
        <option value="last">Last-selected object</option>
        <option value="bed">Bed</option>
      </select>
    </label>
    <div class="buttons" role="group" aria-label="Object alignment">
      {#each [{ id: 'left', label: 'Left' }, { id: 'center-x', label: 'Centre X' }, { id: 'right', label: 'Right' }, { id: 'top', label: 'Top' }, { id: 'center-y', label: 'Centre Y' }, { id: 'bottom', label: 'Bottom' }] as item (item.id)}
        <button
          type="button"
          class="btn ghost"
          disabled={!movable.length || (target !== 'bed' && selected.length < 2)}
          onclick={() => align(item.id as Alignment)}
          aria-label="Align {item.label}">{item.label}</button
        >
      {/each}
    </div>
    <div class="buttons" role="group" aria-label="Distribution">
      <button
        type="button"
        class="btn ghost"
        disabled={movable.length < 3}
        onclick={() => distribute('x', 'centers')}>Space centres X</button
      >
      <button
        type="button"
        class="btn ghost"
        disabled={movable.length < 3}
        onclick={() => distribute('y', 'centers')}>Space centres Y</button
      >
      <button
        type="button"
        class="btn ghost"
        disabled={movable.length < 3}
        onclick={() => distribute('x', 'gaps')}>Equal gaps X</button
      >
      <button
        type="button"
        class="btn ghost"
        disabled={movable.length < 3}
        onclick={() => distribute('y', 'gaps')}>Equal gaps Y</button
      >
    </div>
    <label class="target"
      >Repeat
      <select
        class="input"
        value={array}
        onchange={(e) => {
          array = e.currentTarget.value;
          if (array === 'circle' && bounds) {
            cx = (bounds.minX + bounds.maxX) / 2;
            cy = bounds.minY - Math.max(20, (bounds.maxY - bounds.minY) / 2);
          }
        }}
        aria-label="Array type"
        disabled={!ready}
      >
        <option value="none">None</option><option value="grid">Rectangular array</option><option
          value="circle">Circular array</option
        >
      </select>
    </label>
    {#if array !== 'none'}
      <div class="fields">
        {#if array === 'grid'}
          <NumberField label="Rows" value={rows} min={1} max={1000} onchange={(v) => (rows = v)} />
          <NumberField label="Columns" value={columns} min={1} max={1000} onchange={(v) => (columns = v)} />
          <NumberField label="X gap" unit="mm" value={gapX} decimals={2} onchange={(v) => (gapX = v)} />
          <NumberField label="Y gap" unit="mm" value={gapY} decimals={2} onchange={(v) => (gapY = v)} />
        {:else}
          <NumberField label="Count" value={count} min={2} max={1000} onchange={(v) => (count = v)} />
          <NumberField
            label="Sweep"
            unit="°"
            value={sweep}
            min={-360}
            max={360}
            decimals={1}
            onchange={(v) => (sweep = v)}
          />
          <NumberField label="Centre X" unit="mm" value={cx} decimals={2} onchange={(v) => (cx = v)} />
          <NumberField label="Centre Y" unit="mm" value={cy} decimals={2} onchange={(v) => (cy = v)} />
        {/if}
      </div>
      {#if array === 'circle'}
        <label><input type="checkbox" bind:checked={rotate} /> Rotate copies</label>
        {#if movable.some((o) => o.kind === 'image')}<p>Images keep their orientation.</p>{/if}
      {/if}
      <p>
        Live preview · Counts include the original. Gaps are between selection edges. Circular centres use bed
        coordinates.
      </p>
      {#if total > MAX_ARRAY_OBJECTS}<p role="alert">
          Use at most {MAX_ARRAY_OBJECTS} objects per array.
        </p>{/if}
      <div class="actions">
        <button type="button" class="btn" onclick={() => (array = 'none')}>Cancel array</button>
        <button type="button" class="btn start" disabled={!copies.length} onclick={applyArray}
          >Create array</button
        >
      </div>
    {/if}
    {#if canAttachTextToPath(selected)}
      <button type="button" class="btn" onclick={attachTextToPath}>Text on selected path</button>
      <p>Uses a copy of the path. The original remains in its layer.</p>
    {/if}
  </section>
{/if}

<style>
  .layout {
    padding: 16px;
    border-bottom: 1px solid var(--ol-border);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h3 {
    margin: 0;
    font-size: var(--ol-fs-md);
  }
  .target {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .buttons button {
    flex: 1 1 28%;
    font-size: var(--ol-fs-sm);
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  p {
    margin: 0;
    color: var(--ol-text-muted);
    font-size: var(--ol-fs-sm);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
