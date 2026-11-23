/**
 * Color separation state for Bitmap mode: the colors picked on the image, how they match, and a
 * small decoded copy of the image to preview the selection on. Shared by the image canvas (where
 * colors are picked) and the Separate panel (where the selection is tuned and applied).
 *
 * Picks are added or subtracted: the selection is what the add picks match, minus what the subtract
 * picks match. Each mode has its own tolerance and edge softness. Changes to the picks have their
 * own undo history, used before the project's while the Separate tab is open.
 */
import { History } from 'libopenlaser/project';
import {
  colorAt,
  downscaleRaster,
  edgeSelection,
  oklabImage,
  selectionWeights,
  selectedShare,
  spectrumKey,
} from 'libopenlaser/cam';
import type {
  ColorKey,
  ColorSelection,
  KeyMaskCache,
  KeyMode,
  KeyPoint,
  RasterSource,
  Rgb,
} from 'libopenlaser/cam';
import { decodeImage } from 'libopenlaser/import';

/** Pixels in the interactive preview; the full image is only processed when a change is applied. */
export const PREVIEW_PIXELS = 1_000_000;
/** Seeds kept per drag: enough to cover a long stroke across an area. */
const SEEDS_PER_DRAG = 32;

export type SeparationShow = 'highlight' | 'selection' | 'rest';

export const DEFAULT_TOLERANCE = 15;
export const DEFAULT_SOFTNESS = 10;

/** A picked color or range, with the mode it was picked in and where it was picked. */
export interface Pick {
  stops: Rgb[];
  mode: KeyMode;
  seeds: KeyPoint[];
}

/** How picks of one mode match. */
export interface Matching {
  tolerance: number;
  softness: number;
}

/** What one undo step restores. */
interface PickState {
  picks: Pick[];
  invert: boolean;
  connected: boolean;
}

export class Separation {
  picks = $state<Pick[]>([]);
  /** The mode a plain click or drag picks in. */
  mode = $state<KeyMode>('add');
  matching = $state<Record<KeyMode, Matching>>({
    add: { tolerance: DEFAULT_TOLERANCE, softness: DEFAULT_SOFTNESS },
    subtract: { tolerance: DEFAULT_TOLERANCE, softness: DEFAULT_SOFTNESS },
  });
  connected = $state(false);
  invert = $state(false);
  regions = $state(false);
  show = $state<SeparationShow>('highlight');
  /** A full-size separation is running. */
  busy = $state(false);

  /** The asset the preview below was decoded from. */
  assetId = $state<string | null>(null);
  preview = $state.raw<RasterSource | null>(null);
  private lab: Float32Array | null = null;
  /** Per-pick masks over `preview`, so editing one pick does not re-measure the others. */
  private masks: KeyMaskCache = new Map();
  /** "Connected areas only" was switched on by Select background, not by hand. */
  private autoConnected = false;
  private loading: string | null = null;

  private history = new History<PickState>();
  /** Bumps on every history change so canUndo/canRedo stay reactive. */
  private revision = $state(0);

  get selection(): ColorSelection {
    return {
      keys: this.picks.map((p): ColorKey => ({
        stops: p.stops.map((s) => [s[0], s[1], s[2]] as Rgb),
        mode: p.mode,
        tolerance: this.matching[p.mode].tolerance,
        softness: this.matching[p.mode].softness,
        seeds: p.seeds.map((s) => ({ x: s.x, y: s.y })),
      })),
      tolerance: this.matching.add.tolerance,
      softness: this.matching.add.softness,
      connected: this.connected,
      invert: this.invert,
    };
  }

  /** Nothing would be selected: with no add picks, subtract picks have nothing to take from. */
  get empty(): boolean {
    return !this.picks.some((p) => p.mode === 'add') && !this.invert;
  }

  /** Decodes a small copy of the asset for previews; a newer request wins. */
  async load(assetId: string, blob: Blob): Promise<void> {
    if (this.assetId === assetId || this.loading === assetId) return;
    this.loading = assetId;
    const decoded = await decodeImage(blob);
    if (this.loading !== assetId) return;
    this.loading = null;
    this.setPreview(downscaleRaster(decoded, PREVIEW_PIXELS));
    this.assetId = assetId;
  }

  /** Swaps the preview image, dropping everything measured on the old one. */
  setPreview(preview: RasterSource | null): void {
    this.preview = preview;
    this.lab = null;
    this.masks = new Map();
  }

  unload(): void {
    this.loading = null;
    this.assetId = null;
    this.setPreview(null);
  }

  /** Selection strength per preview pixel, 0..255 (all zero when nothing is picked). */
  weights(): Uint8ClampedArray | null {
    const source = this.preview;
    if (!source) return null;
    const selection = this.selection;
    if (this.empty) return new Uint8ClampedArray(source.width * source.height);
    this.lab ??= oklabImage(source);
    return selectionWeights(source, selection, this.lab, this.masks);
  }

  share(weights: Uint8ClampedArray | null): number {
    return this.preview && weights ? selectedShare(this.preview, weights) : 0;
  }

  // ------------------------------------------------------------------ picks, with undo

  private snapshot(): PickState {
    return { picks: this.picks, invert: this.invert, connected: this.connected };
  }

  private restore(state: PickState): void {
    this.picks = state.picks;
    this.invert = state.invert;
    this.connected = state.connected;
    this.autoConnected = false;
  }

  /** Records the current picks as an undo step, then applies `change`. */
  private change(change: () => void): void {
    this.history.record(this.snapshot());
    change();
    this.revision++;
  }

  get canUndo(): boolean {
    void this.revision;
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    void this.revision;
    return this.history.canRedo;
  }

  undo(): boolean {
    const previous = this.history.undo(this.snapshot());
    if (!previous) return false;
    this.restore(previous);
    this.revision++;
    return true;
  }

  redo(): boolean {
    const next = this.history.redo(this.snapshot());
    if (!next) return false;
    this.restore(next);
    this.revision++;
    return true;
  }

  /**
   * Adds a pick from a click (one point) or a drag (the points along it), in `mode` (the switch's
   * mode unless a modifier overrode it). A drag keys the whole spectrum of colors it crossed.
   */
  pick(points: KeyPoint[], mode: KeyMode = this.mode): boolean {
    const source = this.preview;
    if (!source || points.length === 0) return false;
    const colors = points.map((p) => colorAt(source, p)).filter((c): c is Rgb => c !== null);
    const key = colors.length === 1 ? { stops: colors } : spectrumKey(colors);
    if (!key) return false;
    const step = Math.max(1, Math.ceil(points.length / SEEDS_PER_DRAG));
    const seeds = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    this.change(() => (this.picks = [...this.picks, { stops: key.stops, mode, seeds }]));
    return true;
  }

  removePick(index: number): void {
    this.change(() => (this.picks = this.picks.filter((_, i) => i !== index)));
  }

  /** Switches one pick between add and subtract. */
  togglePick(index: number): void {
    this.change(
      () =>
        (this.picks = this.picks.map((p, i) =>
          i === index ? { ...p, mode: p.mode === 'add' ? 'subtract' : 'add' } : p,
        )),
    );
  }

  /** Adds the main colors around the image's edge, limited to the areas touching it. */
  selectBackground(): boolean {
    if (!this.preview) return false;
    const keys = edgeSelection(this.preview);
    if (keys.length === 0) return false;
    const subtracts = this.picks.filter((p) => p.mode === 'subtract');
    this.change(() => {
      // The background replaces the add picks; subtract picks still carve out of it.
      this.picks = [
        ...keys.map((k): Pick => ({ stops: k.stops, mode: 'add', seeds: k.seeds ?? [] })),
        ...subtracts,
      ];
      if (!this.connected) this.autoConnected = true;
      this.connected = true;
      this.invert = false;
    });
    return true;
  }

  /** Removes every pick, add and subtract, as one undoable step. */
  clear(): void {
    if (this.picks.length === 0 && !this.invert) return;
    const auto = this.autoConnected;
    this.change(() => {
      this.picks = [];
      this.invert = false;
      if (auto) this.connected = false;
    });
    this.autoConnected = false;
  }

  /** Forgets the picks and their history: they were applied, or belong to another image. */
  reset(): void {
    this.picks = [];
    this.invert = false;
    if (this.autoConnected) this.connected = false;
    this.autoConnected = false;
    this.history.clear();
    this.revision++;
  }

  setConnected(on: boolean): void {
    this.change(() => (this.connected = on));
    this.autoConnected = false;
  }

  setInvert(on: boolean): void {
    this.change(() => (this.invert = on));
  }

  /** Tunes how picks of one mode match. Not an undo step: it is a setting, like the views. */
  setMatching(mode: KeyMode, change: Partial<Matching>): void {
    this.matching = { ...this.matching, [mode]: { ...this.matching[mode], ...change } };
  }
}

/** The separation whose picks undo/redo act on: set while the Separate tab is open. */
export const separationFocus = $state<{ current: Separation | null }>({ current: null });

/** Undoes a pick change in the open Separate tab; false when there is none (undo the project). */
export function undoPicks(): boolean {
  return separationFocus.current?.undo() ?? false;
}

export function redoPicks(): boolean {
  return separationFocus.current?.redo() ?? false;
}

export function canUndoPicks(): boolean {
  return separationFocus.current?.canUndo ?? false;
}

export function canRedoPicks(): boolean {
  return separationFocus.current?.canRedo ?? false;
}

/** CSS color for a pick's swatch: a flat color, or a gradient through a spectrum's stops. */
export function keySwatch(key: { stops: Rgb[] }): string {
  const css = (c: Rgb) => `rgb(${c[0]} ${c[1]} ${c[2]})`;
  return key.stops.length === 1
    ? css(key.stops[0])
    : `linear-gradient(90deg, ${key.stops.map(css).join(', ')})`;
}
