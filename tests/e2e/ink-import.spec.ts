import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, confirmImageLayer, newProject, prepare } from './helpers';

test.beforeEach(async ({ page }) => prepare(page));

/** Width of the selection in mm. The ink is cropped to the drawing, so it is narrower than the photo. */
const width = async (page: Page) => Number(await page.getByTestId('sel-w').inputValue());

async function choose(page: Page, open: () => Promise<unknown>, file = 'sketch.jpg') {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), open()]);
  await chooser.setFiles(FIXTURES + file);
  await confirmImageLayer(page);
}

/** The photo's width when imported as it is (then removed again). */
async function photoWidth(page: Page): Promise<number> {
  await choose(page, () => page.getByTestId('tool-image').click());
  await page.getByTestId('object-row').click();
  await expect.poll(() => width(page)).toBeGreaterThan(0);
  const w = await width(page);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('object-row')).toHaveCount(0);
  return w;
}

test('Import a drawing brings a photographed sketch in, in ink only mode, and undo restores the photo', async ({
  page,
}) => {
  await newProject(page);
  const photo = await photoWidth(page);

  await choose(page, () => page.getByTestId('tool-import-drawing').click());
  await expect(page.getByTestId('object-row')).toHaveCount(1);
  await page.getByTestId('object-row').click();
  await expect.poll(() => width(page), { timeout: 15_000 }).toBeLessThan(photo * 0.9);

  // The clean-up is its own undo step after the import.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => width(page)).toBeCloseTo(photo, 1);
});

test('Import a drawing is in the menu and has a shortcut', async ({ page }) => {
  await newProject(page);
  const photo = await photoWidth(page);

  await page.getByTestId('app-menu').click();
  await choose(page, () => page.getByRole('menuitem', { name: /Import a drawing/ }).click());
  await page.getByTestId('object-row').click();
  await expect.poll(() => width(page), { timeout: 15_000 }).toBeLessThan(photo * 0.9);

  await choose(page, () => page.keyboard.press('ControlOrMeta+Alt+i'));
  await expect(page.getByTestId('object-row')).toHaveCount(2);
  await page.getByTestId('object-row').nth(1).click();
  await expect.poll(() => width(page), { timeout: 15_000 }).toBeLessThan(photo * 0.9);
});

/** Drags a fixture over the window and drops it at a point, as a file dragged from the desktop. */
async function dropFile(page: Page, file: string, type: string, at: () => Promise<{ x: number; y: number }>) {
  const bytes = readFileSync(FIXTURES + file).toString('base64');
  const transfer = await page.evaluateHandle(
    ([data, name, mime]) => {
      const transfer = new DataTransfer();
      const binary = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      transfer.items.add(new File([binary], name, { type: mime }));
      return transfer;
    },
    [bytes, file, type],
  );
  const fire = (kind: string, x = 0, y = 0) =>
    page.evaluate(
      ([dt, k, px, py]) =>
        document.dispatchEvent(
          new DragEvent(k as string, {
            dataTransfer: dt as DataTransfer,
            clientX: px as number,
            clientY: py as number,
            bubbles: true,
            cancelable: true,
          }),
        ),
      [transfer, kind, x, y] as const,
    );
  await fire('dragenter');
  const { x, y } = await at();
  await fire('dragover', x, y);
  await fire('drop', x, y);
  await confirmImageLayer(page);
}

const centre = async (page: Page, testid: string) => {
  const box = (await page.getByTestId(testid).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('Dropping a photo on "ink only mode" cleans it; dropping elsewhere imports it as it is', async ({
  page,
}) => {
  await newProject(page);

  // Anywhere but the ink target is a plain import.
  await dropFile(page, 'sketch.jpg', 'image/jpeg', async () => ({ x: 20, y: 20 }));
  await expect(page.getByTestId('drop-zone')).toBeHidden();
  await expect(page.getByTestId('object-row')).toHaveCount(1);
  await page.getByTestId('object-row').click();
  await expect.poll(() => width(page)).toBeGreaterThan(0);
  const photo = await width(page);

  await dropFile(page, 'sketch.jpg', 'image/jpeg', async () => {
    await expect(page.getByTestId('drop-drawing')).toBeVisible();
    return centre(page, 'drop-drawing');
  });
  await expect(page.getByTestId('object-row')).toHaveCount(2);
  await page.getByTestId('object-row').nth(1).click();
  await expect.poll(() => width(page), { timeout: 15_000 }).toBeLessThan(photo * 0.9);
});

test('Dragging an SVG offers no ink target: it is line art already', async ({ page }) => {
  await newProject(page);
  const bytes = readFileSync(FIXTURES + 'coaster.svg', 'utf8');
  await page.evaluate((svg) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([svg], 'coaster.svg', { type: 'image/svg+xml' }));
    document.dispatchEvent(
      new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, bytes);
  await expect(page.getByTestId('drop-zone')).toBeVisible();
  await expect(page.getByTestId('drop-drawing')).toHaveCount(0);
});
