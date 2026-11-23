/**
 * Color keying for raster images: pick colors (or whole spectrums of them), measure how closely
 * every pixel matches, then split the image into the matching part and the rest. Both parts keep
 * the original pixels; only their alpha changes, so stacked back together they rebuild the image.
 *
 * Colors are compared in OKLab, where distance follows perceived difference: a tolerance that
 * catches a shadowed green screen does not also catch a leaf of a different green.
 */
import { toOklab } from '../../trace/oklab';
import type { RasterSource } from '../types';

export type Rgb = readonly [number, number, number];

/**
 * One picked color, or a spectrum: the colors sampled along a drag, matched as a continuous range
 * (anything near the line through them in OKLab, so a sky that fades from pale to deep blue keys
 * as one).
 */
export interface ColorKey {
  stops: Rgb[];
  /** `subtract` keys take their match away from what the `add` keys select. Default `add`. */
  mode?: KeyMode;
  /** 0..100, overriding the selection's tolerance for this key. */
  tolerance?: number;
  /** 0..100, overriding the selection's softness for this key. */
  softness?: number;
  /** Where the key was picked, for `connected` selections. */
  seeds?: KeyPoint[];
}

export type KeyMode = 'add' | 'subtract';

/** A point on the image, as a share of its width and height (0..1, row 0 at the top). */
export interface KeyPoint {
  x: number;
  y: number;
}

export interface ColorSelection {
  keys: ColorKey[];
  /** 0..100: how far a color may be from a key and still match fully (keys may override it). */
  tolerance: number;
  /** 0..100: width of the partly matching band past the tolerance, for soft edges. */
  softness: number;
  /**
   * Only matching areas connected to a key's seeds count, separately for add and subtract keys. A
   * color elsewhere in the image (the same blue in a shirt as in the sky) is left alone.
   */
  connected?: boolean;
  /** Select everything except the match. Applied last, after subtracting. */
  invert?: boolean;
}

/**
 * Per-key masks from earlier runs over the same image, keyed by the key's colors, tolerance and
 * softness. Pass the same map while a selection is edited so only new or changed keys are measured;
 * start a new one when the image changes.
 */
export type KeyMaskCache = Map<string, Uint8ClampedArray>;

/** A cropped part of an image: `data` covers `width × height` pixels at (x, y) in the source. */
export interface RasterCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Lightness counts half as much as hue and chroma, as in chroma keyers: a shadow falling across a
 * backdrop changes its lightness far more than its color.
 */
const LIGHTNESS_WEIGHT = 0.5;
/** Weighted OKLab distance at tolerance 100 (black to white is 0.5). */
const TOLERANCE_SCALE = 0.5;
/** OKLab width of the soft band at softness 100. */
const SOFTNESS_SCALE = 0.25;

/** Weighted OKLab of every pixel, three floats each. Worth keeping when a selection is re-run while edited. */
export function oklabImage(source: RasterSource): Float32Array {
  const count = source.width * source.height;
  const lab = new Float32Array(count * 3);
  const data = source.data;
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    toOklab(data[p], data[p + 1], data[p + 2], lab, i * 3);
    lab[i * 3] *= LIGHTNESS_WEIGHT;
  }
  return lab;
}

/** Key stops in OKLab, with near-duplicates dropped so a slow drag does not make a long key. */
function keyLab(key: ColorKey): Float32Array {
  const out: number[] = [];
  const lab = new Float32Array(3);
  for (const [r, g, b] of key.stops) {
    toOklab(clampByte(r), clampByte(g), clampByte(b), lab);
    lab[0] *= LIGHTNESS_WEIGHT;
    const n = out.length;
    if (n >= 3 && Math.hypot(lab[0] - out[n - 3], lab[1] - out[n - 2], lab[2] - out[n - 1]) < 1e-4) continue;
    out.push(lab[0], lab[1], lab[2]);
  }
  return Float32Array.from(out);
}

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Squared distance from (l, a, b) to the polyline through `stops` (a single point when one stop). */
function distanceSq(l: number, a: number, b: number, stops: Float32Array): number {
  let best = Infinity;
  const n = stops.length / 3;
  if (n === 1) {
    const dl = l - stops[0],
      da = a - stops[1],
      db = b - stops[2];
    return dl * dl + da * da + db * db;
  }
  for (let s = 0; s < n - 1; s++) {
    const o = s * 3;
    const l0 = stops[o],
      a0 = stops[o + 1],
      b0 = stops[o + 2];
    const vl = stops[o + 3] - l0,
      va = stops[o + 4] - a0,
      vb = stops[o + 5] - b0;
    const wl = l - l0,
      wa = a - a0,
      wb = b - b0;
    const len = vl * vl + va * va + vb * vb;
    let t = len > 0 ? (wl * vl + wa * va + wb * vb) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dl = wl - t * vl,
      da = wa - t * va,
      db = wb - t * vb;
    const d = dl * dl + da * da + db * db;
    if (d < best) best = d;
  }
  return best;
}

const clampPercent = (v: number) => Math.max(0, Math.min(100, v));

/**
 * How strongly one key matches each pixel, 0..255: full within its tolerance, fading to nothing
 * across the softness band past it. Fully transparent pixels never match.
 */
export function keyWeights(
  source: RasterSource,
  key: ColorKey,
  tolerancePercent: number,
  softnessPercent: number,
  lab: Float32Array = oklabImage(source),
): Uint8ClampedArray {
  const count = source.width * source.height;
  const weights = new Uint8ClampedArray(count);
  const stops = keyLab(key);
  if (stops.length === 0) return weights;
  const data = source.data;
  const tolerance = (clampPercent(tolerancePercent) / 100) * TOLERANCE_SCALE;
  const band = (clampPercent(softnessPercent) / 100) * SOFTNESS_SCALE;
  const outer = tolerance + band;
  const toleranceSq = tolerance * tolerance;
  const outerSq = outer * outer;
  for (let i = 0; i < count; i++) {
    if (data[i * 4 + 3] === 0) continue;
    const d = distanceSq(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], stops);
    if (d <= toleranceSq) weights[i] = 255;
    else if (d < outerSq && band > 0) weights[i] = Math.round((255 * (outer - Math.sqrt(d))) / band);
  }
  return weights;
}

/** One key's soft mask, ready to combine. */
export interface KeyMask {
  mode: KeyMode;
  weights: Uint8ClampedArray;
  seeds?: KeyPoint[];
}

/**
 * Combines key masks: `union(add) − union(subtract)`, each union the strongest match per pixel.
 * With `connected`, each union first keeps only the areas joined to its own keys' seeds. Partial
 * subtraction scales the add weight down (a half-matching subtract pixel halves it). `invert` comes
 * last; with no add keys nothing is selected before it.
 */
export function combineWeights(
  source: RasterSource,
  masks: KeyMask[],
  options: { connected?: boolean; invert?: boolean } = {},
): Uint8ClampedArray {
  const { width, height, data } = source;
  const count = width * height;
  const union = (mode: KeyMode): Uint8ClampedArray | null => {
    const parts = masks.filter((m) => m.mode === mode);
    if (parts.length === 0) return null;
    const out = new Uint8ClampedArray(count);
    for (const part of parts) {
      const w = part.weights;
      for (let i = 0; i < count; i++) if (w[i] > out[i]) out[i] = w[i];
    }
    if (options.connected)
      keepConnected(
        out,
        width,
        height,
        parts.flatMap((p) => p.seeds ?? []),
      );
    return out;
  };
  const weights = union('add') ?? new Uint8ClampedArray(count);
  const subtract = union('subtract');
  if (subtract) {
    for (let i = 0; i < count; i++) {
      if (weights[i] !== 0 && subtract[i] !== 0)
        weights[i] = Math.round((weights[i] * (255 - subtract[i])) / 255);
    }
  }
  if (options.invert) {
    for (let i = 0; i < count; i++) weights[i] = data[i * 4 + 3] === 0 ? 0 : 255 - weights[i];
  }
  return weights;
}

/**
 * How strongly each pixel is selected, 0..255 (see `combineWeights`). Fully transparent pixels are
 * never selected: there is nothing left there to move. `lab` may pass a cached `oklabImage(source)`
 * and `cache` the masks of keys measured before.
 */
export function selectionWeights(
  source: RasterSource,
  selection: ColorSelection,
  lab?: Float32Array,
  cache?: KeyMaskCache,
): Uint8ClampedArray {
  let labImage = lab;
  const used = new Set<string>();
  const masks: KeyMask[] = selection.keys.map((key) => {
    const tolerance = key.tolerance ?? selection.tolerance;
    const softness = key.softness ?? selection.softness;
    const id = `${tolerance}|${softness}|${key.stops.map((c) => c.join(',')).join(';')}`;
    used.add(id);
    let weights = cache?.get(id);
    if (!weights) {
      labImage ??= oklabImage(source);
      weights = keyWeights(source, key, tolerance, softness, labImage);
      cache?.set(id, weights);
    }
    return { mode: key.mode ?? 'add', weights, seeds: key.seeds };
  });
  // Masks of keys that were removed or retuned are not needed again.
  if (cache) for (const id of [...cache.keys()]) if (!used.has(id)) cache.delete(id);
  return combineWeights(source, masks, { connected: selection.connected, invert: selection.invert });
}

/** Clears every selected pixel not 4-connected to a seed. A seed on an unselected pixel adds nothing. */
function keepConnected(weights: Uint8ClampedArray, width: number, height: number, seeds: KeyPoint[]): void {
  const count = width * height;
  const reached = new Uint8Array(count);
  const stack = new Int32Array(count);
  let top = 0;
  for (const seed of seeds) {
    const x = Math.min(width - 1, Math.max(0, Math.floor(seed.x * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(seed.y * height)));
    const i = y * width + x;
    if (weights[i] > 0 && !reached[i]) {
      reached[i] = 1;
      stack[top++] = i;
    }
  }
  const visit = (j: number) => {
    if (weights[j] > 0 && !reached[j]) {
      reached[j] = 1;
      stack[top++] = j;
    }
  };
  while (top > 0) {
    const i = stack[--top];
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < count - width) visit(i + width);
  }
  for (let i = 0; i < count; i++) if (!reached[i]) weights[i] = 0;
}

/** Share of the image's visible pixels that are selected, 0..1 (partly selected pixels count in part). */
export function selectedShare(source: RasterSource, weights: Uint8ClampedArray): number {
  let total = 0;
  let selected = 0;
  for (let i = 0; i < weights.length; i++) {
    const a = source.data[i * 4 + 3];
    total += a;
    selected += (a * weights[i]) / 255;
  }
  return total > 0 ? selected / total : 0;
}

export interface SeparateOptions {
  /**
   * Give each separate area of the selection its own crop (two people in front of the same
   * backdrop become two objects). Areas smaller than `minRegionShare` of the selection join the
   * largest one, so specks do not turn into objects.
   */
  regions?: boolean;
  /** Default 0.002 (0.2 %). */
  minRegionShare?: number;
  /** At most this many crops when splitting into regions; the rest join the largest. Default 64. */
  maxRegions?: number;
}

/**
 * Splits an image by selection weights. Each pixel's alpha is shared between the selected part and
 * the rest in proportion to its weight, and each part is cropped to the pixels it keeps. Either
 * side is null/empty when nothing is left on it.
 */
export function separateRaster(
  source: RasterSource,
  weights: Uint8ClampedArray,
  options: SeparateOptions = {},
): { pieces: RasterCrop[]; rest: RasterCrop | null } {
  const { width, height, data } = source;
  const count = width * height;
  const picked = new Uint8ClampedArray(count);
  const left = new Uint8ClampedArray(count);
  for (let i = 0; i < count; i++) {
    const a = data[i * 4 + 3];
    const p = Math.round((a * weights[i]) / 255);
    picked[i] = p;
    left[i] = a - p;
  }
  const rest = crop(source, left);
  if (!options.regions) {
    const piece = crop(source, picked);
    return { pieces: piece ? [piece] : [], rest };
  }
  const { labels, areas } = labelRegions(picked, width, height);
  const total = areas.reduce((n, a) => n + a, 0);
  if (total === 0) return { pieces: [], rest };
  const minArea = Math.max(1, total * (options.minRegionShare ?? 0.002));
  const order = areas.map((area, label) => ({ area, label })).sort((a, b) => b.area - a.area);
  const maxRegions = Math.max(1, options.maxRegions ?? 64);
  // Each region's crop index; small regions and overflow join the largest.
  const target = new Int32Array(areas.length);
  order.forEach(({ area, label }, rank) => (target[label] = rank < maxRegions && area >= minArea ? rank : 0));
  const kept = Math.max(1, Math.min(maxRegions, order.filter((r) => r.area >= minArea).length));
  return { pieces: cropRanks(source, picked, labels, target, kept), rest };
}

/** One crop per rank in two passes (bounds, then pixels), however many ranks there are. */
function cropRanks(
  source: RasterSource,
  alpha: Uint8ClampedArray,
  labels: Int32Array | null,
  target: Int32Array | null,
  ranks: number,
): RasterCrop[] {
  // Without labels every kept pixel goes to the one crop.
  const rankOf = (i: number) => (labels && target ? target[labels[i] - 1] : 0);
  const { width, height, data } = source;
  const box = Array.from({ length: ranks }, () => ({ minX: width, minY: height, maxX: -1, maxY: -1 }));
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      if (alpha[i] === 0) continue;
      const b = box[rankOf(i)];
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  const crops = box.map((b) =>
    b.maxX < 0
      ? null
      : {
          x: b.minX,
          y: b.minY,
          width: b.maxX - b.minX + 1,
          height: b.maxY - b.minY + 1,
          data: new Uint8ClampedArray((b.maxX - b.minX + 1) * (b.maxY - b.minY + 1) * 4),
        },
  );
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      if (alpha[i] === 0) continue;
      const c = crops[rankOf(i)]!;
      const o = ((y - c.y) * c.width + x - c.x) * 4;
      c.data[o] = data[i * 4];
      c.data[o + 1] = data[i * 4 + 1];
      c.data[o + 2] = data[i * 4 + 2];
      c.data[o + 3] = alpha[i];
    }
  }
  return crops.filter((c): c is RasterCrop => c !== null);
}

/** 8-connected regions of nonzero alpha. Labels are 1-based (0 = empty); `areas[label - 1]`. */
function labelRegions(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): { labels: Int32Array; areas: number[] } {
  const count = width * height;
  const labels = new Int32Array(count);
  const stack = new Int32Array(count);
  const areas: number[] = [];
  for (let start = 0; start < count; start++) {
    if (alpha[start] === 0 || labels[start] !== 0) continue;
    const label = areas.length + 1;
    let area = 0;
    let top = 0;
    labels[start] = label;
    stack[top++] = start;
    while (top > 0) {
      const i = stack[--top];
      area++;
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
          const j = ny * width + nx;
          if (alpha[j] !== 0 && labels[j] === 0) {
            labels[j] = label;
            stack[top++] = j;
          }
        }
      }
    }
    areas.push(area);
  }
  return { labels, areas };
}

/** Crops the source to the pixels with nonzero `alpha`, giving them that alpha; null when there are none. */
function crop(source: RasterSource, alpha: Uint8ClampedArray): RasterCrop | null {
  return cropRanks(source, alpha, null, null, 1)[0] ?? null;
}

/** A smaller copy for interactive previews (nearest pixel, so picked colors are real image colors). */
export function downscaleRaster(source: RasterSource, maxPixels: number): RasterSource {
  const { width, height } = source;
  if (width * height <= maxPixels) return source;
  const shrink = Math.sqrt(maxPixels / (width * height));
  const w = Math.max(1, Math.floor(width * shrink));
  const h = Math.max(1, Math.floor(height * shrink));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / w));
      const s = (sy * width + sx) * 4;
      const o = (y * w + x) * 4;
      data[o] = source.data[s];
      data[o + 1] = source.data[s + 1];
      data[o + 2] = source.data[s + 2];
      data[o + 3] = source.data[s + 3];
    }
  }
  return { width: w, height: h, data };
}

/** The color at an image point, or null over a fully transparent pixel. */
export function colorAt(source: RasterSource, point: KeyPoint): Rgb | null {
  const x = Math.min(source.width - 1, Math.max(0, Math.floor(point.x * source.width)));
  const y = Math.min(source.height - 1, Math.max(0, Math.floor(point.y * source.height)));
  const p = (y * source.width + x) * 4;
  if (source.data[p + 3] === 0) return null;
  return [source.data[p], source.data[p + 1], source.data[p + 2]];
}

/**
 * A key from colors sampled along a drag: neighbouring samples closer than `minStep` in OKLab merge,
 * then the path is thinned to at most `maxStops` evenly spread stops.
 */
export function spectrumKey(colors: Rgb[], maxStops = 16, minStep = 0.02): ColorKey | null {
  const lab = new Float32Array(3);
  const kept: Array<{ rgb: Rgb; l: number; a: number; b: number }> = [];
  for (const rgb of colors) {
    toOklab(clampByte(rgb[0]), clampByte(rgb[1]), clampByte(rgb[2]), lab);
    const last = kept[kept.length - 1];
    if (last && Math.hypot(lab[0] - last.l, lab[1] - last.a, lab[2] - last.b) < minStep) continue;
    kept.push({ rgb, l: lab[0], a: lab[1], b: lab[2] });
  }
  if (kept.length === 0) return null;
  if (kept.length <= maxStops) return { stops: kept.map((k) => k.rgb) };
  const stops: Rgb[] = [];
  for (let s = 0; s < maxStops; s++)
    stops.push(kept[Math.round((s * (kept.length - 1)) / (maxStops - 1))].rgb);
  return { stops };
}

/**
 * Keys for the background: the main colors around the image's edge, each seeded where it was found
 * so a `connected` selection keeps to the areas joined to the edge (the same color inside the
 * subject stays).
 */
export function edgeSelection(source: RasterSource, maxColors = 6): ColorKey[] {
  const { width, height } = source;
  const samples: Array<{ point: KeyPoint; rgb: Rgb }> = [];
  const steps = 64;
  const add = (x: number, y: number) => {
    const point = { x: (x + 0.5) / width, y: (y + 0.5) / height };
    const rgb = colorAt(source, point);
    if (rgb) samples.push({ point, rgb });
  };
  for (let s = 0; s < steps; s++) {
    const x = Math.min(width - 1, Math.floor((s / steps) * width));
    const y = Math.min(height - 1, Math.floor((s / steps) * height));
    add(x, 0);
    add(x, height - 1);
    add(0, y);
    add(width - 1, y);
  }
  if (samples.length === 0) return [];
  // Greedy clusters in OKLab; the ones covering at least 8 % of the edge are the background.
  const lab = new Float32Array(3);
  const clusters: Array<{ l: number; a: number; b: number; members: typeof samples }> = [];
  for (const sample of samples) {
    toOklab(sample.rgb[0], sample.rgb[1], sample.rgb[2], lab);
    const near = clusters.find((c) => Math.hypot(c.l - lab[0], c.a - lab[1], c.b - lab[2]) < 0.06);
    if (near) near.members.push(sample);
    else clusters.push({ l: lab[0], a: lab[1], b: lab[2], members: [sample] });
  }
  const main = clusters
    .filter((c) => c.members.length >= samples.length * 0.08)
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, maxColors);
  const chosen = main.length > 0 ? main : [clusters.sort((a, b) => b.members.length - a.members.length)[0]];
  return chosen.map((c) => ({
    stops: [averageRgb(c.members.map((m) => m.rgb))],
    seeds: c.members.map((m) => m.point),
  }));
}

function averageRgb(colors: Rgb[]): Rgb {
  const sum = [0, 0, 0];
  for (const c of colors) for (let k = 0; k < 3; k++) sum[k] += c[k];
  return [
    Math.round(sum[0] / colors.length),
    Math.round(sum[1] / colors.length),
    Math.round(sum[2] / colors.length),
  ];
}
