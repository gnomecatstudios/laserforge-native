import { expect, test } from '@playwright/test';
import { dragOnCanvas, newProject, prepare } from './helpers';

test('previews closed-path simplification, cancels, applies and undoes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page);
  await newProject(page);
  await page.getByTestId('tool-pen').click();
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  for (const [x, y] of [
    [0.3, 0.3],
    [0.4, 0.3],
    [0.5, 0.3],
    [0.5, 0.4],
    [0.5, 0.5],
    [0.4, 0.5],
    [0.3, 0.5],
    [0.3, 0.3],
  ]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await expect(page.getByTestId('path-node')).toHaveCount(7);
  await page.getByTestId('tool-simplify').click();
  await expect(page.getByRole('img', { name: 'Path simplification preview' })).toBeVisible();
  await expect(page.getByTestId('simplify-count')).toContainText('7 → 4');
  await page.screenshot({ path: '/tmp/laserforge-simplify-preview.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('path-node')).toHaveCount(7);
  await page.getByTestId('tool-simplify').click();
  await page.getByRole('button', { name: 'Apply simplification' }).click();
  await expect(page.getByTestId('path-node')).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('path-node')).toHaveCount(7);
  expect(errors).toEqual([]);
});

test('simplifies image outlines through tracing and keeps the original for undo', async ({ page }) => {
  const { importFile } = await import('./helpers');
  await prepare(page);
  await newProject(page);
  await importFile(page, 'logo.png');
  await expect(page.getByTestId('image-inspector')).toBeVisible();
  await page.getByTestId('tool-simplify').click();
  const dialog = page.getByTestId('trace-dialog');
  await expect(dialog).toContainText('Simplify image paths');
  await expect(page.getByTestId('image-simplify-help')).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'Keep the image underneath' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('trace-apply')).toBeEnabled({ timeout: 20000 });
  await page.screenshot({ path: '/tmp/laserforge-image-simplify.png' });
  await page.getByTestId('trace-apply').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('status-bar')).toContainText('2 objects');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('status-bar')).toContainText('1 object');
});

test('Escape closes the Simplify Path popover', async ({ page }) => {
  await prepare(page);
  await newProject(page);
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.4, 0.4], [0.55, 0.55]);
  await page.getByTestId('tool-simplify').click();
  await expect(page.getByTestId('simplify-count')).toBeVisible();
  await page.locator('#simplify-tolerance').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('simplify-count')).toHaveCount(0);

  // Also from the toolbar button, and the first Escape only closes the panel.
  await page.getByTestId('tool-simplify').click();
  await expect(page.getByTestId('simplify-count')).toBeVisible();
  await page.getByTestId('tool-simplify').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('simplify-count')).toHaveCount(0);
  await expect(page.getByTestId('tool-simplify')).toBeEnabled();
});
