<script lang="ts">
  import { onDestroy } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import NumberField from '$lib/ui/NumberField.svelte';
  import Toggle from '$lib/ui/Toggle.svelte';
  import { confirm } from '$lib/ui/confirm.svelte';
  import { toast } from '$lib/ui/toasts.svelte';
  import SectionToggle from './SectionToggle.svelte';
  import { sections } from '../state/sections.svelte';
  import { preview } from '../state/preview.svelte';
  import { profiles } from '../state/profiles.svelte';
  import { pricing } from '../state/pricing.svelte';
  import { duration } from '../lib/format';
  import {
    money,
    piecePositions,
    piecesPerSheet,
    priceBreakdown,
    pricingProblem,
    type PricingInputs,
  } from '../lib/pricing';
  import { extrasTotal, type PricingJob } from '../lib/pricing-data';

  /** More pieces than this draw as one block in the layout preview. */
  const MAX_DRAWN = 1500;

  void pricing.load();
  onDestroy(() => void pricing.flush());

  const job = $derived(pricing.job);
  const machine = $derived(pricing.machine);
  const source = $derived(preview.source);

  /** The bounding box of what the job in Preview burns. */
  const design = $derived.by(() => {
    const b = source?.bounds;
    if (!b) return null;
    const width = b.maxX - b.minX;
    const height = b.maxY - b.minY;
    return width > 0 && height > 0 ? { width, height } : null;
  });
  const estimate = $derived(source?.stats ? source.stats.estimatedSeconds / 60 : null);

  const usingDesign = $derived(job.piece.fromDesign && design !== null);
  const piece = $derived(
    usingDesign && design ? design : { width: job.piece.width, height: job.piece.height },
  );
  const usingEstimate = $derived(job.time.cutFromJob && estimate !== null);
  const cutMinutes = $derived(usingEstimate && estimate !== null ? estimate : job.time.cutMinutes);

  const bed = $derived({ width: machine.bedWidth, height: machine.bedHeight });
  const fit = $derived(
    piecesPerSheet({ width: job.sheet.width, height: job.sheet.height }, bed, piece, job.piece.spacing),
  );
  const extras = $derived(extrasTotal(job.extras));
  const inputs = $derived<PricingInputs>({
    machineRate: machine.hourlyRate,
    sheetCost: job.sheet.cost,
    piecesPerSheet: fit.count,
    extras,
    cutMinutes,
    labourMinutes: job.time.labourMinutes,
    setupMinutes: job.time.setupMinutes,
    batchSize: job.time.batchSize,
    labourRate: job.labourRate,
    feePercent: job.feePercent,
    markup: job.markup,
  });
  const problem = $derived(pricingProblem(inputs));
  const result = $derived(priceBreakdown(inputs));

  // Layout preview: the sheet as it sits on the bed, the bed outline, and the pieces.
  const view = $derived({
    width: Math.max(bed.width, fit.sheet.width),
    height: Math.max(bed.height, fit.sheet.height),
  });
  const positions = $derived(fit.count <= MAX_DRAWN ? piecePositions(fit, job.piece.spacing) : []);
  const block = $derived({
    width: fit.columns * fit.piece.width + Math.max(0, fit.columns - 1) * job.piece.spacing,
    height: fit.rows * fit.piece.height + Math.max(0, fit.rows - 1) * job.piece.spacing,
  });
  const overhangs = $derived(fit.sheet.width > bed.width + 1e-9 || fit.sheet.height > bed.height + 1e-9);

  // Product presets.
  const product = $derived(pricing.product);
  /** The name box follows the product loaded and can be edited to save under another name. */
  let name = $derived(product?.name ?? '');
  const edited = $derived(!!product && JSON.stringify(product.job) !== JSON.stringify(job));

  function mm(value: number): string {
    return String(Math.round(value * 10) / 10);
  }

  function minutes(value: number): string {
    return `${Math.round(value * 100) / 100} min`;
  }

  const setSheet = (patch: Partial<PricingJob['sheet']>) =>
    pricing.updateJob((j) => ({ ...j, sheet: { ...j.sheet, ...patch } }));
  const setPiece = (patch: Partial<PricingJob['piece']>) =>
    pricing.updateJob((j) => ({ ...j, piece: { ...j.piece, ...patch } }));
  const setExtras = (patch: Partial<PricingJob['extras']>) =>
    pricing.updateJob((j) => ({ ...j, extras: { ...j.extras, ...patch } }));
  const setTime = (patch: Partial<PricingJob['time']>) =>
    pricing.updateJob((j) => ({ ...j, time: { ...j.time, ...patch } }));
  const setRates = (patch: Partial<Pick<PricingJob, 'labourRate' | 'feePercent' | 'markup'>>) =>
    pricing.updateJob((j) => ({ ...j, ...patch }));

  /** Turning off "size from design" starts the manual size at the design's. */
  function sizeFromDesign(on: boolean) {
    if (!on && design)
      setPiece({ fromDesign: false, width: round(design.width, 1), height: round(design.height, 1) });
    else setPiece({ fromDesign: on });
  }

  /** Turning off "use job estimate" starts the manual time at the estimate. */
  function timeFromJob(on: boolean) {
    if (!on && estimate !== null) setTime({ cutFromJob: false, cutMinutes: round(estimate, 2) });
    else setTime({ cutFromJob: on });
  }

  function round(value: number, decimals: number): number {
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
  }

  function addMachine() {
    const from = profiles.active;
    pricing.addMachine({
      name: from.name,
      bedWidth: from.bedWidth,
      bedHeight: from.bedHeight,
      hourlyRate: machine.hourlyRate,
    });
  }

  async function removeMachine() {
    const ok = await confirm({
      title: `Delete ${machine.name}?`,
      message: 'Products priced on it switch to another machine.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) pricing.removeMachine();
  }

  function saveProduct() {
    const clean = name.trim();
    if (!clean) return;
    pricing.saveProduct(clean);
    toast.success(`Saved “${clean}”.`);
  }

  async function deleteProduct() {
    if (!product) return;
    const ok = await confirm({
      title: `Delete ${product.name}?`,
      message: 'The inputs on screen stay as they are.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) pricing.deleteProduct(product.id);
  }
</script>

<section class="pricing" aria-label="Pricing calculator" data-testid="pricing-panel">
  <div class="head">
    <SectionToggle id="pricing">Pricing</SectionToggle>
    <span class="hint">Per piece, for this design</span>
  </div>

  {#if sections.isOpen('pricing')}
    {#if !pricing.loaded}
      <p class="muted small">Loading…</p>
    {:else}
      <div class="group">
        <div class="row">
          <label class="field grow"
            >Product
            <select
              class="input"
              value={pricing.data.productId ?? ''}
              onchange={(e) => {
                const id = e.currentTarget.value;
                if (id) pricing.loadProduct(id);
              }}
              data-testid="pricing-product"
            >
              <option value="" disabled
                >{pricing.data.products.length ? 'Choose a product' : 'No saved products'}</option
              >
              {#each pricing.data.products as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          </label>
          <button
            type="button"
            class="icon-btn"
            aria-label="Delete product"
            title="Delete product"
            disabled={!product}
            onclick={deleteProduct}><Trash2 size={16} /></button
          >
        </div>
        <div class="row">
          <input
            class="input grow"
            type="text"
            placeholder="Product name, e.g. W pin"
            aria-label="Product name"
            maxlength="80"
            bind:value={name}
            onkeydown={(e) => e.key === 'Enter' && saveProduct()}
            data-testid="pricing-product-name"
          />
          <button
            type="button"
            class="btn"
            disabled={!name.trim()}
            onclick={saveProduct}
            data-testid="pricing-save-product">Save</button
          >
        </div>
        {#if edited}<p class="muted small">Changed since “{product?.name}” was saved.</p>{/if}
      </div>

      {#if result}
        <dl class="summary" data-testid="pricing-summary">
          <div class="tile main">
            <dt>Suggested retail</dt>
            <dd class="mono" data-testid="pricing-price">{money(result.price)}</dd>
          </div>
          <div class="tile">
            <dt>Cost</dt>
            <dd class="mono" data-testid="pricing-cost">{money(result.cost)}</dd>
          </div>
          <div class="tile">
            <dt>Profit</dt>
            <dd class="mono" class:loss={result.profit < 0} data-testid="pricing-profit">
              {money(result.profit)}
            </dd>
          </div>
          <div class="tile">
            <dt>Per hour</dt>
            <dd class="mono" data-testid="pricing-hourly">
              {result.hourly === null ? '—' : `${money(result.hourly)}/h`}
            </dd>
          </div>
        </dl>
      {:else if problem}
        <p class="note" role="status" data-testid="pricing-problem">{problem}</p>
      {/if}

      <div class="group">
        <div class="row">
          <h3 class="grow">Machine</h3>
          <button
            type="button"
            class="icon-btn sm"
            aria-label="Add machine"
            title="Add machine (starts from {profiles.active.name})"
            onclick={addMachine}><Plus size={16} /></button
          >
          <button
            type="button"
            class="icon-btn sm"
            aria-label="Delete machine"
            title="Delete machine"
            disabled={pricing.data.machines.length <= 1}
            onclick={removeMachine}><Trash2 size={15} /></button
          >
        </div>
        <select
          class="input"
          aria-label="Machine"
          value={machine.id}
          onchange={(e) => pricing.selectMachine(e.currentTarget.value)}
          data-testid="pricing-machine"
        >
          {#each pricing.data.machines as m (m.id)}
            <option value={m.id}>{m.name}</option>
          {/each}
        </select>
        <label class="field"
          >Name
          <input
            class="input"
            type="text"
            maxlength="80"
            value={machine.name}
            onchange={(e) => {
              const v = e.currentTarget.value.trim();
              if (v) pricing.updateMachine({ name: v });
              else e.currentTarget.value = machine.name;
            }}
            data-testid="pricing-machine-name"
          />
        </label>
        <div class="grid three">
          <NumberField
            label="Bed width"
            unit="mm"
            value={machine.bedWidth}
            min={1}
            max={10000}
            decimals={1}
            stepper={false}
            onchange={(v) => pricing.updateMachine({ bedWidth: v })}
            testid="pricing-bed-width"
          />
          <NumberField
            label="Bed height"
            unit="mm"
            value={machine.bedHeight}
            min={1}
            max={10000}
            decimals={1}
            stepper={false}
            onchange={(v) => pricing.updateMachine({ bedHeight: v })}
            testid="pricing-bed-height"
          />
          <NumberField
            label="Rate"
            unit="$/h"
            value={machine.hourlyRate}
            min={0}
            decimals={2}
            step={0.25}
            stepper={false}
            onchange={(v) => pricing.updateMachine({ hourlyRate: v })}
            hint="What an hour of laser time costs you: power, tube wear, upkeep."
            testid="pricing-machine-rate"
          />
        </div>
      </div>

      <div class="group">
        <h3>Sheet</h3>
        <label class="field"
          >Material
          <input
            class="input"
            type="text"
            maxlength="80"
            value={job.sheet.name}
            onchange={(e) => setSheet({ name: e.currentTarget.value.trim() || job.sheet.name })}
            data-testid="pricing-sheet-name"
          />
        </label>
        <div class="grid">
          <NumberField
            label="Width"
            unit="mm"
            value={job.sheet.width}
            min={0.1}
            max={10000}
            decimals={1}
            onchange={(v) => setSheet({ width: v })}
            testid="pricing-sheet-width"
          />
          <NumberField
            label="Height"
            unit="mm"
            value={job.sheet.height}
            min={0.1}
            max={10000}
            decimals={1}
            onchange={(v) => setSheet({ height: v })}
            testid="pricing-sheet-height"
          />
          <NumberField
            label="Thickness"
            unit="mm"
            value={job.sheet.thickness}
            min={0}
            max={1000}
            decimals={2}
            step={0.5}
            onchange={(v) => setSheet({ thickness: v })}
          />
          <NumberField
            label="Sheet cost"
            unit="$"
            value={job.sheet.cost}
            min={0}
            decimals={2}
            step={0.5}
            onchange={(v) => setSheet({ cost: v })}
            hint="Use $0, or a replacement value, for offcuts and salvage."
            testid="pricing-sheet-cost"
          />
        </div>
      </div>

      <div class="group">
        <h3>Piece</h3>
        <Toggle
          label="Size from design"
          checked={job.piece.fromDesign}
          onchange={sizeFromDesign}
          hint="Use the bounding box of the design in Preview."
          testid="pricing-from-design"
        />
        <div class="grid three">
          <NumberField
            label="Width"
            unit="mm"
            value={round(piece.width, 1)}
            min={0.1}
            max={10000}
            decimals={1}
            stepper={false}
            disabled={usingDesign}
            onchange={(v) => setPiece({ width: v })}
            testid="pricing-piece-width"
          />
          <NumberField
            label="Height"
            unit="mm"
            value={round(piece.height, 1)}
            min={0.1}
            max={10000}
            decimals={1}
            stepper={false}
            disabled={usingDesign}
            onchange={(v) => setPiece({ height: v })}
            testid="pricing-piece-height"
          />
          <NumberField
            label="Spacing"
            unit="mm"
            value={job.piece.spacing}
            min={0}
            max={1000}
            decimals={1}
            stepper={false}
            onchange={(v) => setPiece({ spacing: v })}
            hint="Gap between neighbouring pieces, for kerf and clearance."
            testid="pricing-spacing"
          />
        </div>
        {#if job.piece.fromDesign && !design}
          <p class="muted small">
            {preview.compiling ? 'Measuring the design…' : 'Nothing to measure yet; using the size above.'}
          </p>
        {/if}

        <figure class="fit" data-testid="pricing-layout">
          <svg
            viewBox="-2 -2 {view.width + 4} {view.height + 4}"
            role="img"
            aria-label="{fit.count} pieces on the sheet, {fit.columns} by {fit.rows}"
          >
            <rect
              class="sheet"
              x="0"
              y="0"
              width={fit.sheet.width}
              height={fit.sheet.height}
              vector-effect="non-scaling-stroke"
            />
            <rect
              class="bed"
              x="0"
              y="0"
              width={bed.width}
              height={bed.height}
              vector-effect="non-scaling-stroke"
            />
            {#if fit.count > MAX_DRAWN}
              <rect
                class="piece"
                x="0"
                y="0"
                width={block.width}
                height={block.height}
                vector-effect="non-scaling-stroke"
              />
            {:else}
              {#each positions as p, i (i)}
                <rect
                  class="piece"
                  x={p.x}
                  y={p.y}
                  width={fit.piece.width}
                  height={fit.piece.height}
                  vector-effect="non-scaling-stroke"
                />
              {/each}
            {/if}
          </svg>
          <figcaption>
            <span data-testid="pricing-per-sheet"
              ><strong class="mono">{fit.count}</strong> per sheet{#if fit.count}
                · {fit.columns} × {fit.rows}{/if}{#if fit.rotated}
                · piece turned 90°{/if}{#if fit.sheetRotated}
                · sheet turned 90°{/if}</span
            >
            <span class="muted mono"
              >Bed {mm(bed.width)} × {mm(bed.height)} · sheet {mm(job.sheet.width)} × {mm(job.sheet.height)} · piece
              {mm(piece.width)} × {mm(piece.height)} mm</span
            >
            {#if overhangs}<span class="muted">Only the part of the sheet on the bed is used.</span>{/if}
          </figcaption>
        </figure>
      </div>

      <div class="group">
        <h3>Extras per piece</h3>
        <div class="grid">
          <NumberField
            label="Paint"
            unit="$"
            value={job.extras.paint}
            min={0}
            decimals={2}
            step={0.05}
            onchange={(v) => setExtras({ paint: v })}
          />
          <NumberField
            label="Sealer"
            unit="$"
            value={job.extras.sealer}
            min={0}
            decimals={2}
            step={0.05}
            onchange={(v) => setExtras({ sealer: v })}
          />
          <NumberField
            label="Pin backs"
            unit="$"
            value={job.extras.pinBacks}
            min={0}
            decimals={2}
            step={0.05}
            onchange={(v) => setExtras({ pinBacks: v })}
            testid="pricing-pin-backs"
          />
          <NumberField
            label="Packaging"
            unit="$"
            value={job.extras.packaging}
            min={0}
            decimals={2}
            step={0.05}
            onchange={(v) => setExtras({ packaging: v })}
          />
        </div>
      </div>

      <div class="group">
        <h3>Time</h3>
        <Toggle
          label="Cut time from job estimate"
          checked={job.time.cutFromJob}
          onchange={timeFromJob}
          hint="Use Preview's time estimate for the whole design as the time per piece."
          testid="pricing-from-job"
        />
        <div class="grid">
          <NumberField
            label="Cut per piece"
            unit="min"
            value={round(cutMinutes, 2)}
            min={0}
            decimals={2}
            step={0.5}
            disabled={usingEstimate}
            onchange={(v) => setTime({ cutMinutes: v })}
            testid="pricing-cut-minutes"
          />
          <NumberField
            label="Hands-on per piece"
            unit="min"
            value={job.time.labourMinutes}
            min={0}
            decimals={1}
            step={0.5}
            onchange={(v) => setTime({ labourMinutes: v })}
            hint="Weeding, sanding, painting, assembly and packing."
            testid="pricing-labour-minutes"
          />
          <NumberField
            label="Setup per batch"
            unit="min"
            value={job.time.setupMinutes}
            min={0}
            decimals={1}
            onchange={(v) => setTime({ setupMinutes: v })}
            hint="Shared by every piece in the batch."
            testid="pricing-setup-minutes"
          />
          <NumberField
            label="Batch size"
            unit="pcs"
            value={job.time.batchSize}
            min={1}
            max={1000000}
            onchange={(v) => setTime({ batchSize: v })}
            testid="pricing-batch"
          />
        </div>
        {#if usingEstimate && estimate !== null}
          <p class="muted small">Job estimate: {duration(estimate * 60)} for everything in the design.</p>
        {:else if job.time.cutFromJob}
          <p class="muted small">
            {preview.compiling ? 'Estimating…' : 'No job estimate for this file; using the time above.'}
          </p>
        {/if}
      </div>

      <div class="group">
        <h3>Rates</h3>
        <div class="grid three">
          <NumberField
            label="Labour"
            unit="$/h"
            value={job.labourRate}
            min={0}
            decimals={2}
            stepper={false}
            onchange={(v) => setRates({ labourRate: v })}
            testid="pricing-labour-rate"
          />
          <NumberField
            label="Fees"
            unit="%"
            value={job.feePercent}
            min={0}
            max={99}
            decimals={1}
            stepper={false}
            onchange={(v) => setRates({ feePercent: v })}
            hint="Marketplace and payment fees, as a percentage of the sale price."
            testid="pricing-fees"
          />
          <NumberField
            label="Markup"
            unit="×"
            value={job.markup}
            min={0}
            max={1000}
            decimals={2}
            step={0.1}
            stepper={false}
            onchange={(v) => setRates({ markup: v })}
            testid="pricing-markup"
          />
        </div>
      </div>

      {#if result}
        <table class="breakdown" data-testid="pricing-breakdown">
          <caption class="sr-only">Cost and price per piece</caption>
          <tbody>
            <tr>
              <th scope="row"
                >Material<span
                  >{money(result.sheetShare)} sheet ({money(job.sheet.cost)} ÷ {fit.count}) + {money(
                    result.extras,
                  )}
                  extras</span
                ></th
              >
              <td class="mono">{money(result.material)}</td>
            </tr>
            <tr>
              <th scope="row">Machine<span>{minutes(cutMinutes)} at {money(machine.hourlyRate)}/h</span></th>
              <td class="mono">{money(result.machine)}</td>
            </tr>
            <tr>
              <th scope="row"
                >Labour<span
                  >{minutes(job.time.labourMinutes + job.time.setupMinutes / job.time.batchSize)} at {money(
                    job.labourRate,
                  )}/h, setup shared</span
                ></th
              >
              <td class="mono">{money(result.labour)}</td>
            </tr>
            <tr class="total">
              <th scope="row">Cost per piece</th>
              <td class="mono">{money(result.cost)}</td>
            </tr>
            <tr>
              <th scope="row">Cost × {job.markup} markup<span>what you keep after fees</span></th>
              <td class="mono">{money(result.beforeFees)}</td>
            </tr>
            <tr>
              <th scope="row">Fees<span>{job.feePercent}% of the price</span></th>
              <td class="mono">{money(result.fees)}</td>
            </tr>
            <tr class="total">
              <th scope="row">Suggested retail</th>
              <td class="mono">{money(result.price)}</td>
            </tr>
            <tr>
              <th scope="row">Profit per piece</th>
              <td class="mono" class:loss={result.profit < 0}>{money(result.profit)}</td>
            </tr>
            <tr>
              <th scope="row"
                >Profit per batch<span
                  >{job.time.batchSize} pieces · {result.sheets}
                  {result.sheets === 1 ? 'sheet' : 'sheets'}</span
                ></th
              >
              <td class="mono" class:loss={result.batchProfit < 0} data-testid="pricing-batch-profit"
                >{money(result.batchProfit)}</td
              >
            </tr>
            <tr>
              <th scope="row"
                >Effective hourly<span
                  >labour + profit over {duration(result.batchHours * 3600)} of batch time</span
                ></th
              >
              <td class="mono">{result.hourly === null ? '—' : `${money(result.hourly)}/h`}</td>
            </tr>
          </tbody>
        </table>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .pricing {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-bottom: 1px solid var(--ol-border);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hint {
    flex: 1;
    font-size: var(--ol-fs-sm);
    color: var(--ol-text-muted);
    text-align: right;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  h3 {
    margin: 0;
    font-size: var(--ol-fs-md);
    font-weight: 600;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .grid.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  select.input {
    appearance: auto;
  }

  .small {
    margin: 0;
    font-size: var(--ol-fs-sm);
  }

  .note {
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--ol-radius-sm);
    background: var(--ol-hold-tint);
    color: var(--ol-hold);
    font-size: var(--ol-fs-sm);
  }

  .summary {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--ol-border);
    border-radius: var(--ol-radius-sm);
    background: var(--ol-bg);
    min-width: 0;
  }

  .tile.main {
    grid-column: 1 / -1;
  }

  dt {
    font-size: var(--ol-fs-xs);
    color: var(--ol-text-muted);
  }

  dd {
    margin: 0;
    font-size: var(--ol-fs-md);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .main dd {
    font-size: var(--ol-fs-xl);
  }

  .loss {
    color: var(--ol-hold);
  }

  .fit {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .fit svg {
    width: 100%;
    max-height: 200px;
    padding: 8px;
    border-radius: var(--ol-radius-sm);
    background: var(--ol-bg);
    border: 1px solid var(--ol-border);
  }

  .fit .sheet {
    fill: var(--ol-surface-2);
    stroke: var(--ol-text-dim);
    stroke-width: 1;
  }

  .fit .bed {
    fill: none;
    stroke: var(--ol-beam);
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }

  .fit .piece {
    fill: var(--ol-signal-tint);
    stroke: var(--ol-signal);
    stroke-width: 1;
  }

  figcaption {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--ol-fs-sm);
    color: var(--ol-text-2);
  }

  figcaption .mono {
    font-size: var(--ol-fs-xs);
  }

  .breakdown {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--ol-fs-sm);
  }

  .breakdown th,
  .breakdown td {
    padding: 6px 0;
    border-bottom: 1px solid var(--ol-border);
    vertical-align: top;
  }

  .breakdown th {
    text-align: left;
    font-weight: 500;
    color: var(--ol-text-2);
  }

  .breakdown th span {
    display: block;
    margin-top: 1px;
    font-weight: 400;
    font-size: var(--ol-fs-xs);
    color: var(--ol-text-muted);
  }

  .breakdown td {
    padding-left: 12px;
    text-align: right;
    white-space: nowrap;
    color: var(--ol-text);
  }

  .breakdown .total th,
  .breakdown .total td {
    font-weight: 600;
    color: var(--ol-text);
  }

  .breakdown tr:last-child th,
  .breakdown tr:last-child td {
    border-bottom: 0;
  }

  .breakdown td.loss {
    color: var(--ol-hold);
  }
</style>
