/**
 * Trace for Bitmap mode's side panel: the settings, the live trace of the image being edited, and
 * applying it. Settings last for the session, as they did in the old Trace dialog, so the next image
 * traces the way the last one did.
 *
 * When colors are picked in Separate colors, only the picked area is traced: pixels outside the
 * selection are made transparent before tracing, and the tracer leaves transparent pixels out.
 */
import type { ColorSelection, RasterSource } from 'libopenlaser/cam';
import { selectionWeights } from 'libopenlaser/cam';
import { decodeImage } from 'libopenlaser/import';
import { makeId } from 'libopenlaser/project';
import type { ImageObject } from 'libopenlaser/project';
import { stopTrace, trace, traceLayersToPaths, tracePreset } from 'libopenlaser/trace';
import type { TraceOptions, TracePresetId, TraceResult } from 'libopenlaser/trace';
import { toast } from '$lib/ui/toasts.svelte';
import { errorMessage, reportError } from '$lib/ui/errors';
import { editor } from '../state/editor.svelte';
import { burnableLayers, placeTrace } from '../lib/trace-place';

/** Longest side traced, in pixels: plenty for laser detail and keeps the live preview quick. */
export const MAX_TRACE_PX = 1600;

export type TraceView = 'result' | 'outline' | 'original';

/** What is traced: the whole image, or only the picked area. */
export interface TraceArea {
  selection: ColorSelection;
  /** Nothing picked: trace the whole image. */
  empty: boolean;
}

function downscale(source: RasterSource, max: number): RasterSource {
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  if (scale >= 1) return source;
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const from = new OffscreenCanvas(source.width, source.height);
  from
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(source.data), source.width, source.height), 0, 0);
  const to = new OffscreenCanvas(w, h);
  const ctx = to.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(from, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: data.data };
}

/** The image with everything outside the picked area made transparent. */
export function maskToArea(pixels: RasterSource, area: TraceArea): RasterSource {
  if (area.empty) return pixels;
  const weights = selectionWeights(pixels, area.selection);
  const data = new Uint8ClampedArray(pixels.data);
  for (let i = 0; i < weights.length; i++) data[i * 4 + 3] = (data[i * 4 + 3] * weights[i]) / 255;
  return { width: pixels.width, height: pixels.height, data };
}

class TraceState {
  // ------------------------------------------------------------------ settings (as the old dialog)
  preset = $state<TracePresetId | null>('lineart');
  options = $state<TraceOptions>({ ...tracePreset('lineart').options });
  autoThreshold = $state(true);
  layerMode = $state<'fill' | 'line'>('fill');
  powerByShade = $state(true);
  keepImage = $state(false);
  /** Advanced trace fields are tucked away until opened. */
  advancedOpen = $state(false);
  view = $state<TraceView>('result');

  // ------------------------------------------------------------------ the image and its live trace
  /** Decoded copy of the image being traced, at most MAX_TRACE_PX on its longest side. */
  pixels = $state.raw<RasterSource | null>(null);
  private assetId: string | null = null;
  result = $state.raw<TraceResult | null>(null);
  /** The inputs `result` was traced from; a different key means it is stale. */
  private resultKey: string | null = null;
  progress = $state<number | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private runs = 0;

  usePreset(id: TracePresetId) {
    this.preset = id;
    const next = tracePreset(id).options;
    this.options = { ...next };
    this.autoThreshold = next.threshold < 0;
    if (next.mode === 'bw') this.powerByShade = false;
  }

  set<K extends keyof TraceOptions>(key: K, value: TraceOptions[K]) {
    this.options = { ...this.options, [key]: value };
    this.preset = null;
  }

  /** The options the tracer gets: Auto threshold traces with -1. */
  effective(): TraceOptions {
    return { ...$state.snapshot(this.options), threshold: this.autoThreshold ? -1 : this.options.threshold };
  }

  /** Decodes the image once per asset. */
  async load(assetId: string, blob: Blob): Promise<void> {
    if (this.assetId === assetId) return;
    this.assetId = assetId;
    this.pixels = null;
    this.result = null;
    this.resultKey = null;
    try {
      const source = await decodeImage(blob);
      if (this.assetId === assetId) this.pixels = downscale(source, MAX_TRACE_PX);
    } catch (error) {
      if (this.assetId === assetId) toast.error(`Could not read the image: ${errorMessage(error)}`);
    }
  }

  unload(): void {
    this.cancel();
    this.assetId = null;
    this.pixels = null;
    this.result = null;
    this.resultKey = null;
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.progress !== null) stopTrace();
    this.progress = null;
  }

  private key(area: TraceArea, options: TraceOptions): string {
    return JSON.stringify([this.assetId, options, area.empty ? null : area.selection]);
  }

  /** The current result if it was traced from these inputs. */
  fresh(area: TraceArea): TraceResult | null {
    return this.result && this.resultKey === this.key(area, this.effective()) ? this.result : null;
  }

  /** Re-traces a moment after the last change, for the live preview. */
  schedule(area: TraceArea): void {
    const px = this.pixels;
    const options = this.effective();
    if (!px) return;
    if (this.timer) clearTimeout(this.timer);
    if (this.result && this.resultKey === this.key(area, options)) return;
    this.timer = setTimeout(() => void this.run(px, area, options), 180);
  }

  /** Traces now; resolves to null when cancelled or superseded by a newer run. */
  async run(px: RasterSource, area: TraceArea, options: TraceOptions): Promise<TraceResult | null> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const mine = ++this.runs;
    const key = this.key(area, options);
    this.progress = 0;
    try {
      const result = await trace(maskToArea(px, area), options, {
        onProgress: (p) => {
          if (mine === this.runs) this.progress = p;
        },
      });
      if (mine !== this.runs) return null;
      this.result = result;
      this.resultKey = key;
      this.progress = null;
      return result;
    } catch (error) {
      if (mine === this.runs) this.progress = null;
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      reportError(error, 'Trace');
      toast.error(`Trace failed: ${errorMessage(error)}`);
      return null;
    }
  }

  /** Places the trace of `image` as vector layers, then shows them in Design. */
  async apply(image: ImageObject, area: TraceArea): Promise<boolean> {
    const px = this.pixels;
    if (!px) return false;
    const result = this.fresh(area) ?? (await this.run(px, area, this.effective()));
    if (!result) return false;
    const traced = burnableLayers(traceLayersToPaths(result, image.width, image.height));
    if (traced.length === 0) {
      toast.warning('The trace is empty. Try a lower threshold or fewer specks removed.');
      return false;
    }
    let ids: string[] = [];
    const options = { mode: this.layerMode, powerByShade: this.powerByShade, keepImage: this.keepImage };
    editor.commit((p) => {
      const placed = placeTrace(p, image, traced, options, makeId);
      ids = placed.objectIds;
      return placed.project;
    });
    // The trace is vector paths now: show them on the bed, selected.
    editor.view = 'design';
    editor.select(ids);
    toast.success(`Traced ${traced.length} ${traced.length === 1 ? 'shape' : 'colors'}`);
    return true;
  }
}

export const tracing = new TraceState();
