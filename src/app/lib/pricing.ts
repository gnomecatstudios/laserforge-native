/**
 * Pricing calculator math: how many pieces fit on a sheet on the bed, and what each one costs to
 * make and should sell for. Pure functions; the Preview panel supplies the numbers.
 */

export interface Size {
  /** mm */
  width: number;
  /** mm */
  height: number;
}

export interface GridFit {
  columns: number;
  rows: number;
  count: number;
  /** The piece is laid out turned 90° from how it was entered. */
  rotated: boolean;
  /** Each piece's footprint as laid out (swapped when rotated), mm. */
  piece: Size;
}

export interface SheetFit extends GridFit {
  /** Where pieces can go: the part of the sheet that lies on the bed, mm. */
  area: Size;
  /** The sheet sits on the bed turned 90° from how it was entered, which fits more. */
  sheetRotated: boolean;
  /** The sheet as it sits on the bed (swapped when sheetRotated), mm. */
  sheet: Size;
}

/** Absorbs floating-point error so 100 mm holds exactly five 20 mm pieces. */
const EPSILON = 1e-9;

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Pieces that fit along one side. `spacing` is the gap between neighbouring pieces (kerf and
 * clearance); pieces may sit at the area's edges, so n pieces need n × piece + (n − 1) × spacing.
 */
export function fitAlong(length: number, piece: number, spacing: number): number {
  if (!positive(length) || !positive(piece)) return 0;
  const gap = Number.isFinite(spacing) ? Math.max(0, spacing) : 0;
  return Math.max(0, Math.floor((length + gap) / (piece + gap) + EPSILON));
}

/** A same-way-round grid of pieces in `area`, trying the piece both ways and keeping the better. */
export function gridFit(area: Size, piece: Size, spacing: number): GridFit {
  const grid = (rotated: boolean): GridFit => {
    const p = rotated ? { width: piece.height, height: piece.width } : { ...piece };
    const columns = fitAlong(area.width, p.width, spacing);
    const rows = fitAlong(area.height, p.height, spacing);
    return { columns, rows, count: columns * rows, rotated, piece: p };
  };
  const upright = grid(false);
  const turned = grid(true);
  // Ties keep the piece the way it was drawn.
  return turned.count > upright.count ? turned : upright;
}

/**
 * Pieces per sheet: a grid in the part of the sheet that fits on the bed, min(sheet, bed) on each
 * side. The piece is tried both ways round; so is the sheet, which can go on the bed either way.
 * Ties keep the sheet and the piece as entered.
 */
export function piecesPerSheet(sheet: Size, bed: Size, piece: Size, spacing: number): SheetFit {
  const place = (sheetRotated: boolean): SheetFit => {
    const s = sheetRotated ? { width: sheet.height, height: sheet.width } : { ...sheet };
    const area = { width: Math.min(s.width, bed.width), height: Math.min(s.height, bed.height) };
    return { ...gridFit(area, piece, spacing), area, sheetRotated, sheet: s };
  };
  const asIs = place(false);
  const turned = place(true);
  return turned.count > asIs.count ? turned : asIs;
}

/** Top-left corners of each piece in a fit, from the area's top-left corner, mm. */
export function piecePositions(
  fit: GridFit,
  spacing: number,
  limit = Infinity,
): Array<{ x: number; y: number }> {
  const gap = Number.isFinite(spacing) ? Math.max(0, spacing) : 0;
  const out: Array<{ x: number; y: number }> = [];
  for (let row = 0; row < fit.rows; row++)
    for (let column = 0; column < fit.columns; column++) {
      if (out.length >= limit) return out;
      out.push({ x: column * (fit.piece.width + gap), y: row * (fit.piece.height + gap) });
    }
  return out;
}

export interface PricingInputs {
  /** $ per hour the laser runs. */
  machineRate: number;
  /** $ per sheet: 0 or a replacement value works for offcuts and salvage. */
  sheetCost: number;
  piecesPerSheet: number;
  /** $ per piece for paint, sealer, findings and packaging, added together. */
  extras: number;
  /** Laser minutes per piece. */
  cutMinutes: number;
  /** Hands-on minutes per piece: weeding, sanding, painting, packing. */
  labourMinutes: number;
  /** Minutes per batch to set up, shared by every piece in it. */
  setupMinutes: number;
  /** Pieces made in one batch. */
  batchSize: number;
  /** $ per hour of your time. */
  labourRate: number;
  /** Marketplace and payment fees, percent of the sale price. */
  feePercent: number;
  /** Price before fees = cost × markup. */
  markup: number;
}

export interface PriceBreakdown {
  /** All money is $ per piece unless named batch. */
  sheetShare: number;
  extras: number;
  material: number;
  machine: number;
  labour: number;
  cost: number;
  /** cost × markup, what is left after fees at the suggested price. */
  beforeFees: number;
  /** Suggested retail: (cost × markup) / (1 − fees). */
  price: number;
  fees: number;
  profit: number;
  batchProfit: number;
  /** Sheets the whole batch uses. */
  sheets: number;
  /** Laser, hands-on and setup time for the batch. */
  batchHours: number;
  /**
   * Your labour pay plus profit per hour of batch time, or null when the batch takes no time.
   * Laser time counts: a laser should not run unattended.
   */
  hourly: number | null;
}

/** Why the inputs cannot be priced, or null when they can. */
export function pricingProblem(inputs: PricingInputs): string | null {
  const values = Object.values(inputs);
  if (values.some((v) => !Number.isFinite(v))) return 'Enter a number in every field.';
  if (inputs.piecesPerSheet < 1) return 'The piece does not fit on the sheet within the bed.';
  if (inputs.batchSize < 1) return 'The batch needs at least one piece.';
  if (inputs.feePercent >= 100) return 'Fees must be under 100%.';
  const amounts = [
    inputs.machineRate,
    inputs.sheetCost,
    inputs.extras,
    inputs.cutMinutes,
    inputs.labourMinutes,
    inputs.setupMinutes,
    inputs.labourRate,
    inputs.feePercent,
    inputs.markup,
  ];
  if (amounts.some((v) => v < 0)) return 'Costs, times, rates and markup cannot be negative.';
  return null;
}

/** Per-piece costs and the suggested price, or null when pricingProblem() finds a problem. */
export function priceBreakdown(inputs: PricingInputs): PriceBreakdown | null {
  if (pricingProblem(inputs)) return null;
  const batch = Math.floor(inputs.batchSize);
  const sheetShare = inputs.sheetCost / inputs.piecesPerSheet;
  const material = sheetShare + inputs.extras;
  const machine = (inputs.cutMinutes / 60) * inputs.machineRate;
  const labour = ((inputs.labourMinutes + inputs.setupMinutes / batch) / 60) * inputs.labourRate;
  const cost = material + machine + labour;
  const beforeFees = cost * inputs.markup;
  const price = beforeFees / (1 - inputs.feePercent / 100);
  const fees = price - beforeFees;
  const profit = price - fees - cost;
  const batchProfit = profit * batch;
  const batchHours = ((inputs.cutMinutes + inputs.labourMinutes) * batch + inputs.setupMinutes) / 60;
  const hourly = batchHours > 0 ? ((labour + profit) * batch) / batchHours : null;
  return {
    sheetShare,
    extras: inputs.extras,
    material,
    machine,
    labour,
    cost,
    beforeFees,
    price,
    fees,
    profit,
    batchProfit,
    sheets: Math.ceil(batch / inputs.piecesPerSheet),
    batchHours,
    hourly,
  };
}

/** "$1.25", "−$0.40". Rounds to cents. */
export function money(value: number): string {
  const cents = Math.round(value * 100);
  const text = `$${(Math.abs(cents) / 100).toFixed(2)}`;
  return cents < 0 ? `−${text}` : text;
}
