import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { importFile, newProject, prepare } from './helpers';

test.beforeEach(async ({ page }) => prepare(page));

test('Bitmap mode shows the original beside the processed engraving; its settings are edited in Design', async ({
  page,
}) => {
  await newProject(page);
  await page.getByTestId('view-bitmap').click();
  await expect(page.getByTestId('bitmap-import')).toBeVisible();

  await page.getByTestId('view-design').click();
  await importFile(page, 'logo.png');
  await page.getByTestId('view-bitmap').click();

  const view = page.getByTestId('bitmap-view');
  await expect(view.getByRole('img', { name: /Original/ })).toBeVisible();
  const processed = page.getByTestId('bitmap-processed');
  await expect(processed).toBeVisible();
  await expect
    .poll(() => processed.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15_000 })
    .toBeGreaterThan(1);

  // Bitmap mode is for separating: no Engrave tab, and the original stays in view for picking.
  await expect(page.getByTestId('separate-panel')).toBeVisible();
  await expect(page.getByTestId('bitmap-tab-engrave')).toHaveCount(0);
  await expect(page.getByTestId('bitmap-compare-processed')).toHaveCount(0);
  await page.getByTestId('bitmap-compare-original').click();
  await expect(processed).toBeHidden();
  await expect(view.getByRole('img', { name: /Original/ })).toBeVisible();
  await page.getByTestId('bitmap-compare-split').click();

  // Dithering is a layer setting, changed in Design; Bitmap's preview follows it.
  await page.getByTestId('layer-engrave-open-design').click();
  await page.getByTestId('layer-algorithm').selectOption('atkinson');
  await page.getByTestId('view-bitmap').click();
  await expect(page.getByTestId('bitmap-processed')).toBeVisible();
  await page.getByTestId('bitmap-done').click();
  await expect(page.getByTestId('layer-algorithm')).toHaveValue('atkinson');
});

test('G-code export lives in the toolbar and the menu', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  await expect(page.getByTestId('export-gcode')).toHaveAttribute('aria-label', /Export G-code/);

  await page.getByTestId('app-menu').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('menu-export').click(),
  ]);
  expect(readFileSync(await download.path(), 'utf8').length).toBeGreaterThan(0);
});

/** Clicks the original at a point given as a share of the image's width and height. */
async function clickImage(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.getByTestId('bitmap-original');
  const box = (await canvas.boundingBox())!;
  const size = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
  const scale = Math.min(box.width / size.w, box.height / size.h);
  const left = box.x + (box.width - size.w * scale) / 2;
  const top = box.y + (box.height - size.h * scale) / 2;
  await page.mouse.click(left + x * size.w * scale, top + y * size.h * scale);
}

/** The preview pixel at a share of the image, as drawn (transparent areas show the checkerboard). */
function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  return page
    .getByTestId('bitmap-original')
    .evaluate(
      (c: HTMLCanvasElement, [px, py]) => [
        ...c.getContext('2d')!.getImageData(Math.floor(px * c.width), Math.floor(py * c.height), 1, 1).data,
      ],
      [x, y],
    );
}

test('Separate keys colors out of an image onto stacked layers', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'layered.png');
  await page.getByTestId('view-bitmap').click();
  await expect(page.getByTestId('separate-panel')).toBeVisible();
  await expect.poll(() => pixelAt(page, 0.02, 0.02)).toEqual([0, 200, 0, 255]);

  // The backdrop, shadow included, is found from the edges and erased to transparency.
  await page.getByTestId('separate-background').click();
  await expect(page.getByTestId('separate-keys').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByTestId('separate-share')).toContainText('% of the image selected');
  await page.getByTestId('separate-remove').click();
  await expect(page.getByText('Erased the selection.')).toBeVisible();
  await expect(page.getByTestId('layer-row')).toHaveCount(1);
  await expect(page.getByTestId('separate-keys')).toBeHidden();
  // Select background limited picks to the edge; applying it lets the next pick reach everywhere.
  await expect(page.getByRole('switch', { name: 'Connected areas only' })).not.toBeChecked();

  // The rest is cropped to the subjects: its corner is now the blue midground.
  await expect.poll(() => pixelAt(page, 0.02, 0.02)).toEqual([30, 40, 210, 255]);

  // The foreground: two separate red subjects, each its own object on a new layer.
  await clickImage(page, 0.2, 0.6);
  await page.getByText('One object per area').click();
  await page.getByTestId('separate-layer').click();
  await expect(page.getByText(/Moved 2 objects to/)).toBeVisible();
  await expect(page.getByTestId('layer-row')).toHaveCount(2);
  await expect(page.getByTestId('layer-row').nth(1).getByTestId('object-row')).toHaveCount(2);

  // Where the subjects were, the midground image is now transparent.
  await expect
    .poll(async () => {
      const [r, g, b] = await pixelAt(page, 0.2, 0.6);
      return r === g && g === b;
    })
    .toBe(true);

  // Undo puts the subjects back into the one image.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('layer-row')).toHaveCount(1);
});

test('Subtract picks carve colors out of the selection and undo with the picks', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'layered.png');
  await page.getByTestId('view-bitmap').click();
  await expect.poll(() => pixelAt(page, 0.02, 0.02)).toEqual([0, 200, 0, 255]);
  const share = page.getByTestId('separate-share');
  const percent = async () => Number((await share.textContent())!.match(/([\d.]+)%/)?.[1] ?? NaN);

  // The backdrop: green plus its shadow along the bottom.
  await page.getByTestId('separate-background').click();
  await expect(share).toContainText('% of the image selected');
  const all = await percent();

  // Alt-click the shadow: a subtract pick, shown with the minus cursor while Alt is held.
  const canvas = page.getByTestId('bitmap-original');
  await expect(canvas).toHaveAttribute('data-pick-mode', 'add');
  await page.keyboard.down('Alt');
  await clickImage(page, 0.5, 0.92);
  await expect(canvas).toHaveAttribute('data-pick-mode', 'subtract');
  await page.keyboard.up('Alt');
  await expect(page.locator('[data-testid="separate-keys"] li[data-mode="subtract"]')).toHaveCount(1);
  await expect.poll(percent).toBeLessThan(all);
  const minusShadow = await percent();
  // The shadow's pixels now show unselected.
  await expect.poll(() => pixelAt(page, 0.5, 0.92)).toEqual([0, 160, 0, 255]);

  // Undo and redo step through the picks before the project.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(percent).toBe(all);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(percent).toBe(minusShadow);

  // A pick can switch mode; with the switch on Subtract, a plain click subtracts and Shift adds.
  await page.getByTestId('separate-toggle-2').click();
  await expect.poll(percent).toBe(all);
  await page.getByTestId('separate-mode-subtract').click();
  await expect(canvas).toHaveAttribute('data-pick-mode', 'subtract');
  await expect(page.getByTestId('separate-matching-mode')).toContainText('subtract');
  await clickImage(page, 0.02, 0.02);
  await expect(page.locator('[data-testid="separate-keys"] li[data-mode="subtract"]')).toHaveCount(1);
  await page.keyboard.down('Shift');
  await clickImage(page, 0.5, 0.5);
  await page.keyboard.up('Shift');
  await expect(page.locator('[data-testid="separate-keys"] li[data-mode="add"]')).toHaveCount(4);

  // Clear removes both kinds, in one undoable step.
  await page.getByTestId('separate-clear').click();
  await expect(page.getByTestId('separate-keys')).toBeHidden();
  await expect(share).toHaveText('Nothing selected');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('separate-keys').getByRole('listitem')).toHaveCount(5);
});

test('Backdrop and highlight colors of the original can be changed and are remembered', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'layered.png');
  await page.getByTestId('view-bitmap').click();
  await expect.poll(() => pixelAt(page, 0.02, 0.02)).toEqual([0, 200, 0, 255]);
  await page.getByTestId('separate-background').click();

  // Rest hides the selected backdrop, so its corner shows the gray checkerboard boxes.
  await page.getByTestId('separate-show-rest').click();
  await expect
    .poll(async () => {
      const [r, g, b] = await pixelAt(page, 0.02, 0.02);
      return r === g && g === b && r > 150;
    })
    .toBe(true);

  // A preset recolors the boxes at once.
  await page.getByTestId('bitmap-colors').click();
  const menu = page.getByTestId('bitmap-colors-menu');
  await menu.getByRole('button', { name: 'Black' }).click();
  await expect.poll(() => pixelAt(page, 0.02, 0.02)).toEqual([0, 0, 0, 255]);
  await expect(menu.getByRole('button', { name: 'Black' })).toHaveAttribute('aria-pressed', 'true');

  // Each box can take its own color.
  await page.getByTestId('bitmap-backdrop-1').fill('#3366ff');
  await page.getByTestId('bitmap-backdrop-2').fill('#3366ff');
  await expect.poll(() => pixelAt(page, 0.02, 0.02)).toEqual([51, 102, 255, 255]);

  // The highlight tints the selection in the chosen color.
  await page.getByTestId('bitmap-highlight').fill('#00ff00');
  await page.keyboard.press('Escape');
  await page.getByTestId('separate-show-highlight').click();
  await expect
    .poll(async () => {
      const [r, g, b] = await pixelAt(page, 0.02, 0.02);
      return r === 0 && b === 0 && g > 220;
    })
    .toBe(true);

  // The choice is a view preference: it survives leaving Bitmap mode and resets in one click.
  await page.getByTestId('view-design').click();
  await page.getByTestId('view-bitmap').click();
  await page.getByTestId('bitmap-colors').click();
  await expect(page.getByTestId('bitmap-backdrop-1')).toHaveValue('#3366ff');
  await page.getByTestId('bitmap-colors-reset').click();
  await expect(page.getByTestId('bitmap-backdrop-1')).toHaveValue('#f5f5f5');
  await expect(page.getByTestId('bitmap-colors-reset')).toBeDisabled();
});

test('An image opens in Bitmap mode from Design, shows each setting once, and Done goes back', async ({
  page,
}) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  const view = page.getByTestId('bitmap-view');

  // Engraving settings are in Design, in the Layers panel.
  await expect(page.getByTestId('layer-algorithm')).toBeVisible();
  await expect(page.getByTestId('layer-dpi')).toBeVisible();
  await expect(page.getByTestId('layer-reset-tone')).toBeVisible();

  // Edit image in the image's settings opens Bitmap mode on Separate. The engraving settings stay
  // in Design: the Layers panel keeps the machine settings only, and points back.
  await page.getByTestId('edit-image').click();
  await expect(view).toBeVisible();
  await expect(page.getByTestId('separate-panel')).toBeVisible();
  await expect(page.getByTestId('bitmap-tab-engrave')).toHaveCount(0);
  await expect(page.getByTestId('layer-algorithm')).toHaveCount(0);
  await expect(page.getByTestId('layer-dpi')).toHaveCount(0);
  await expect(page.getByTestId('layer-reset-tone')).toHaveCount(0);
  await expect(page.getByTestId('layer-engrave-in-design')).toBeVisible();
  await expect(page.getByTestId('layer-power')).toBeVisible();

  // Done returns to Design with the image still selected.
  await page.getByTestId('bitmap-done').click();
  await expect(view).toBeHidden();
  await expect(page.getByTestId('layer-algorithm')).toBeVisible();
  await expect(page.getByTestId('edit-image')).toBeVisible();

  // Enter on the selected image.
  await page.getByTestId('bed-canvas').focus();
  await page.keyboard.press('Enter');
  await expect(view).toBeVisible();
  await page.getByTestId('bitmap-done').click();

  // Double-click the image on the bed (imports are centred on it).
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.keyboard.press('Escape');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(view).toBeVisible();
  await page.getByTestId('bitmap-done').click();

  // And from the right-click menu.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.getByTestId('menu-edit-image').click();
  await expect(view).toBeVisible();
});

test('Opening Bitmap from the tab selects the image it shows', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  await expect(page.getByTestId('edit-image')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-image')).toHaveCount(0);
  await page.getByTestId('view-bitmap').click();
  await expect(page.getByTestId('separate-panel')).toBeVisible();
  await page.getByTestId('bitmap-done').click();
  await expect(page.getByTestId('edit-image')).toBeVisible();
});

test('Bitmap shows where the image sits on the bed, and follows it when it moves', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  await page.getByTestId('edit-image').click();
  const map = page.getByTestId('bitmap-bed');
  await expect(map).toBeVisible();
  await expect(map.getByRole('img')).toHaveAttribute('aria-label', /Where logo\.png sits on the .* mm bed/);
  const marker = page.getByTestId('bitmap-bed-current');
  const before = await marker.getAttribute('points');

  // Move it 50 mm in Design, then come back.
  await page.getByTestId('bitmap-done').click();
  await page.getByTestId('bed-canvas').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Enter');
  await expect(marker).not.toHaveAttribute('points', before!);
});

test('An image on a shared layer can get its own settings in Design', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'layered.png');
  await page.getByTestId('view-bitmap').click();
  await expect.poll(() => pixelAt(page, 0.02, 0.02)).toEqual([0, 200, 0, 255]);
  // Two red subjects, each its own object, onto one new layer.
  await clickImage(page, 0.2, 0.6);
  await page.getByText('One object per area').click();
  await page.getByTestId('separate-layer').click();
  await expect(page.getByText(/Moved 2 objects to/)).toBeVisible();
  const layers = page.getByTestId('layer-row');
  await expect(layers).toHaveCount(2);

  await layers.nth(1).getByTestId('object-row').first().click();
  await page.getByTestId('bitmap-done').click();
  await expect(page.getByTestId('image-shared-layer')).toContainText('all 2 images');
  await page.getByTestId('image-own-layer').click();
  await expect(layers).toHaveCount(3);
  await expect(layers.nth(1).getByTestId('object-row')).toHaveCount(1);
  await expect(layers.nth(2).getByTestId('object-row')).toHaveCount(1);
  await expect(page.getByTestId('image-shared-layer')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(layers).toHaveCount(2);
});

test('Reset tone in Design puts the layer tone back to its defaults', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  const brightness = page.getByTestId('layer-brightness');
  await brightness.fill('40');
  await brightness.press('Enter');
  await expect(brightness).toHaveValue('40');
  await page.getByTestId('layer-reset-tone').click();
  await expect(brightness).toHaveValue('0');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(brightness).toHaveValue('40');
});
