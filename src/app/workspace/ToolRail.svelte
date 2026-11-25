<script lang="ts">
  import { Popover } from 'bits-ui';
  import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
  import Spline from '@lucide/svelte/icons/spline';
  import PenTool from '@lucide/svelte/icons/pen-tool';
  import Combine from '@lucide/svelte/icons/combine';
  import { uniteSelection, booleanSelectionIssue } from '../unite';
  import { ui } from '../state/ui.svelte';
  import { simplifyPath, flattenPaths, polylinesBounds } from 'libopenlaser/geometry';
  import type { VectorObject } from 'libopenlaser/project';

  let tolerance = $state(0.1);
  const vectors = $derived(
    editor.project?.objects.filter(
      (o): o is VectorObject => editor.selection.has(o.id) && o.kind === 'vector' && o.visible && !o.locked,
    ) ?? [],
  );

  const simplified = $derived(
    vectors.map((o) => ({ ...o, paths: o.paths.map((p) => simplifyPath(p, tolerance, o.transform)) })),
  );
  const before = $derived(
    vectors.reduce((n, o) => n + o.paths.reduce((m, p) => m + p.segments.length + 1, 0), 0),
  );
  const after = $derived(
    simplified.reduce((n, o) => n + o.paths.reduce((m, p) => m + p.segments.length + 1, 0), 0),
  );
  const previewOriginal = $derived(vectors.flatMap((o) => flattenPaths(o.paths, o.transform)));
  const previewResult = $derived(simplified.flatMap((o) => flattenPaths(o.paths, o.transform)));
  const previewBounds = $derived(polylinesBounds(previewOriginal));
  const previewBox = $derived.by(() => {
    const b = previewBounds;
    if (!b) return '0 0 1 1';
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1) * 0.05;
    return `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  });
  function applySimplification() {
    if (after >= before || !Number.isFinite(tolerance) || tolerance <= 0) return;
    const replacements = new Map(
      simplified
        .filter((o, i) => o.paths.some((p, j) => p !== vectors[i].paths[j]))
        .map((o) => [o.id, { ...o, shape: undefined }]),
    );
    editor.commit((p) => ({ ...p, objects: p.objects.map((o) => replacements.get(o.id) ?? o) }));
    ui.simplifyOpen = false;
  }
  import Hand from '@lucide/svelte/icons/hand';
  import Square from '@lucide/svelte/icons/square';
  import Circle from '@lucide/svelte/icons/circle';
  import Type from '@lucide/svelte/icons/type';
  import Ruler from '@lucide/svelte/icons/ruler';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import ScanQrCode from '@lucide/svelte/icons/scan-qr-code';
  import { openPhoneCapture } from '../phone/phone-capture.svelte';
  import * as actions from '../actions';
  import type { Component } from 'svelte';
  import { isShapeKind, shapeDef } from 'libopenlaser/shapes';
  import { formatCombo } from '../lib/keys';
  import { DRAWING_KEYS } from '../shortcuts';
  import { editor, type Tool } from '../state/editor.svelte';
  import ShapeGlyph from '../inspector/ShapeGlyph.svelte';
  import ShapePicker from '../inspector/ShapePicker.svelte';
  import OutlineTool from './OutlineTool.svelte';
  import { activeAdapter } from '../machines/registry';

  /** An open G-code file exports as G-code, whatever the machine. */
  const exportLabel = $derived(editor.gcode ? 'Export G-code' : activeAdapter().exportLabel);

  type Entry =
    | { id: Tool; label: string; key: string; icon: Component; design: boolean }
    | 'divider'
    | 'shapes'
    | 'image'
    | 'phone'
    | 'drawing'
    | 'outline';

  const tools: Entry[] = [
    { id: 'select', label: 'Select', key: 'V', icon: MousePointer2, design: true },
    { id: 'node', label: 'Nodes', key: 'N', icon: Spline, design: true },
    { id: 'pen', label: 'Draw path', key: 'B', icon: PenTool, design: true },
    { id: 'pan', label: 'Pan', key: 'H', icon: Hand, design: false },
    'divider',
    { id: 'rect', label: 'Rectangle', key: 'R', icon: Square, design: true },
    { id: 'ellipse', label: 'Ellipse', key: 'E', icon: Circle, design: true },
    'shapes',
    { id: 'text', label: 'Text', key: 'T', icon: Type, design: true },
    'image',
    'phone',
    'drawing',
    'divider',
    'outline',
    { id: 'measure', label: 'Measure', key: 'M', icon: Ruler, design: false },
  ];

  const designing = $derived(editor.view === 'design' && editor.project !== null);
  const shapeKind = $derived(isShapeKind(editor.shapeKind) ? editor.shapeKind : 'star');
  let pickerOpen = $state(false);
</script>

<nav class="rail" aria-label="Tools">
  {#each tools as tool, i (i)}
    {#if tool === 'divider'}
      <div class="rule"></div>
    {:else if tool === 'image'}
      <button
        type="button"
        class="icon-btn tool"
        aria-label="Image: SVG, DXF, PNG, JPEG, WebP, AVIF, BMP, GIF ({formatCombo('Mod+I')})"
        disabled={!designing}
        onclick={() => actions.importArt()}
        data-testid="tool-image"><ImagePlus size={18} /></button
      >
    {:else if tool === 'phone'}
      <button
        type="button"
        class="icon-btn tool"
        aria-label="Scan art with phone"
        title="Scan art with phone: show a QR code, then photograph your art"
        onclick={() => void openPhoneCapture()}
        data-testid="phone-scan"><ScanQrCode size={18} /></button
      >
    {:else if tool === 'drawing'}
      <button
        type="button"
        class="icon-btn tool"
        aria-label="Import a drawing in ink only mode: a photo of pen or marker lines, cleaned to just the ink ({formatCombo(
          DRAWING_KEYS,
        )})"
        disabled={!designing}
        onclick={() => actions.importDrawing()}
        data-testid="tool-import-drawing"><PenLine size={18} /></button
      >
    {:else if tool === 'outline'}
      <OutlineTool disabled={!designing} />
    {:else if tool === 'shapes'}
      <Popover.Root bind:open={pickerOpen}>
        <Popover.Trigger
          class="icon-btn tool"
          aria-label="Shapes: {shapeDef(shapeKind).label} ({formatCombo('S')})"
          aria-pressed={editor.tool === 'shape'}
          disabled={!designing}
          onclick={() => (editor.tool = 'shape')}
          data-testid="tool-shape"
        >
          <ShapeGlyph kind={shapeKind} size={20} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="ol-menu" side="bottom" align="start" sideOffset={8}>
            <ShapePicker
              value={shapeKind}
              onpick={(kind) => {
                editor.shapeKind = kind;
                editor.tool = 'shape';
                pickerOpen = false;
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    {:else}
      <button
        type="button"
        class="icon-btn tool"
        aria-label="{tool.label} ({formatCombo(tool.key)})"
        aria-pressed={editor.tool === tool.id}
        disabled={tool.design && !designing}
        onclick={() => (editor.tool = tool.id)}
        data-testid="tool-{tool.id}"
      >
        <tool.icon size={18} />
      </button>
    {/if}
  {/each}
  <button
    type="button"
    class="icon-btn tool"
    aria-label="Unite closed shapes"
    data-testid="tool-unite"
    disabled={!designing || booleanSelectionIssue() !== null}
    title={booleanSelectionIssue() ?? 'Union closed shapes (Ctrl+Shift+U)'}
    onclick={uniteSelection}><Combine size={18} /></button
  >
    <Popover.Root bind:open={ui.simplifyOpen}>
      <Popover.Trigger
        class="icon-btn tool"
        aria-label="Simplify path"
        disabled={!designing || !vectors.length}
        data-testid="tool-simplify"
      >
        <Spline size={18} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="ol-menu simplify-menu" side="bottom" align="start" sideOffset={8}>
          <strong>Simplify path</strong>
          <label for="simplify-tolerance">Tolerance (mm): {tolerance.toFixed(2)}</label>
          <input id="simplify-tolerance" type="range" min="0.01" max="1" step="0.01" bind:value={tolerance} />
          <span data-testid="simplify-count">Nodes: {before} → {after}</span>
          <svg
            viewBox={previewBox}
            width="232"
            height="150"
            role="img"
            aria-label="Path simplification preview"
          >
            {#each previewOriginal as line, i (i)}
              <polyline
                points={[...line.points, ...(line.closed ? line.points.slice(0, 1) : [])]
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
                fill="none"
                stroke="currentColor"
                opacity="0.3"
                stroke-width="3"
                vector-effect="non-scaling-stroke"
              />
            {/each}
            {#each previewResult as line, i (i)}
              <polyline
                points={[...line.points, ...(line.closed ? line.points.slice(0, 1) : [])]
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
                fill="none"
                stroke="currentColor"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
            {/each}
          </svg>
          <span>Original in gray; simplified in foreground. Preview only until Apply.</span>
          <span
            >Open and closed paths. Sharp polyline corners are kept; compatible Bézier segments merge within
            the tolerance.</span
          >
          <button type="button" class="btn" onclick={() => (ui.simplifyOpen = false)}>Cancel</button>
          <button type="button" class="btn start" disabled={after >= before} onclick={applySimplification}
            >Apply simplification</button
          >
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  <div class="rule"></div>
  <button
    type="button"
    class="icon-btn tool"
    aria-label="{exportLabel} ({formatCombo('Mod+E')})"
    title="{exportLabel} ({formatCombo('Mod+E')})"
    disabled={!editor.project && !editor.gcode}
    onclick={() => actions.exportJob()}
    data-testid="export-gcode"
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M15 13a3 3 0 1 0 0 4v-2h-2" />
    </svg>
  </button>
</nav>

<style>
  :global(.simplify-menu) {
    width: 260px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rail {
    height: var(--ol-toolbar-h);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px;
    overflow-x: auto;
    border-bottom: 1px solid var(--ol-border);
    background: var(--ol-surface);
  }

  .rail :global(.tool) {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
  }

  .rule {
    width: 1px;
    height: 24px;
    flex-shrink: 0;
    background: var(--ol-border);
    margin: 0 6px;
  }
</style>
