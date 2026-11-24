import { expect, test, type Page } from '@playwright/test';
import { createProject, defaultLayer } from '../../packages/libopenlaser/src/project';
import type { VectorObject } from '../../packages/libopenlaser/src/project';
import { newProject, prepare } from './helpers';

/** A 38 × 30 mm rectangle: a pin-sized piece. */
const pin: VectorObject = {
  id: 'pin',
  kind: 'vector',
  name: 'Pin',
  layerId: 'l',
  visible: true,
  locked: false,
  transform: [1, 0, 0, 1, 20, 20],
  paths: [
    {
      start: { x: 0, y: 0 },
      closed: true,
      segments: [
        { type: 'L', to: { x: 38, y: 0 } },
        { type: 'L', to: { x: 38, y: 30 } },
        { type: 'L', to: { x: 0, y: 30 } },
      ],
    },
  ],
};

async function openPin(page: Page) {
  await newProject(page);
  const project = {
    ...createProject({ name: 'Pin' }),
    layers: [defaultLayer({ id: 'l', mode: 'line' })],
    objects: [pin],
  };
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({
    name: 'pin.olaser',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'openlaser-project', version: 1, project, assets: [] })),
  });
  await expect(page.getByTestId('object-row')).toHaveCount(1);
}

async function setNumber(page: Page, testid: string, value: string) {
  const input = page.getByTestId(testid);
  await input.click();
  await input.fill(value);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await prepare(page);
});

test('prices the design in Preview and saves it as a product', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openPin(page);
  await expect(page.getByTestId('pricing-panel')).toHaveCount(0);
  await page.getByTestId('view-preview').click();

  const panel = page.getByTestId('pricing-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('pricing-machine')).toHaveValue('omtech-k40-plus');
  await expect(page.getByTestId('pricing-bed-width')).toHaveValue('300.0');
  await expect(page.getByTestId('pricing-bed-height')).toHaveValue('200.0');
  await expect(page.getByTestId('pricing-machine-rate')).toHaveValue('2.50');

  // The piece is measured from the design: 38 × 30 mm fits 45 to a 300 × 200 mm sheet, turned.
  await expect(page.getByTestId('pricing-piece-width')).toHaveValue('38.0');
  await expect(page.getByTestId('pricing-piece-height')).toHaveValue('30.0');
  await expect(page.getByTestId('pricing-per-sheet')).toContainText('45 per sheet');
  await expect(page.getByTestId('pricing-per-sheet')).toContainText('9 × 5');
  await expect(page.getByTestId('pricing-layout').locator('rect.piece')).toHaveCount(45);

  // Cut time starts from the job estimate; switch to a manual 3 minutes.
  await expect(page.getByTestId('pricing-cut-minutes')).toBeDisabled();
  await page.getByTestId('pricing-from-job').click();
  await expect(page.getByTestId('pricing-cut-minutes')).toBeEnabled();
  await setNumber(page, 'pricing-cut-minutes', '3');
  await setNumber(page, 'pricing-pin-backs', '0.5');
  await setNumber(page, 'pricing-batch', '20');

  // Sheet $2 ÷ 45 + $0.50, 3 min at $2.50/h, (2 + 10/20) min at $20/h, × 2, 10% fees.
  await expect(page.getByTestId('pricing-cost')).toHaveText('$1.50');
  await expect(page.getByTestId('pricing-price')).toHaveText('$3.34');
  await expect(page.getByTestId('pricing-profit')).toHaveText('$1.50');
  await expect(page.getByTestId('pricing-batch-profit')).toHaveText('$30.06');
  await expect(page.getByTestId('pricing-hourly')).toHaveText('$25.48/h');

  await page.getByTestId('pricing-product-name').fill('W pin');
  await page.getByTestId('pricing-save-product').click();
  await expect(page.getByTestId('pricing-product')).toHaveValue(/.+/);

  await setNumber(page, 'pricing-markup', '3');
  await expect(page.getByTestId('pricing-price')).not.toHaveText('$3.34');
  await expect(panel).toContainText('Changed since “W pin” was saved.');
  await page.getByTestId('pricing-product').selectOption({ label: 'W pin' });
  await expect(page.getByTestId('pricing-markup')).toHaveValue('2.00');
  await expect(page.getByTestId('pricing-price')).toHaveText('$3.34');

  // A piece that does not fit says so instead of pricing.
  await page.getByTestId('pricing-from-design').click();
  await setNumber(page, 'pricing-piece-width', '320');
  await setNumber(page, 'pricing-piece-height', '250');
  await expect(page.getByTestId('pricing-problem')).toContainText('does not fit');

  // Presets and machines are remembered across visits.
  await page.waitForTimeout(500);
  await page.reload();
  // The autosaved project reopens.
  await expect(page.getByTestId('workspace')).toBeVisible();
  await page.getByTestId('view-preview').click();
  await expect(page.getByTestId('pricing-product').locator('option', { hasText: 'W pin' })).toHaveCount(1);
  expect(errors).toEqual([]);
});
