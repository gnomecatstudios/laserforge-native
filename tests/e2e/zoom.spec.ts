import { expect, test, type Page } from '@playwright/test';
import { dragOnCanvas, newProject, prepare } from './helpers';

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

test('a trackpad pinch zooms by the pinch scale around the fingers, not the page', async ({ page }) => {
  await newProject(page);
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  const x = Math.round(box.x + box.width * 0.3);
  const y = Math.round(box.y + box.height * 0.4);
  const cursor = async () => {
    await page.mouse.move(x + 1, y);
    await page.mouse.move(x, y);
    return page.getByText(/^Cursor /).textContent();
  };
  const anchor = await cursor();
  const start = await percent(page);
  // Chrome turns a real trackpad pinch into a stream of small Ctrl+wheel events.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizePinchGesture', { x, y, scaleFactor: 2, gestureSourceType: 'mouse' });
  expect((await percent(page)) / start).toBeCloseTo(2, 1);
  expect(await cursor()).toBe(anchor);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
});

test('editing nodes and moving objects keeps the zoom', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.4, 0.4], [0.6, 0.6]);
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomed = await percent(page);

  const n = (await page.getByTestId('path-node').first().boundingBox())!;
  await page.mouse.move(n.x + n.width / 2, n.y + n.height / 2);
  await page.mouse.down();
  await page.mouse.move(n.x + 20, n.y + 15, { steps: 5 });
  await page.mouse.up();
  expect(await percent(page), 'after dragging a node').toBe(zoomed);

  await page.keyboard.press('v');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ArrowRight');
  expect(await percent(page), 'after nudging').toBe(zoomed);
});
