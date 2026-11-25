import { expect, test, type Page } from '@playwright/test';
import { newProject, prepare, dragOnCanvas } from './helpers';
test.beforeEach(async ({ page }) => prepare(page));
test('draws a closed path, moves a node, undoes and unites shapes', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('tool-pen').click();
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  const at = (x: number, y: number) => page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await at(0.4, 0.4);
  await at(0.6, 0.4);
  await at(0.5, 0.6);
  await at(0.4, 0.4);
  await expect(page.getByTestId('path-node')).toHaveCount(3);
  const node = page.getByTestId('path-node').first();
  const before = await node.getAttribute('style');
  const n = (await node.boundingBox())!;
  await page.mouse.move(n.x + n.width / 2, n.y + n.height / 2);
  await page.mouse.down();
  await page.mouse.move(n.x + 30, n.y + 25);
  await page.mouse.up();
  await expect(node).not.toHaveAttribute('style', before!);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(node).toHaveAttribute('style', before!);
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.45, 0.45], [0.65, 0.65]);
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByTestId('tool-unite').click();
  await expect(page.getByTestId('status-bar')).toContainText('1 object');
  await expect(page.getByTestId('path-node').first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('status-bar')).toContainText('2 objects');
});
test('finishes open paths and cancels unfinished drawing', async ({ page }) => {
  await newProject(page);
  await page.keyboard.press('b');
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 200);
  await page.mouse.click(box.x + 300, box.y + 250);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('path-node')).toHaveCount(2);
  await page.keyboard.press('b');
  await page.mouse.click(box.x + 250, box.y + 300);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('status-bar')).toContainText('1 object');
});

test('double-clicking a vector opens its nodes', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.4, 0.4], [0.6, 0.6]);
  const box = (await page.getByTestId('bed-canvas').boundingBox())!;
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await expect(page.getByTestId('tool-node')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-node')).toHaveCount(4);
});

test('clicking a selected path inserts a movable node and supports undo', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.4, 0.4], [0.6, 0.6]);
  await page.getByTestId('tool-node').click();
  await expect(page.getByTestId('path-node')).toHaveCount(4);
  const first = (await page.getByTestId('path-node').nth(0).boundingBox())!;
  const second = (await page.getByTestId('path-node').nth(1).boundingBox())!;
  await page.mouse.click(
    (first.x + second.x) / 2 + first.width / 2,
    (first.y + second.y) / 2 + first.height / 2,
  );
  await expect(page.getByTestId('path-node')).toHaveCount(5);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('path-node')).toHaveCount(4);
});

test('selecting a node and pressing Delete removes only that node', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.4, 0.4], [0.6, 0.6]);
  await page.getByTestId('tool-node').click();
  await expect(page.getByTestId('path-node')).toHaveCount(4);
  await page.getByTestId('path-node').nth(1).click();
  await expect(page.getByTestId('path-node').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('path-node')).toHaveCount(3);
  await expect(page.getByTestId('status-bar')).toContainText('1 object');
  await page
    .getByTestId('path-node')
    .first()
    .click({ modifiers: ['Alt'] });
  await expect(page.getByTestId('path-node')).toHaveCount(2);
  await page
    .getByTestId('path-node')
    .first()
    .click({ modifiers: ['Alt'] });
  await expect(page.getByTestId('path-node')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('path-node')).toHaveCount(3);
});

test('Delete in the node tool never removes the whole object', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('tool-rect').click();
  await dragOnCanvas(page, [0.4, 0.4], [0.6, 0.6]);
  await page.getByTestId('tool-node').click();
  await page.getByTestId('path-node').nth(1).click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('path-node')).toHaveCount(3);
  await expect(page.getByTestId('status-bar')).toContainText('1 object');
  await page.getByTestId('path-node').nth(1).click();
  await page.keyboard.press('v');
  await page.getByTestId('tool-node').click();
  await expect(page.getByTestId('path-node').nth(1)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('path-node')).toHaveCount(3);
});

/** A closed seven-node path; finishing it leaves the node tool open on it. */
async function sevenNodes(page: Page) {
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
  ])
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await expect(page.getByTestId('path-node')).toHaveCount(7);
  return box;
}

const picked = (page: Page) => page.locator('[data-testid="path-node"][aria-pressed="true"]');

test('dragging a box picks several nodes and Delete removes them in one undo step', async ({ page }) => {
  const box = await sevenNodes(page);
  const at = (x: number, y: number) => [box.x + box.width * x, box.y + box.height * y] as const;
  // A box around the top row of three nodes, started on empty bed.
  await page.mouse.move(...at(0.25, 0.25));
  await page.mouse.down();
  await page.mouse.move(...at(0.4, 0.3), { steps: 4 });
  await page.mouse.move(...at(0.55, 0.35), { steps: 4 });
  await page.mouse.up();
  await expect(picked(page)).toHaveCount(3);
  // The path stays selected while its nodes are picked.
  await expect(page.getByTestId('status-bar')).toContainText('1 selected');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('path-node')).toHaveCount(4);
  await expect(page.getByTestId('status-bar')).toContainText('1 object');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('path-node')).toHaveCount(7);
});

test('Shift+click adds and removes picked nodes; a click on empty bed deselects', async ({ page }) => {
  const box = await sevenNodes(page);
  const nodes = page.getByTestId('path-node');
  await nodes.nth(1).click();
  await nodes.nth(3).click({ modifiers: ['Shift'] });
  await nodes.nth(5).click({ modifiers: ['Shift'] });
  await expect(picked(page)).toHaveCount(3);
  await nodes.nth(5).click({ modifiers: ['Shift'] });
  await expect(picked(page)).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(nodes).toHaveCount(5);
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await expect(page.getByTestId('status-bar')).not.toContainText('selected');
});
