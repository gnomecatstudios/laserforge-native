/** Dithering choices shown in the layer settings and the Bitmap view, in menu order. */
import type { DitherAlgorithm } from 'libopenlaser/project';

export const DITHER_ALGORITHMS: ReadonlyArray<{ id: DitherAlgorithm; label: string }> = [
  { id: 'floyd-steinberg', label: 'Floyd–Steinberg' },
  { id: 'atkinson', label: 'Atkinson' },
  { id: 'jarvis', label: 'Jarvis' },
  { id: 'stucki', label: 'Stucki' },
  { id: 'ordered', label: 'Bayer 8×8' },
  { id: 'threshold', label: 'Threshold' },
  { id: 'grayscale', label: 'Grayscale' },
];
