import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** Skips the tour and forces the file-input fallback so tests can drive file choosers. */
export async function prepare(page: Page, options: { tour?: boolean } = {}): Promise<void> {
  await page.addInitScript((showTour) => {
    if (!showTour) localStorage.setItem('openlaser.tour.v1', 'done');
    // Remove the File System Access API so tests drive the file-input and download fallbacks.
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  }, options.tour ?? false);
}

export async function newProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('workspace')).toBeVisible();
}

export async function importFile(page: Page, file: string): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('tool-image').click(),
  ]);
  await chooser.setFiles(FIXTURES + file);
  if (/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file)) await confirmImageLayer(page);
}

/** Answers "Choose a layer" for imported images with what it suggests (a new layer). */
export async function confirmImageLayer(page: Page): Promise<void> {
  const dialog = page.getByTestId('image-layer-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('image-layer-confirm').click();
  await expect(dialog).toBeHidden();
}

/** Drags on the bed canvas between two points given as fractions of its size. */
export async function dragOnCanvas(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
  await page.mouse.up();
}

export async function connectVirtual(page: Page): Promise<void> {
  await openMachine(page);
  await page.getByTestId('connect-virtual').click();
  await expect(page.getByTestId('machine-state')).toHaveText(/ALARM|IDLE/i, { timeout: 15_000 });
  if (/alarm/i.test((await page.getByTestId('machine-state').textContent()) ?? '')) {
    await page.getByTestId('unlock').click();
  }
  await expect(page.getByTestId('machine-state')).toHaveText(/IDLE/i, { timeout: 10_000 });
}

/** Opens the Machine dropdown in the top bar, if it is not open already. */
export async function openMachine(page: Page): Promise<void> {
  const trigger = page.getByTestId('machine-menu');
  if ((await trigger.getAttribute('data-state')) !== 'open') await trigger.click();
  await expect(page.getByTestId('machine-panel')).toBeVisible();
}

/** Unfolds the console at the bottom of the side panel, if it is folded. */
export async function openConsole(page: Page): Promise<void> {
  const toggle = page.getByTestId('console-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByTestId('console-input')).toBeVisible();
}

/** Closes the Machine dropdown so it no longer covers the bed. */
export async function closeMachine(page: Page): Promise<void> {
  await page.getByTestId('machine-close').click();
  await expect(page.getByTestId('machine-panel')).toHaveCount(0);
}

/** The machine menu drops over the toolbar; close it before reaching for a toolbar button. */
export async function closeMachineMenu(page: Page): Promise<void> {
  const trigger = page.getByTestId('machine-menu');
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await trigger.click();
}
