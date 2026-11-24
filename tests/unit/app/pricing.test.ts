import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  fitAlong,
  gridFit,
  money,
  piecePositions,
  piecesPerSheet,
  priceBreakdown,
  pricingProblem,
  type PricingInputs,
} from '$app/lib/pricing';
import {
  DEFAULT_MACHINE,
  defaultJob,
  defaultPricingData,
  extrasTotal,
  jobFromProduct,
  normalizePricing,
  upsertProduct,
} from '$app/lib/pricing-data';

describe('fitAlong', () => {
  it('counts pieces with the spacing only between neighbours', () => {
    // 5 × 50 + 4 × 2 = 258 fits in 300; a sixth piece needs 310.
    expect(fitAlong(300, 50, 2)).toBe(5);
    // 50 + 4 + 50 = 104 exactly.
    expect(fitAlong(104, 50, 4)).toBe(2);
    expect(fitAlong(103.9, 50, 4)).toBe(1);
    expect(fitAlong(100, 20, 0)).toBe(5);
  });

  it('is not tripped up by floating-point error', () => {
    expect(fitAlong(0.3, 0.1, 0)).toBe(3);
    expect(fitAlong(30.3, 10, 0.15)).toBe(3);
  });

  it('fits nothing when the piece is too big or a size is missing', () => {
    expect(fitAlong(40, 50, 2)).toBe(0);
    expect(fitAlong(0, 10, 2)).toBe(0);
    expect(fitAlong(100, 0, 2)).toBe(0);
    expect(fitAlong(100, -5, 2)).toBe(0);
    expect(fitAlong(Number.NaN, 10, 2)).toBe(0);
  });

  it('treats negative or missing spacing as none', () => {
    expect(fitAlong(100, 20, -3)).toBe(5);
    expect(fitAlong(100, 20, Number.NaN)).toBe(5);
  });
});

describe('gridFit', () => {
  it('keeps the piece upright when that fits more', () => {
    const fit = gridFit({ width: 300, height: 200 }, { width: 60, height: 40 }, 0);
    expect(fit).toMatchObject({ columns: 5, rows: 5, count: 25, rotated: false });
    expect(fit.piece).toEqual({ width: 60, height: 40 });
  });

  it('turns the piece when that fits more', () => {
    // Upright 3 × 3 = 9; turned to 60 × 90 it is 5 × 2 = 10.
    const fit = gridFit({ width: 300, height: 200 }, { width: 90, height: 60 }, 0);
    expect(fit).toMatchObject({ columns: 5, rows: 2, count: 10, rotated: true });
    expect(fit.piece).toEqual({ width: 60, height: 90 });
  });

  it('keeps the piece as drawn on a tie', () => {
    expect(gridFit({ width: 300, height: 200 }, { width: 50, height: 50 }, 2).rotated).toBe(false);
  });

  it('fits nothing when the piece is larger than the area either way', () => {
    expect(gridFit({ width: 300, height: 200 }, { width: 400, height: 10 }, 2).count).toBe(0);
  });

  it('always fits within the area and cannot take another row or column', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 2000, noNaN: true }),
        fc.double({ min: 1, max: 2000, noNaN: true }),
        fc.double({ min: 0.5, max: 500, noNaN: true }),
        fc.double({ min: 0.5, max: 500, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (aw, ah, pw, ph, gap) => {
          const fit = gridFit({ width: aw, height: ah }, { width: pw, height: ph }, gap);
          const span = (n: number, p: number) => n * p + Math.max(0, n - 1) * gap;
          const tolerance = 1e-6;
          expect(fit.count).toBe(fit.columns * fit.rows);
          if (fit.count === 0) return;
          expect(span(fit.columns, fit.piece.width)).toBeLessThanOrEqual(aw + tolerance);
          expect(span(fit.rows, fit.piece.height)).toBeLessThanOrEqual(ah + tolerance);
          expect(span(fit.columns + 1, fit.piece.width)).toBeGreaterThan(aw - tolerance);
          expect(span(fit.rows + 1, fit.piece.height)).toBeGreaterThan(ah - tolerance);
          // The other orientation never fits more.
          const other = gridFit({ width: aw, height: ah }, { width: ph, height: pw }, gap);
          expect(fit.count).toBe(other.count);
        },
      ),
    );
  });
});

describe('piecesPerSheet', () => {
  const k40 = { width: 300, height: 200 };

  it('uses the part of a big sheet that fits on the bed', () => {
    const fit = piecesPerSheet({ width: 600, height: 400 }, k40, { width: 50, height: 50 }, 0);
    expect(fit.area).toEqual({ width: 300, height: 200 });
    expect(fit.count).toBe(24);
  });

  it('uses the whole of a sheet smaller than the bed', () => {
    const fit = piecesPerSheet({ width: 150, height: 100 }, k40, { width: 50, height: 50 }, 0);
    expect(fit.area).toEqual({ width: 150, height: 100 });
    expect(fit.count).toBe(6);
  });

  it('turns a sheet entered the other way round when that fits more', () => {
    // As entered: min(200, 300) × min(300, 200) = 200 × 200 holds 4. Turned, 300 × 200 holds 6.
    const fit = piecesPerSheet({ width: 200, height: 300 }, k40, { width: 100, height: 100 }, 0);
    expect(fit).toMatchObject({ count: 6, sheetRotated: true, columns: 3, rows: 2 });
    expect(fit.sheet).toEqual({ width: 300, height: 200 });
    expect(fit.area).toEqual({ width: 300, height: 200 });
  });

  it('keeps the sheet as entered on a tie', () => {
    const fit = piecesPerSheet({ width: 300, height: 200 }, k40, { width: 50, height: 50 }, 2);
    expect(fit.sheetRotated).toBe(false);
    expect(fit.sheet).toEqual({ width: 300, height: 200 });
  });

  it('fits a 38 × 30 mm pin 45 to a K40 Plus bed-sized sheet, turned', () => {
    // Upright: 7 × 6 = 42. Turned (30 × 38): 9 × 5 = 45.
    const fit = piecesPerSheet(k40, k40, { width: 38, height: 30 }, 2);
    expect(fit).toMatchObject({ columns: 9, rows: 5, count: 45, rotated: true, sheetRotated: false });
  });

  it('reports no fit for a piece too big for the bed', () => {
    expect(piecesPerSheet({ width: 600, height: 400 }, k40, { width: 320, height: 50 }, 2).count).toBe(0);
  });
});

describe('piecePositions', () => {
  it('lays pieces out row by row with the spacing between them', () => {
    const fit = gridFit({ width: 25, height: 25 }, { width: 10, height: 10 }, 2);
    expect(piecePositions(fit, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 0, y: 12 },
      { x: 12, y: 12 },
    ]);
  });

  it('stops at the limit', () => {
    const fit = gridFit({ width: 1000, height: 1000 }, { width: 1, height: 1 }, 0);
    expect(piecePositions(fit, 0, 50)).toHaveLength(50);
  });
});

function inputs(patch: Partial<PricingInputs> = {}): PricingInputs {
  return {
    machineRate: 2.5,
    sheetCost: 2,
    piecesPerSheet: 45,
    extras: 0.5,
    cutMinutes: 3,
    labourMinutes: 2,
    setupMinutes: 10,
    batchSize: 20,
    labourRate: 20,
    feePercent: 10,
    markup: 2,
    ...patch,
  };
}

describe('priceBreakdown', () => {
  it('works out each cost, the suggested price and the earnings', () => {
    const b = priceBreakdown(inputs())!;
    expect(b.sheetShare).toBeCloseTo(2 / 45, 10);
    expect(b.extras).toBe(0.5);
    expect(b.material).toBeCloseTo(2 / 45 + 0.5, 10);
    // 3 min at $2.50/h.
    expect(b.machine).toBeCloseTo(0.125, 10);
    // (2 min + 10 min / 20) at $20/h.
    expect(b.labour).toBeCloseTo((2.5 / 60) * 20, 10);
    const cost = 2 / 45 + 0.5 + 0.125 + (2.5 / 60) * 20;
    expect(b.cost).toBeCloseTo(cost, 10);
    expect(b.beforeFees).toBeCloseTo(cost * 2, 10);
    expect(b.price).toBeCloseTo((cost * 2) / 0.9, 10);
    expect(b.fees).toBeCloseTo(((cost * 2) / 0.9) * 0.1, 10);
    expect(b.profit).toBeCloseTo(cost, 10);
    expect(b.batchProfit).toBeCloseTo(cost * 20, 10);
    expect(b.sheets).toBe(1);
    // (3 + 2) min × 20 + 10 min setup.
    expect(b.batchHours).toBeCloseTo(110 / 60, 10);
    expect(b.hourly).toBeCloseTo(((b.labour + b.profit) * 20) / (110 / 60), 10);
    expect(money(b.cost)).toBe('$1.50');
    expect(money(b.price)).toBe('$3.34');
    expect(money(b.hourly!)).toBe('$25.48');
  });

  it('shares setup across the batch', () => {
    const one = priceBreakdown(inputs({ batchSize: 1 }))!;
    const ten = priceBreakdown(inputs({ batchSize: 10 }))!;
    expect(one.labour - ten.labour).toBeCloseTo(((10 - 1) / 60) * 20, 10);
  });

  it('counts the sheets a batch uses', () => {
    expect(priceBreakdown(inputs({ batchSize: 45 }))!.sheets).toBe(1);
    expect(priceBreakdown(inputs({ batchSize: 46 }))!.sheets).toBe(2);
    expect(priceBreakdown(inputs({ batchSize: 100, piecesPerSheet: 12 }))!.sheets).toBe(9);
  });

  it('prices salvage material at $0', () => {
    const b = priceBreakdown(inputs({ sheetCost: 0, extras: 0 }))!;
    expect(b.sheetShare).toBe(0);
    expect(b.material).toBe(0);
  });

  it('without fees the price is cost × markup', () => {
    const b = priceBreakdown(inputs({ feePercent: 0 }))!;
    expect(b.price).toBeCloseTo(b.cost * 2, 10);
    expect(b.fees).toBe(0);
  });

  it('shows a loss when the markup is under 1', () => {
    const b = priceBreakdown(inputs({ markup: 0.8 }))!;
    expect(b.profit).toBeLessThan(0);
    expect(b.profit).toBeCloseTo(b.cost * -0.2, 10);
  });

  it('has no hourly figure for a batch that takes no time', () => {
    expect(priceBreakdown(inputs({ cutMinutes: 0, labourMinutes: 0, setupMinutes: 0 }))!.hourly).toBeNull();
  });

  it('always leaves cost × markup after fees, and profit = cost × (markup − 1)', () => {
    fc.assert(
      fc.property(
        fc.record({
          machineRate: fc.double({ min: 0, max: 100, noNaN: true }),
          sheetCost: fc.double({ min: 0, max: 200, noNaN: true }),
          piecesPerSheet: fc.integer({ min: 1, max: 500 }),
          extras: fc.double({ min: 0, max: 20, noNaN: true }),
          cutMinutes: fc.double({ min: 0, max: 120, noNaN: true }),
          labourMinutes: fc.double({ min: 0, max: 120, noNaN: true }),
          setupMinutes: fc.double({ min: 0, max: 240, noNaN: true }),
          batchSize: fc.integer({ min: 1, max: 1000 }),
          labourRate: fc.double({ min: 0, max: 200, noNaN: true }),
          feePercent: fc.double({ min: 0, max: 60, noNaN: true }),
          markup: fc.double({ min: 0, max: 10, noNaN: true }),
        }),
        (i) => {
          const b = priceBreakdown(i)!;
          const scale = Math.max(1, b.price);
          expect(b.cost).toBeCloseTo(b.material + b.machine + b.labour, 9);
          expect((b.price - b.fees) / scale).toBeCloseTo((b.cost * i.markup) / scale, 9);
          expect(b.fees / scale).toBeCloseTo((b.price * i.feePercent) / 100 / scale, 9);
          expect(b.profit / scale).toBeCloseTo((b.cost * (i.markup - 1)) / scale, 9);
          expect(b.sheets * i.piecesPerSheet).toBeGreaterThanOrEqual(i.batchSize);
        },
      ),
    );
  });
});

describe('pricingProblem', () => {
  it('accepts sensible inputs', () => {
    expect(pricingProblem(inputs())).toBeNull();
  });

  it.each([
    [{ piecesPerSheet: 0 }, /does not fit/],
    [{ batchSize: 0 }, /at least one piece/],
    [{ feePercent: 100 }, /under 100%/],
    [{ sheetCost: -1 }, /cannot be negative/],
    [{ markup: -0.5 }, /cannot be negative/],
    [{ cutMinutes: Number.NaN }, /number in every field/],
    [{ labourRate: Number.POSITIVE_INFINITY }, /number in every field/],
  ] as Array<[Partial<PricingInputs>, RegExp]>)('rejects %o', (patch, message) => {
    expect(pricingProblem(inputs(patch))).toMatch(message);
    expect(priceBreakdown(inputs(patch))).toBeNull();
  });
});

describe('money', () => {
  it('rounds to cents', () => {
    expect(money(1.25)).toBe('$1.25');
    expect(money(3.339506)).toBe('$3.34');
    expect(money(0)).toBe('$0.00');
    expect(money(1234.5)).toBe('$1234.50');
  });

  it('marks losses with a minus sign but never shows −$0.00', () => {
    expect(money(-0.4)).toBe('−$0.40');
    expect(money(-0.001)).toBe('$0.00');
  });
});

describe('pricing data', () => {
  it('ships an OMTech K40 Plus profile at $2.50/h', () => {
    const data = defaultPricingData();
    expect(data.machines).toEqual([DEFAULT_MACHINE]);
    expect(DEFAULT_MACHINE).toMatchObject({
      name: 'OMTech K40 Plus',
      bedWidth: 300,
      bedHeight: 200,
      hourlyRate: 2.5,
    });
    expect(data.job.machineId).toBe(DEFAULT_MACHINE.id);
    expect(data.job.piece.spacing).toBe(2);
    expect(data.job.markup).toBe(2);
  });

  it('adds up the per-piece extras', () => {
    expect(extrasTotal({ paint: 0.1, sealer: 0.05, pinBacks: 0.3, packaging: 0.25 })).toBeCloseTo(0.7, 10);
  });

  it('reads nothing stored as the defaults', () => {
    expect(normalizePricing(undefined)).toEqual(defaultPricingData());
    expect(normalizePricing('junk')).toEqual(defaultPricingData());
  });

  it('keeps valid stored data and repairs the rest', () => {
    const data = normalizePricing({
      machines: [
        { id: 'a', name: 'Shop laser', bedWidth: 600, bedHeight: 400, hourlyRate: 4 },
        { id: 'a', name: 'Duplicate' },
        { name: 'No id' },
        { id: 'b', name: '', bedWidth: -5, hourlyRate: 'x' },
      ],
      job: {
        machineId: 'gone',
        sheet: { name: 'Acrylic', width: 600, height: 400, thickness: 3, cost: 0 },
        piece: { width: 38, height: 30, spacing: 'wide', fromDesign: false },
        time: { batchSize: 12.7 },
        feePercent: 150,
        markup: 2.5,
      },
      products: [{ id: 'p', name: 'W pin', job: { machineId: 'b' } }, { name: 'No id' }],
      productId: 'p',
    });
    expect(data.machines).toEqual([
      { id: 'a', name: 'Shop laser', bedWidth: 600, bedHeight: 400, hourlyRate: 4 },
      { id: 'b', name: 'Laser', bedWidth: 300, bedHeight: 200, hourlyRate: 2.5 },
    ]);
    expect(data.job.machineId).toBe('a');
    expect(data.job.sheet).toEqual({ name: 'Acrylic', width: 600, height: 400, thickness: 3, cost: 0 });
    expect(data.job.piece).toEqual({ width: 38, height: 30, spacing: 2, fromDesign: false });
    expect(data.job.time.batchSize).toBe(12);
    expect(data.job.feePercent).toBe(10);
    expect(data.job.markup).toBe(2.5);
    expect(data.products).toHaveLength(1);
    expect(data.products[0].job.machineId).toBe('b');
    expect(data.productId).toBe('p');
  });

  it('always has a machine', () => {
    expect(normalizePricing({ machines: [] }).machines).toEqual([DEFAULT_MACHINE]);
  });
});

describe('product presets', () => {
  let n = 0;
  const makeId = () => `id${++n}`;

  it('adds presets sorted by name, with a copy of the inputs', () => {
    const job = defaultJob();
    const first = upsertProduct([], 'W pin', job, makeId);
    const second = upsertProduct(first.products, '  Coaster ', job, makeId);
    expect(second.products.map((p) => p.name)).toEqual(['Coaster', 'W pin']);
    job.markup = 9;
    expect(second.products.every((p) => p.job.markup === 2)).toBe(true);
  });

  it('updates a preset with the same name, ignoring case', () => {
    const first = upsertProduct([], 'W pin', defaultJob(), makeId);
    const changed = { ...defaultJob(), markup: 3 };
    const again = upsertProduct(first.products, 'w PIN', changed, makeId);
    expect(again.id).toBe(first.id);
    expect(again.products).toHaveLength(1);
    expect(again.products[0]).toMatchObject({ name: 'w PIN', job: { markup: 3 } });
  });

  it('needs a name', () => {
    expect(() => upsertProduct([], '   ', defaultJob(), makeId)).toThrow(/Name the product/);
  });

  it('loads a preset, keeping the current machine if its own is gone', () => {
    const preset = { id: 'p', name: 'W pin', job: { ...defaultJob('deleted'), markup: 3 } };
    const current = defaultJob('k40');
    const job = jobFromProduct(preset, current, ['k40']);
    expect(job.machineId).toBe('k40');
    expect(job.markup).toBe(3);
    expect(
      jobFromProduct({ ...preset, job: defaultJob('k40') }, defaultJob('other'), ['k40', 'other']).machineId,
    ).toBe('k40');
  });
});
