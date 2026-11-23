import type { ErrorPolicy } from 'libopenlaser/machine';

export type ThemePreference = 'system' | 'dark' | 'light';

/** How Bitmap mode draws the original: what shows through transparent areas, and the selection tint. */
export interface BitmapViewColors {
  /** The two colors of the checkerboard behind transparent pixels, as #rrggbb. Equal for a solid fill. */
  backdrop: [string, string];
  /** Tint over selected pixels in the Separate tab, as #rrggbb. */
  highlight: string;
}

export const DEFAULT_BITMAP_VIEW: BitmapViewColors = {
  backdrop: ['#f5f5f5', '#cccccc'],
  highlight: '#ff00aa',
};

export interface Preferences {
  theme: ThemePreference;
  /** Status poll interval while idle, ms. */
  statusPollMs: number;
  errorPolicy: ErrorPolicy;
  /** Hide `?` status traffic and `ok` lines in the console. */
  quietConsole: boolean;
  /** Keep the console scrolled to the newest line. */
  consoleAutoScroll: boolean;
  bitmapView: BitmapViewColors;
  debug: {
    gcodeComments: boolean;
    disableOptimizer: boolean;
    leadingZero: boolean;
  };
}

export function defaultPreferences(): Preferences {
  return {
    theme: 'system',
    statusPollMs: 200,
    errorPolicy: 'stop',
    quietConsole: true,
    consoleAutoScroll: true,
    bitmapView: { backdrop: [...DEFAULT_BITMAP_VIEW.backdrop], highlight: DEFAULT_BITMAP_VIEW.highlight },
    debug: { gcodeComments: false, disableOptimizer: false, leadingZero: true },
  };
}

/** Merges stored values over defaults so new preference fields get sane values. */
export function normalizePreferences(stored: unknown): Preferences {
  const defaults = defaultPreferences();
  if (!stored || typeof stored !== 'object') return defaults;
  const s = stored as Partial<Preferences>;
  return {
    ...defaults,
    ...s,
    statusPollMs: Math.min(1000, Math.max(50, Number(s.statusPollMs) || defaults.statusPollMs)),
    bitmapView: normalizeBitmapView(s.bitmapView),
    debug: { ...defaults.debug, ...(s.debug ?? {}) },
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

function hexOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;
}

/** Keeps stored Bitmap view colors that are valid #rrggbb and fills the rest from the defaults. */
export function normalizeBitmapView(stored: unknown): BitmapViewColors {
  const d = DEFAULT_BITMAP_VIEW;
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<
    Record<keyof BitmapViewColors, unknown>
  >;
  const backdrop = Array.isArray(s.backdrop) ? s.backdrop : [];
  return {
    backdrop: [hexOr(backdrop[0], d.backdrop[0]), hexOr(backdrop[1], d.backdrop[1])],
    highlight: hexOr(s.highlight, d.highlight),
  };
}
