<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import NumberField from '$lib/ui/NumberField.svelte';
  import { setObjectTransforms } from 'libopenlaser/project';
  import type { Project } from 'libopenlaser/project';
  import { arrangement } from '../state/arrange.svelte';
  import { editor } from '../state/editor.svelte';
  import { canvas } from '../state/canvas.svelte';
  import { currentBed } from '../state/work-area';
  import type { ArrangeSettings, ArrangeResult, ArrangeMode } from '../lib/arrange';

  const bed = currentBed();
  let settings = $state<ArrangeSettings>({
    mode: arrangement.mode,
    width: bed.width,
    height: bed.height,
    gap: 2,
    margin: 2,
    rotate: true,
    increment: 90,
    grain: 'unrestricted',
    angles: [0, 90, 180, 270],
    preserveGroups: true,
    respectLocked: true,
    holeNesting: false,
    rows: 0,
    columns: 0,
    radius: Math.min(bed.width, bed.height) / 3,
    startAngle: 0,
    sweep: 360,
    rotateAlongCircle: false,
  });
  let worker: Worker | null = null;
  let result = $state<ArrangeResult | null>(null);
  let busy = $state(false),
    progress = $state(0),
    error = $state(''),
    acceptPartial = $state(false);
  let baseline: Project | null = null;
  let signature = '';
  let angleInput = $state('0, 90, 180, 270');
  const holeEligible = $derived(
    !!editor.project?.jobSettings.optimizeOrder &&
      new Set(editor.project?.objects.filter((o) => editor.selection.has(o.id)).map((o) => o.layerId))
        .size === 1 &&
      editor.project?.objects
        .filter((o) => editor.selection.has(o.id))
        .every(
          (o) =>
            o.kind !== 'image' && editor.project?.layers.find((l) => l.id === o.layerId)?.mode === 'line',
        ),
  );
  const validPreview = $derived(
    result && signature === JSON.stringify(settings) && editor.project === baseline,
  );
  $effect(() => {
    if (!validPreview) canvas.layoutPreview = [];
  });
  function cancelWork() {
    worker?.terminate();
    worker = null;
    busy = false;
  }
  function close() {
    cancelWork();
    canvas.layoutPreview = [];
    arrangement.open = false;
  }
  onDestroy(() => {
    cancelWork();
    canvas.layoutPreview = [];
  });
  function preview() {
    cancelWork();
    result = null;
    error = '';
    acceptPartial = false;
    canvas.layoutPreview = [];
    if (!editor.project) return;
    if (settings.width > bed.width || settings.height > bed.height) {
      error = 'Material dimensions exceed the active machine work area.';
      return;
    }
    if (settings.holeNesting && !holeEligible) {
      error = 'Hole nesting requires one line layer and enabled inner-before-outer job optimization.';
      return;
    }
    baseline = editor.project;
    signature = JSON.stringify(settings);
    busy = true;
    progress = 0;
    worker = new Worker(new URL('../../lib/workers/arrange.worker.ts', import.meta.url), { type: 'module' });
    worker.onerror = () => {
      error = 'The arrangement worker failed. The original design is unchanged.';
      cancelWork();
    };
    worker.onmessage = (event) => {
      if ('progress' in event.data) {
        progress = event.data.progress;
        return;
      }
      if (event.data.error) error = event.data.error;
      else {
        result = event.data.result;
        const transforms = new Map(result!.transforms);
        canvas.layoutPreview = baseline!.objects
          .filter((o) => transforms.has(o.id))
          .map((o) => ({ ...o, transform: transforms.get(o.id)! }));
      }
      cancelWork();
    };
    worker.postMessage({
      project: $state.snapshot(baseline),
      ids: [...editor.selection],
      settings: $state.snapshot(settings),
      scope: editor.groupScope,
    });
  }
  function apply() {
    if (!validPreview || !result || (result.unplaced.length && !acceptPartial)) return;
    editor.sealHistory();
    editor.commit((p) => setObjectTransforms(p, new Map(result!.transforms)));
    close();
  }
</script>

<Dialog
  open={arrangement.open}
  title={arrangement.nesting ? 'Auto Nest' : 'Smart Arrange'}
  onclose={close}
  width={600}
>
  <div class="settings">
    <label
      >Arrangement mode<select class="input" aria-label="Arrangement mode" bind:value={settings.mode}>
        {#each [{ id: 'automatic', label: 'Automatic contextual arrangement' }, { id: 'horizontal', label: 'Horizontal' }, { id: 'vertical', label: 'Vertical' }, { id: 'grid', label: 'Grid' }, { id: 'circle', label: 'Circular' }, { id: 'staggered', label: 'Staggered packing' }, { id: 'contour', label: 'Contour nesting' }] as mode (mode.id)}<option
            value={mode.id as ArrangeMode}>{mode.label}</option
          >{/each}
      </select></label
    >
    <div class="fields">
      <NumberField
        label="Material width"
        unit="mm"
        min={1}
        max={bed.width}
        value={settings.width}
        onchange={(v) => (settings.width = v)}
      />
      <NumberField
        label="Material height"
        unit="mm"
        min={1}
        max={bed.height}
        value={settings.height}
        onchange={(v) => (settings.height = v)}
      />
      <NumberField
        label="Minimum spacing"
        unit="mm"
        min={0}
        decimals={2}
        value={settings.gap}
        onchange={(v) => (settings.gap = v)}
      />
      <NumberField
        label="Edge margin"
        unit="mm"
        min={0}
        decimals={2}
        value={settings.margin}
        onchange={(v) => (settings.margin = v)}
      />
      {#if settings.mode === 'grid' || settings.mode === 'staggered'}
        <NumberField
          label="Rows (0 = auto)"
          min={0}
          value={settings.rows}
          onchange={(v) => (settings.rows = v)}
        />
        <NumberField
          label="Columns (0 = auto)"
          min={0}
          value={settings.columns}
          onchange={(v) => (settings.columns = v)}
        />
      {/if}
      {#if settings.mode === 'circle'}
        <NumberField
          label="Circle radius"
          unit="mm"
          min={0}
          value={settings.radius}
          onchange={(v) => (settings.radius = v)}
        />
        <NumberField
          label="Starting angle"
          unit="°"
          value={settings.startAngle}
          onchange={(v) => (settings.startAngle = v)}
        />
        <NumberField
          label="Total arc angle"
          unit="°"
          min={-360}
          max={360}
          value={settings.sweep}
          onchange={(v) => (settings.sweep = v)}
        />
      {/if}
    </div>
    {#if settings.mode === 'circle'}<label
        ><input type="checkbox" bind:checked={settings.rotateAlongCircle} /> Rotate along circle</label
      >{/if}
    <label><input type="checkbox" bind:checked={settings.rotate} /> Allow automatic rotation</label>
    {#if settings.rotate}
      <label
        >Grain direction<select class="input" aria-label="Grain direction" bind:value={settings.grain}>
          <option value="unrestricted">Unrestricted</option><option value="horizontal">Horizontal</option
          ><option value="vertical">Vertical</option><option value="fixed">Fixed orientation</option><option
            value="custom">User-defined angles</option
          >
        </select></label
      >
      {#if settings.grain === 'custom'}<label
          >Allowed angles<input
            class="input"
            aria-label="Allowed angles"
            bind:value={angleInput}
            oninput={() => (settings.angles = angleInput.split(',').map((v) => Number(v.trim())))}
          /></label
        >
      {:else if settings.grain === 'unrestricted'}<NumberField
          label="Rotation increment"
          unit="°"
          min={5}
          max={360}
          value={settings.increment}
          onchange={(v) => (settings.increment = v)}
        />{/if}
    {/if}
    <label><input type="checkbox" bind:checked={settings.preserveGroups} /> Preserve group layouts</label>
    <label><input type="checkbox" bind:checked={settings.respectLocked} /> Respect locked objects</label>
    {#if arrangement.nesting}
      <label
        ><input type="checkbox" disabled={!holeEligible} bind:checked={settings.holeNesting} /> Nest in verified
        cutouts</label
      >
      {#if !holeEligible}<p>
          Cutout nesting requires one line layer with optimized inner-before-outer cutting enabled.
        </p>{/if}
    {/if}
    {#if busy}<p role="status">Finding valid placements… {Math.round(progress * 100)}%</p>
      <button type="button" class="btn" onclick={cancelWork}>Stop optimization</button>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
    {#if result}
      <p role="status">
        {result.placed.length} placed · {result.unplaced.length} unplaced · {result.utilization.toFixed(1)}%
        utilization
      </p>
      <p>
        Material: {result.materialArea.toFixed(1)} mm² · Occupied: {result.occupiedArea.toFixed(1)} mm² · Remaining:
        {result.remainingArea.toFixed(1)} mm². Occupied area uses the union of placed manufacturing footprints;
        overlapping artwork in a group is counted once. Stationary obstacles are excluded from this figure.
      </p>
      {#each result.warnings as warning (warning)}<p>{warning}</p>{/each}
      {#if result.unplaced.length}
        <p role="alert">
          Insufficient space or optimization limit. Unplaced objects remain at their original positions: {result.unplaced
            .map(
              (id) =>
                editor.project?.groups?.find((g) => g.id === id)?.name ??
                editor.project?.objects.find((o) => o.id === id)?.name ??
                id,
            )
            .join(', ')}.
        </p>
        <label><input type="checkbox" bind:checked={acceptPartial} /> Accept partial placement</label>
      {/if}
      {#if !validPreview}<p role="alert">The design or settings changed. Regenerate the preview.</p>{/if}
    {/if}
    <p>
      Preview leaves the original design unchanged. This bounded heuristic does not guarantee an optimal
      layout.
    </p>
  </div>
  {#snippet footer()}
    <button type="button" class="btn" onclick={close}>Cancel</button>
    <button type="button" class="btn" onclick={preview} disabled={busy}>Preview</button>
    <button
      type="button"
      class="btn start"
      onclick={apply}
      disabled={busy ||
        !validPreview ||
        !result?.transforms.length ||
        (!!result?.unplaced.length && !acceptPartial)}>Apply</button
    >
  {/snippet}
</Dialog>

<style>
  .settings {
    display: grid;
    gap: 12px;
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  p {
    margin: 0;
    color: var(--ol-text-muted);
    font-size: var(--ol-fs-sm);
  }
  label {
    display: grid;
    gap: 4px;
  }
  label:has(input[type='checkbox']) {
    display: flex;
    align-items: center;
  }
</style>
