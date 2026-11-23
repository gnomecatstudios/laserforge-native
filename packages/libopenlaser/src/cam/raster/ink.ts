/**
 * Ink extraction: turns a phone photo of a pen or marker drawing on paper into black ink on a
 * transparent background, cropped to the drawing.
 *
 * Phone photos light the page unevenly (a shadow from the phone, a darker corner), so a single
 * threshold either loses ink in the bright areas or keeps shadow in the dark ones. Instead the
 * paper's own brightness is estimated everywhere (a grayscale closing that erases strokes, then a
 * blur) and each pixel is compared with the paper around it. Ink is much darker than its local
 * paper; shadows and paper texture are not. Faint texture away from the strokes and small specks
 * of dust are dropped.
 */
import type { RasterSource } from '../types';
import type { RasterCrop } from './color-key';

export interface InkOptions {
  /**
   * Relative brightness (pixel ÷ local paper) at or below which a pixel is solid ink. Between
   * this and `paperLevel` coverage ramps smoothly, which keeps stroke edges anti-aliased.
   */
  inkLevel?: number;
  /** Relative brightness at or above which a pixel is paper (fully transparent). */
  paperLevel?: number;
  /** Marks smaller than this share of the image's pixels are treated as dust and dropped. */
  minSpeck?: number;
  /** Margin kept around the drawing, as a share of the image's longer side. */
  margin?: number;
}

export const DEFAULT_INK_OPTIONS: Required<InkOptions> = {
  inkLevel: 0.55,
  paperLevel: 0.85,
  minSpeck: 5e-5,
  margin: 0.01,
};

/** Size of the working copy the paper brightness is estimated on (longer side, px). */
const BACKGROUND_SIZE = 400;
/** Strokes up to this share of the longer side wide are erased from the paper estimate. */
const STROKE_SHARE = 0.025;
/** How far soft stroke edges reach beyond solid ink, as a share of the longer side. */
const EDGE_SHARE = 0.002;

/**
 * Black ink with coverage in alpha, cropped to the drawing, or null when nothing on the page
 * reads as ink. Transparent input pixels count as paper.
 */
export function extractInk(source: RasterSource, options: InkOptions = {}): RasterCrop | null {
  const opts = { ...DEFAULT_INK_OPTIONS, ...options };
  const { width, height } = source;
  if (width === 0 || height === 0) return null;
  const luma = lumaOverWhite(source);
  const paper = paperBrightness(luma, width, height);

  const count = width * height;
  const coverage = new Float32Array(count);
  const span = Math.max(1e-3, opts.paperLevel - opts.inkLevel);
  for (let i = 0; i < count; i++) {
    const relative = luma[i] / Math.max(1, paper[i]);
    const c = (opts.paperLevel - relative) / span;
    coverage[i] = c <= 0 ? 0 : c >= 1 ? 1 : c;
  }

  const keep = keepLargeMarks(coverage, width, height, Math.max(4, Math.round(count * opts.minSpeck)));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      if (!keep[i]) coverage[i] = 0;
      if (coverage[i] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  const pad = Math.round(Math.max(width, height) * opts.margin);
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width, maxX + pad + 1);
  const y1 = Math.min(height, maxY + pad + 1);
  const w = x1 - x0;
  const h = y1 - y0;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let y = 0; y < h; y++) {
    let src = (y + y0) * width + x0;
    let dst = y * w * 4 + 3;
    for (let x = 0; x < w; x++, src++, dst += 4) data[dst] = Math.round(coverage[src] * 255);
  }
  return { x: x0, y: y0, width: w, height: h, data };
}

/** Rec. 709 luminance, with transparency composited over white paper. */
function lumaOverWhite(source: RasterSource): Float32Array {
  const { width, height, data } = source;
  const count = width * height;
  const luma = new Float32Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const y = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
    const a = data[p + 3] / 255;
    luma[i] = y * a + 255 * (1 - a);
  }
  return luma;
}

/**
 * Local paper brightness at full resolution. Estimated on a small copy: a closing (max then min
 * filter) removes dark strokes narrower than the window, a blur smooths the result, and bilinear
 * upsampling brings it back to full size.
 */
function paperBrightness(luma: Float32Array, width: number, height: number): Float32Array {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / BACKGROUND_SIZE));
  const sw = Math.ceil(width / step);
  const sh = Math.ceil(height / step);
  // Block mean: averages paper texture out rather than chasing its brightest grains.
  let small: Float32Array = new Float32Array(sw * sh);
  const samples = new Float32Array(sw * sh);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / step) * sw;
    for (let x = 0, i = y * width; x < width; x++, i++) {
      const j = row + Math.floor(x / step);
      small[j] += luma[i];
      samples[j]++;
    }
  }
  for (let j = 0; j < small.length; j++) small[j] /= samples[j];
  const radius = Math.max(2, Math.ceil(Math.max(sw, sh) * STROKE_SHARE));
  small = filter(small, sw, sh, radius, Math.max);
  small = filter(small, sw, sh, radius, Math.min);
  for (let pass = 0; pass < 3; pass++) small = boxBlur(small, sw, sh, radius);

  const out = new Float32Array(width * height);
  for (let y = 0, i = 0; y < height; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / step - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++, i++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / step - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const top = small[y0 * sw + x0] * (1 - tx) + small[y0 * sw + x1] * tx;
      const bottom = small[y1 * sw + x0] * (1 - tx) + small[y1 * sw + x1] * tx;
      out[i] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** Separable square max or min filter, clamped at the edges. */
function filter(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
  pick: (a: number, b: number) => number,
): Float32Array {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x];
      for (let k = Math.max(0, x - r), end = Math.min(w - 1, x + r); k <= end; k++)
        v = pick(v, src[y * w + k]);
      tmp[y * w + x] = v;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let k = Math.max(0, y - r), end = Math.min(h - 1, y + r); k <= end; k++)
        v = pick(v, tmp[k * w + x]);
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Separable box blur, averaging only the samples inside the image. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      const a = Math.max(0, x - r);
      const b = Math.min(w - 1, x + r);
      for (let k = a; k <= b; k++) sum += src[y * w + k];
      tmp[y * w + x] = sum / (b - a + 1);
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      const a = Math.max(0, y - r);
      const b = Math.min(h - 1, y + r);
      for (let k = a; k <= b; k++) sum += tmp[k * w + x];
      out[y * w + x] = sum / (b - a + 1);
    }
  }
  return out;
}

/**
 * Which pixels may keep their coverage: solid ink (coverage ≥ ½) in 8-connected marks of at least
 * `minSolid` pixels, grown by a few pixels so the anti-aliased edge around each stroke survives.
 * Faint paper texture away from the strokes is dropped, and dust specks go with their marks.
 */
function keepLargeMarks(coverage: Float32Array, w: number, h: number, minSolid: number): Uint8Array {
  const count = w * h;
  const seen = new Uint8Array(count);
  const keep = new Uint8Array(count);
  const stack = new Int32Array(count);
  const members: number[] = [];
  for (let start = 0; start < count; start++) {
    if (seen[start] || coverage[start] < 0.5) continue;
    let top = 0;
    members.length = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const n = ny * w + nx;
          if (seen[n] || coverage[n] < 0.5) continue;
          seen[n] = 1;
          stack[top++] = n;
        }
      }
    }
    if (members.length >= minSolid) for (const i of members) keep[i] = 1;
  }
  return dilate(keep, w, h, Math.max(2, Math.round(Math.max(w, h) * EDGE_SHARE)));
}

/** Square binary dilation by `r` pixels (separable). */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    // Two sweeps: distance to the nearest set pixel on the left, then on the right.
    let last = -Infinity;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) last = x;
      if (x - last <= r) tmp[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) last = x;
      if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}
