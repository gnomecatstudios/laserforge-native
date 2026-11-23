import { expect, test, type Page } from '@playwright/test';
import { newProject, prepare, dragOnCanvas } from './helpers';
test.beforeEach(async ({ page }) => {
  await prepare(page);
  await newProject(page);
});
async function shapes(page: Page) {
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.3, 0.3], [0.5, 0.5]);
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.4, 0.4], [0.6, 0.6]);
  await page.keyboard.press('ControlOrMeta+a');
}
async function rightClick(page: Page, x = 0.45, y = 0.4) {
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y, { button: 'right' });
}
const menu = (page: Page) => page.locator('[data-canvas-menu]').first();
test('opens at the cursor, disables selection actions, dismisses outside and with Escape', async ({
  page,
}) => {
  await rightClick(page, 0.8, 0.8);
  await expect(menu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Cut', exact: false })).toHaveAttribute('data-disabled');
  await expect(page.getByRole('menuitem', { name: 'Boolean', exact: true })).toHaveAttribute('data-disabled');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await rightClick(page);
  await page.getByTestId('tool-select').click();
  await expect(menu(page)).toHaveCount(0);
});
test('right click preserves a selected group, selects an unselected object and clears on empty space', async ({
  page,
}) => {
  await shapes(page);
  await rightClick(page);
  await expect(page.getByRole('menuitem', { name: 'Boolean', exact: true })).not.toHaveAttribute(
    'data-disabled',
  );
  await page.keyboard.press('Escape');
  // The first Escape closes the menu; wait for it so the second one reaches the canvas.
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('status-bar')).not.toContainText('selected');
  await rightClick(page, 0.3, 0.35);
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: false })).not.toHaveAttribute(
    'data-disabled',
  );
  await expect(page.getByRole('menuitem', { name: 'Boolean', exact: true })).toHaveAttribute('data-disabled');
  await page.keyboard.press('Escape');
  await rightClick(page, 0.8, 0.8);
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: false })).toHaveAttribute('data-disabled');
});
for (const operation of ['Union', 'Subtract', 'Intersect', 'Exclude (XOR)']) {
  test(`${operation} via submenu with undo and redo`, async ({ page }) => {
    await shapes(page);
    await rightClick(page);
    await page.getByRole('menuitem', { name: 'Boolean', exact: true }).hover();
    // Union also sits at the top of the menu; pick the submenu's copy.
    await page
      .locator('[data-canvas-menu]')
      .last()
      .getByRole('menuitem', { name: operation, exact: false })
      .click();
    await expect(page.getByTestId('status-bar')).toContainText('1 object');
    await expect(menu(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('status-bar')).toContainText('2 objects');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.getByTestId('status-bar')).toContainText('1 object');
  });
}
test('keyboard navigation opens Boolean and returns focus without clearing selection', async ({ page }) => {
  await shapes(page);
  await rightClick(page);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /^Cut/ })).toBeFocused();
  await page.keyboard.press('Home');
  for (let i = 0; i < 10; i++) {
    if (
      await page
        .getByRole('menuitem', { name: 'Boolean', exact: true })
        .evaluate((el) => el === document.activeElement)
    )
      break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(page.getByRole('menuitem', { name: 'Boolean', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(
    page
      .locator('[data-canvas-menu]')
      .last()
      .getByRole('menuitem', { name: /^Union/ }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-bar')).toContainText('1 object');
});
for (const [key, label] of [
  ['U', 'Union'],
  ['D', 'Subtract'],
  ['I', 'Intersect'],
  ['X', 'Exclude (XOR)'],
]) {
  test(`${label} shortcut is registered and appears in help`, async ({ page }) => {
    await shapes(page);
    await page.keyboard.press(`ControlOrMeta+Shift+${key}`);
    await expect(page.getByTestId('status-bar')).toContainText('1 object');
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toContainText(label);
  });
}
test('copied canvas content can be pasted on empty space and menu stays within viewport', async ({
  page,
}) => {
  await shapes(page);
  await page.keyboard.press('ControlOrMeta+c');
  await rightClick(page, 0.99, 0.99);
  const box = (await menu(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await page.getByRole('menuitem', { name: /^Paste/ }).click();
  await expect(page.getByTestId('status-bar')).toContainText('4 objects');
});

test('Union, Simplify Path and Outline sit at the top of the right-click menu', async ({ page }) => {
  await shapes(page);
  await rightClick(page);
  await page.getByTestId('menu-union').click();
  await expect(page.getByTestId('status-bar')).toContainText('1 object');

  await rightClick(page);
  await page.getByTestId('menu-simplify').click();
  await expect(page.getByTestId('simplify-count')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('simplify-count')).toHaveCount(0);

  await rightClick(page);
  await page.getByTestId('menu-outline').click();
  await expect(page.getByTestId('outline-menu')).toBeVisible();
  await page.getByTestId('outline-apply').click();
  await expect(page.getByTestId('status-bar')).toContainText('2 objects');
});

test('the shortcut items are disabled with nothing selected', async ({ page }) => {
  await rightClick(page, 0.8, 0.8);
  for (const id of ['menu-union', 'menu-simplify', 'menu-outline'])
    await expect(page.getByTestId(id)).toHaveAttribute('data-disabled');
});
