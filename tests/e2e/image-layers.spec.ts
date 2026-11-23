import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, dragOnCanvas, importFile, newProject, prepare } from './helpers';

test.beforeEach(async ({ page }) => prepare(page));

/** Picks images with the Image tool and returns the layer question. */
async function pick(page: Page, ...files: string[]) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('tool-image').click(),
  ]);
  await chooser.setFiles(files.map((f) => FIXTURES + f));
  const dialog = page.getByTestId('image-layer-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

const layerNames = (page: Page) => page.getByTestId('layer-name').allTextContents();

test('new layers are named Layer 1, Layer 2… whatever their kind', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.3, 0.3], [0.4, 0.4]);
  await importFile(page, 'logo.png');
  await expect.poll(() => layerNames(page)).toEqual(['Layer 1', 'Layer 2']);
  // The kind still shows in the line under the name.
  await expect(page.getByTestId('layer-row').nth(1)).toContainText('Image');
});

test('importing an image asks which layer it goes on', async ({ page }) => {
  await newProject(page);
  // A new layer, named in the dialog.
  let dialog = await pick(page, 'logo.png');
  await expect(dialog).toContainText('logo.png');
  await expect(dialog.getByTestId('image-layer-name')).toHaveValue('Layer 1');
  await dialog.getByTestId('image-layer-name').fill('Photos');
  await dialog.getByTestId('image-layer-confirm').click();
  await expect.poll(() => layerNames(page)).toEqual(['Photos']);

  // An existing layer, picked in the dialog.
  dialog = await pick(page, 'portrait.png');
  await expect(dialog.getByTestId('image-layer-new')).toBeChecked();
  await dialog.getByRole('radio', { name: /Photos/ }).check();
  await expect(dialog).toContainText('1 image');
  await dialog.getByTestId('image-layer-confirm').click();
  await expect(page.getByTestId('layer-row')).toHaveCount(1);
  await expect(page.getByTestId('object-row')).toHaveCount(2);

  // Cancel imports nothing.
  dialog = await pick(page, 'layered.png');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('object-row')).toHaveCount(2);
});

test('several images: a new layer for each, or one new layer for all', async ({ page }) => {
  await newProject(page);
  let dialog = await pick(page, 'logo.png', 'portrait.png');
  await expect(dialog).toContainText('2 images');
  await expect(dialog.getByTestId('image-layer-each')).toBeChecked();
  await dialog.getByTestId('image-layer-confirm').click();
  await expect.poll(() => layerNames(page)).toEqual(['Layer 1', 'Layer 2']);

  dialog = await pick(page, 'logo.png', 'layered.png');
  await dialog.getByTestId('image-layer-new').check();
  await dialog.getByTestId('image-layer-confirm').click();
  await expect.poll(() => layerNames(page)).toEqual(['Layer 1', 'Layer 2', 'Layer 3']);
  await expect(page.getByTestId('layer-row').nth(2).getByTestId('object-row')).toHaveCount(2);
});

test('a new image layer starts from the last image layer’s settings, then is its own', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  await page.getByTestId('layer-algorithm').selectOption('atkinson');
  await importFile(page, 'portrait.png');
  const layers = page.getByTestId('layer-row');
  await expect(layers).toHaveCount(2);
  await expect(page.getByTestId('layer-algorithm')).toHaveValue('atkinson');
  await page.getByTestId('layer-algorithm').selectOption('threshold');
  await layers.nth(0).getByTestId('object-row').click();
  await expect(page.getByTestId('layer-algorithm')).toHaveValue('atkinson');
});

test('an empty image layer you made is the suggested one', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('new-layer').click();
  await page.getByRole('menuitem', { name: 'Image layer' }).click();
  const dialog = await pick(page, 'logo.png');
  await expect(dialog.getByRole('radio', { name: /Layer 1/ })).toBeChecked();
  await expect(dialog).toContainText('empty');
  await dialog.getByTestId('image-layer-confirm').click();
  await expect(page.getByTestId('layer-row')).toHaveCount(1);
  await expect(page.getByTestId('object-row')).toHaveCount(1);
});

test('layers can be renamed with the pencil, a double-click or F2, and Escape cancels', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  const row = page.getByTestId('layer-row').first();
  const input = page.getByTestId('layer-name-input');

  await row.getByTestId('layer-rename').click();
  await expect(input).toBeFocused();
  await page.keyboard.type('Engrave photo');
  await page.keyboard.press('Enter');
  await expect(row.getByTestId('layer-name')).toHaveText('Engrave photo');

  await row.getByTestId('layer-name').dblclick();
  await page.keyboard.type('Something else');
  await page.keyboard.press('Escape');
  await expect(row.getByTestId('layer-name')).toHaveText('Engrave photo');

  await row.focus();
  await page.keyboard.press('F2');
  await expect(input).toBeFocused();
  await page.keyboard.type('Third name');
  await input.blur();
  await expect(row.getByTestId('layer-name')).toHaveText('Third name');

  // A rename is one undo step.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row.getByTestId('layer-name')).toHaveText('Engrave photo');
});
