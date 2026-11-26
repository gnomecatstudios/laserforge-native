import { expect, test, type Page } from '@playwright/test';
import { newProject, prepare } from './helpers';

test.beforeEach(async ({ page }) => prepare(page));

const percent = async (page: Page) =>
  Number((await page.getByTestId('zoom-percent').textContent())!.replace('%', ''));

test('Ctrl+=, Ctrl++ and the numpad plus all zoom the bed in', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('bed-canvas').click({ position: { x: 5, y: 5 } });
  for (const keys of ['Control+Equal', 'Control+Shift+Equal', 'Control+NumpadAdd']) {
    const before = await percent(page);
    await page.keyboard.press(keys);
    expect(await percent(page), keys).toBeGreaterThan(before);
  }
});

test('a mouse wheel notch zooms the same with or without Ctrl', async ({ page }) => {
  await newProject(page);
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const start = await percent(page);
  await page.mouse.wheel(0, -100);
  const plain = await percent(page);
  await page.mouse.wheel(0, 100);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  expect(plain).toBeGreaterThan(start);
  expect(Math.abs((await percent(page)) - plain)).toBeLessThanOrEqual(1);
});
