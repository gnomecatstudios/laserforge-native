/**
 * What the pricing calculator remembers: its machine profiles (bed and hourly rate), the inputs
 * on screen, and product presets that save those inputs under a name. Stored as one settings
 * entry; anything unreadable falls back to the defaults below.
 */

export interface PricingMachine {
  id: string;
  name: string;
  /** mm */
  bedWidth: number;
  /** mm */
  bedHeight: number;
  /** $ per hour the laser runs. */
  hourlyRate: number;
}

export interface PricingSheet {
  name: string;
  /** mm */
  width: number;
  /** mm */
  height: number;
  /** mm, for reference. */
  thickness: number;
  /** $ per sheet; 0 or a replacement value for salvage. */
  cost: number;
}

export interface PricingJob {
  machineId: string;
  sheet: PricingSheet;
  piece: {
    /** mm, used when fromDesign is off or no design is loaded. */
    width: number;
    height: number;
    /** Gap between pieces for kerf and clearance, mm. */
    spacing: number;
    /** Size the piece from the bounding box of the design in Preview. */
    fromDesign: boolean;
  };
  /** $ per piece. */
  extras: { paint: number; sealer: number; pinBacks: number; packaging: number };
  time: {
    /** Laser minutes per piece, used when cutFromJob is off or there is no estimate. */
    cutMinutes: number;
    /** Use the compiled job's time estimate for cut minutes. */
    cutFromJob: boolean;
    labourMinutes: number;
    /** Per batch. */
    setupMinutes: number;
    batchSize: number;
  };
  /** $ per hour. */
  labourRate: number;
  /** Percent of the sale price. */
  feePercent: number;
  markup: number;
}

export interface ProductPreset {
  id: string;
  name: string;
  job: PricingJob;
}

export interface PricingData {
  version: 1;
  machines: PricingMachine[];
  /** The inputs on screen. */
  job: PricingJob;
  products: ProductPreset[];
  /** The preset last loaded or saved, if any. */
  productId: string | null;
}

export const PRICING_SETTING_KEY = 'pricing';

/** OMTech K40 Plus (K40+): 300 × 200 mm (12 × 8 in) working area. */
export const DEFAULT_MACHINE: Readonly<PricingMachine> = Object.freeze({
  id: 'omtech-k40-plus',
  name: 'OMTech K40 Plus',
  bedWidth: 300,
  bedHeight: 200,
  hourlyRate: 2.5,
});

export function defaultJob(machineId: string = DEFAULT_MACHINE.id): PricingJob {
  return {
    machineId,
    sheet: { name: '3 mm plywood', width: 300, height: 200, thickness: 3, cost: 2 },
    piece: { width: 50, height: 50, spacing: 2, fromDesign: true },
    extras: { paint: 0, sealer: 0, pinBacks: 0, packaging: 0 },
    time: { cutMinutes: 2, cutFromJob: true, labourMinutes: 2, setupMinutes: 10, batchSize: 10 },
    labourRate: 20,
    feePercent: 10,
    markup: 2,
  };
}

export function defaultPricingData(): PricingData {
  return { version: 1, machines: [{ ...DEFAULT_MACHINE }], job: defaultJob(), products: [], productId: null };
}

export function extrasTotal(extras: PricingJob['extras']): number {
  return extras.paint + extras.sealer + extras.pinBacks + extras.packaging;
}

type Loose = Record<string, unknown>;

function record(value: unknown): Loose {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : {};
}

function num(value: unknown, fallback: number, min = 0, max = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeMachine(value: unknown): PricingMachine | null {
  const m = record(value);
  if (typeof m.id !== 'string' || !m.id) return null;
  return {
    id: m.id,
    name: text(m.name, 'Laser'),
    bedWidth: num(m.bedWidth, DEFAULT_MACHINE.bedWidth, 1, 10_000),
    bedHeight: num(m.bedHeight, DEFAULT_MACHINE.bedHeight, 1, 10_000),
    hourlyRate: num(m.hourlyRate, DEFAULT_MACHINE.hourlyRate),
  };
}

/** Fills anything missing or out of range from the defaults. */
export function normalizeJob(value: unknown, machineIds: readonly string[]): PricingJob {
  const d = defaultJob(machineIds[0] ?? DEFAULT_MACHINE.id);
  const j = record(value);
  const sheet = record(j.sheet);
  const piece = record(j.piece);
  const extras = record(j.extras);
  const time = record(j.time);
  return {
    machineId:
      typeof j.machineId === 'string' && machineIds.includes(j.machineId) ? j.machineId : d.machineId,
    sheet: {
      name: text(sheet.name, d.sheet.name),
      width: num(sheet.width, d.sheet.width, 0.1, 10_000),
      height: num(sheet.height, d.sheet.height, 0.1, 10_000),
      thickness: num(sheet.thickness, d.sheet.thickness),
      cost: num(sheet.cost, d.sheet.cost),
    },
    piece: {
      width: num(piece.width, d.piece.width, 0.1, 10_000),
      height: num(piece.height, d.piece.height, 0.1, 10_000),
      spacing: num(piece.spacing, d.piece.spacing, 0, 1_000),
      fromDesign: flag(piece.fromDesign, d.piece.fromDesign),
    },
    extras: {
      paint: num(extras.paint, 0),
      sealer: num(extras.sealer, 0),
      pinBacks: num(extras.pinBacks, 0),
      packaging: num(extras.packaging, 0),
    },
    time: {
      cutMinutes: num(time.cutMinutes, d.time.cutMinutes),
      cutFromJob: flag(time.cutFromJob, d.time.cutFromJob),
      labourMinutes: num(time.labourMinutes, d.time.labourMinutes),
      setupMinutes: num(time.setupMinutes, d.time.setupMinutes),
      batchSize: Math.floor(num(time.batchSize, d.time.batchSize, 1, 1_000_000)),
    },
    labourRate: num(j.labourRate, d.labourRate),
    feePercent: num(j.feePercent, d.feePercent, 0, 99),
    markup: num(j.markup, d.markup, 0, 1_000),
  };
}

/** Reads stored pricing data, keeping what is valid. There is always at least one machine. */
export function normalizePricing(value: unknown): PricingData {
  const v = record(value);
  const machines: PricingMachine[] = [];
  for (const raw of Array.isArray(v.machines) ? v.machines : []) {
    const m = normalizeMachine(raw);
    if (m && !machines.some((n) => n.id === m.id)) machines.push(m);
  }
  if (machines.length === 0) machines.push({ ...DEFAULT_MACHINE });
  const ids = machines.map((m) => m.id);
  const products: ProductPreset[] = [];
  for (const raw of Array.isArray(v.products) ? v.products : []) {
    const p = record(raw);
    if (typeof p.id !== 'string' || !p.id || products.some((q) => q.id === p.id)) continue;
    products.push({ id: p.id, name: text(p.name, 'Product'), job: normalizeJob(p.job, ids) });
  }
  const productId =
    typeof v.productId === 'string' && products.some((p) => p.id === v.productId) ? v.productId : null;
  return { version: 1, machines, job: normalizeJob(v.job, ids), products, productId };
}

/**
 * Saves `job` as a product: a preset with the same name (ignoring case) is updated, otherwise a
 * new one is added. Presets stay sorted by name.
 */
export function upsertProduct(
  products: readonly ProductPreset[],
  name: string,
  job: PricingJob,
  makeId: () => string,
): { products: ProductPreset[]; id: string } {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error('Name the product first.');
  const existing = products.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  const id = existing?.id ?? makeId();
  const preset: ProductPreset = { id, name: clean, job: structuredClone(job) };
  const next = [...products.filter((p) => p.id !== id), preset].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  return { products: next, id };
}

/**
 * The inputs a preset brings back. Its machine is used if it still exists; otherwise the machine
 * on screen stays.
 */
export function jobFromProduct(
  preset: ProductPreset,
  current: PricingJob,
  machineIds: readonly string[],
): PricingJob {
  const job = structuredClone(preset.job);
  if (!machineIds.includes(job.machineId)) job.machineId = current.machineId;
  return job;
}
