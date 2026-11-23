import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { newProject, prepare, dragOnCanvas } from './helpers';
const TTF = readFileSync(
  new URL('../../packages/libopenlaser/test/fixtures/fonts/geist-latin-400-normal.ttf', import.meta.url),
);
test.beforeEach(async ({ page }) => {
  await prepare(page);
  await page.route('https://cdn.jsdelivr.net/fontsource/**', (r) =>
    r.fulfill({ body: TTF, contentType: 'font/ttf' }),
  );
  await page.route('https://fonts.googleapis.com/**', (r) =>
    r.fulfill({ body: '', contentType: 'text/css' }),
  );
  await newProject(page);
});
async function rectangles(page: Page) {
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.3, 0.3], [0.4, 0.4]);
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.45, 0.3], [0.55, 0.4]);
  await page.keyboard.press('ControlOrMeta+a');
}
async function rightClick(page: Page, x = 0.35, y = 0.35) {
  const b = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.mouse.click(b.x + b.width * x, b.y + b.height * y, { button: 'right' });
}
test('group entry, scoped selection, rename, escape and ungroup', async ({ page }) => {
  await rectangles(page);
  await page.keyboard.press('ControlOrMeta+g');
  await rightClick(page);
  await page.getByRole('menuitem', { name: 'Group', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Rename Group', exact: true }).click();
  await page.getByLabel('Group name').fill('Bookmark Set');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const b = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.mouse.dblclick(b.x + b.width * 0.35, b.y + b.height * 0.35);
  await expect(page.getByRole('navigation', { name: 'Group breadcrumbs' })).toContainText('Bookmark Set');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Group breadcrumbs' })).toHaveCount(0);
  await rightClick(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Shift+g');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+Shift+z');
});
test('arrangement preview, cancellation and apply keep an undoable design', async ({ page }) => {
  await rectangles(page);
  await rightClick(page);
  await page.getByRole('menuitem', { name: 'Arrange', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Auto Nest', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Auto Nest');
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(dialog).toContainText('2 placed');
  await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await rightClick(page);
  await page.getByRole('menuitem', { name: 'Arrange', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Smart Arrange', exact: true }).click();
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(dialog).toContainText('2 placed');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('status-bar')).toContainText('2 objects');
});
test('editable text modifiers, weld and undo render through the existing canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByTestId('tool-text').click();
  const b = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.3);
  await page.keyboard.type('Laser');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Loading font')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Warp', exact: true }).click();
  await expect(page.getByLabel('Warp preset')).toHaveValue('wave');
  await page.getByLabel('Warp preset').selectOption('bulge');
  await expect(page.getByLabel('Loading font')).toHaveCount(0);
  await page.getByRole('button', { name: 'Weld Letters', exact: true }).click();
  await expect(page.getByTestId('text-inspector')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('text-content')).toHaveValue('Laser');
  expect(errors).toEqual([]);
});

test('text subtraction uses font contours and undo restores editable text', async ({ page }) => {
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.28, 0.28], [0.5, 0.5]);
  await page.getByTestId('tool-text').click();
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.32, box.y + box.height * 0.32);
  await page.keyboard.type('O');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Loading font')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+a');
  await rightClick(page, 0.32, 0.32);
  await page.getByRole('menuitem', { name: 'Boolean', exact: true }).hover();
  await page.getByRole('menuitem', { name: /^Subtract/ }).click();
  await expect(page.getByTestId('status-bar')).toContainText('1 object');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('status-bar')).toContainText('2 objects');
  await page.keyboard.press('ControlOrMeta+a');
  await rightClick(page, 0.32, 0.32);
  await expect(page.getByRole('menuitem', { name: 'Modify Text', exact: true })).not.toHaveAttribute(
    'data-disabled',
  );
});
