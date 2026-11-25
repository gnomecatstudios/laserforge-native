import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { importFile, newProject, prepare } from './helpers';

test.beforeEach(async ({ page }) => prepare(page));

const SUMMARY = /\d+ colors? · [\d,]+ nodes/;

test('traces an image from the Edit image panel into vector layers and burns them', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  await expect(page.getByTestId('image-inspector')).toBeVisible();
  await page.getByTestId('edit-image').click();

  const panel = page.getByTestId('trace-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('trace-scope')).toHaveText('Tracing whole image');
  // A preset shows the live trace beside the original.
  await page.getByTestId('trace-preset-logo').click();
  await expect(page.getByTestId('bitmap-compare-trace')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('trace-status')).toHaveText(SUMMARY, { timeout: 15_000 });
  await page.getByTestId('trace-apply').click();

  // The trace is shown in Design, selected; the image is replaced by it.
  await expect(page.getByTestId('view-design')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('layer-row').filter({ hasText: 'Trace' }).first()).toBeVisible();
  await expect(page.getByTestId('image-inspector')).toBeHidden();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-gcode').click(),
  ]);
  const gcode = readFileSync(await download.path(), 'utf8');
  expect(gcode.split('\n').length).toBeGreaterThan(50);
});

test('line art traces to one cut layer and can keep the image', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  await expect(page.getByTestId('image-inspector')).toBeVisible();
  // Shift+T opens the image where it is traced.
  await page.keyboard.press('Shift+T');
  const panel = page.getByTestId('trace-panel');
  await page.getByTestId('trace-preset-lineart').click();
  await panel.getByRole('button', { name: 'Cut outlines' }).click();
  await panel.getByRole('switch', { name: 'Keep the image underneath' }).click();
  await expect(page.getByTestId('trace-status')).toHaveText(SUMMARY, { timeout: 15_000 });
  await page.getByTestId('trace-apply').click();
  await expect(page.getByTestId('layer-row').filter({ hasText: 'Trace' })).toHaveCount(1);
  await expect(page.getByTestId('layer-row').filter({ hasText: /Trace.*Line/s })).toHaveCount(1);
  await expect(page.getByTestId('status-bar')).toContainText('2 objects');
});

test('a photo trace lands on a few layers that stay when their objects go', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'portrait.png');
  await expect(page.getByTestId('image-inspector')).toBeVisible();
  await page.getByTestId('edit-image').click();
  await page.getByTestId('trace-preset-photo').click();
  await expect(page.getByTestId('trace-status')).toHaveText(/\d+ colors/, { timeout: 20_000 });
  await page.getByTestId('trace-apply').click();
  const rows = page.getByTestId('layer-row');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  expect(count).toBeLessThanOrEqual(10);

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('status-bar')).toContainText('0 objects');
  await expect(rows).toHaveCount(count);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('object-row')).toHaveCount(count);
});

test('the panel shows only the fields for the mode, with Advanced closed by default', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  await page.getByTestId('edit-image').click();
  const panel = page.getByTestId('trace-panel');
  const field = (name: string) => panel.getByLabel(name, { exact: true });

  await expect(page.getByTestId('trace-advanced')).toHaveAttribute('aria-expanded', 'false');
  await expect(field('Smoothness')).toHaveCount(0);

  await panel.getByRole('button', { name: 'B&W', exact: true }).click();
  await expect(panel.getByRole('switch', { name: 'Auto threshold' })).toBeVisible();
  await expect(field('Threshold')).toBeVisible();
  await expect(field('Colors')).toHaveCount(0);
  await expect(panel.getByRole('switch', { name: 'Drop background color' })).toHaveCount(0);
  await expect(panel.getByRole('switch', { name: 'Darker colors burn harder' })).toHaveCount(0);

  await panel.getByRole('button', { name: 'Color', exact: true }).click();
  await expect(field('Colors')).toBeVisible();
  await expect(field('Threshold')).toHaveCount(0);
  await expect(panel.getByRole('switch', { name: 'Auto threshold' })).toHaveCount(0);
  await expect(panel.getByRole('switch', { name: 'Darker colors burn harder' })).toBeVisible();

  await page.getByTestId('trace-advanced').click();
  for (const name of ['Smoothness', 'Corners', 'Ignore specks under', 'Denoise'])
    await expect(field(name)).toBeVisible();
  await expect(panel.getByRole('switch', { name: 'Stack layers (overlap burns twice)' })).toBeVisible();
  await panel.getByRole('button', { name: 'B&W', exact: true }).click();
  await expect(panel.getByRole('switch', { name: 'Stack layers (overlap burns twice)' })).toHaveCount(0);

  // The Trace button stays in view while the settings scroll.
  await panel.locator('.scroll').evaluate((el) => (el.scrollTop = 0));
  await expect(page.getByTestId('trace-apply')).toBeInViewport();
});

test('picked colors limit the trace to them', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'layered.png');
  await page.getByTestId('edit-image').click();
  await page.getByTestId('trace-preset-illustration').click();
  const status = page.getByTestId('trace-status');
  await expect(status).toHaveText(SUMMARY, { timeout: 15_000 });
  const whole = await status.textContent();

  await page.getByTestId('separate-background').click();
  await expect(page.getByTestId('trace-scope')).toHaveText('Tracing 2 picked colors');
  await expect(status).toHaveText(SUMMARY, { timeout: 15_000 });
  await expect(status).not.toHaveText(whole!);

  await page.getByRole('switch', { name: 'Invert' }).click();
  await expect(page.getByTestId('trace-scope')).toHaveText('Tracing everything except 2 picked colors');
  await expect(status).toHaveText(SUMMARY, { timeout: 15_000 });
  await page.getByTestId('trace-apply').click();
  await expect(page.getByTestId('view-design')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('layer-row').filter({ hasText: 'Trace' }).first()).toBeVisible();
});
