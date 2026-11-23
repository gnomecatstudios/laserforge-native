import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { deserializeProject } from '../../packages/libopenlaser/src/project/serialize';
import { createProject, defaultLayer } from '../../packages/libopenlaser/src/project';
import type { SceneObject, TextObject, VectorObject } from '../../packages/libopenlaser/src/project';
import { importFile, newProject, prepare } from './helpers';

const TTF = readFileSync(
  new URL('../../packages/libopenlaser/test/fixtures/fonts/geist-latin-400-normal.ttf', import.meta.url),
);
function box(id: string, x: number, y: number, w = 10): VectorObject {
  return {
    id,
    kind: 'vector',
    name: `Box ${id}`,
    layerId: 'l',
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, x, y],
    paths: [
      {
        start: { x: 0, y: 0 },
        closed: true,
        segments: [
          { type: 'L', to: { x: w, y: 0 } },
          { type: 'L', to: { x: w, y: 10 } },
          { type: 'L', to: { x: 0, y: 10 } },
        ],
      },
    ],
  };
}
const text: TextObject = {
  id: 't',
  kind: 'text',
  name: 'Letter O',
  text: 'O',
  layerId: 'l',
  visible: true,
  locked: false,
  transform: [1, 0, 0, 1, 50, 50],
  fontFamily: 'Geist',
  fontWeight: 400,
  italic: false,
  fontSize: 10,
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  outlineVersion: 4,
  paths: [box('outer', 0, 0).paths[0], box('inner', 0, 0, 4).paths[0]],
};
async function openObjects(page: Page, objects: SceneObject[]) {
  await newProject(page);
  const project = {
    ...createProject({ name: 'Layout QA' }),
    layers: [defaultLayer({ id: 'l', mode: 'line' })],
    objects,
  };
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({
    name: 'layout.olaser',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'openlaser-project', version: 1, project, assets: [] })),
  });
  await expect(page.getByTestId('object-row')).toHaveCount(objects.length);
}
async function select(page: Page, name: string, shift = false) {
  await page
    .getByTestId('object-row')
    .filter({ hasText: name })
    .click({ modifiers: shift ? ['Shift'] : [] });
}
async function saved(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByTestId('app-menu').click();
  await page.getByRole('menuitem', { name: /Save as/ }).click();
  const file = await download;
  return deserializeProject(new Uint8Array(readFileSync((await file.path())!)));
}

test.beforeEach(async ({ page }) => {
  await prepare(page);
  await page.route('https://cdn.jsdelivr.net/fontsource/**', (route) =>
    route.fulfill({ body: TTF, contentType: 'font/ttf' }),
  );
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ body: '', contentType: 'text/css' }),
  );
});

test('aligns to the last selected object and bed, with undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openObjects(page, [box('A', 10, 20), box('B', 50, 40, 20)]);
  await select(page, 'Box A');
  await select(page, 'Box B', true);
  await page.getByLabel('Align to', { exact: true }).selectOption('last');
  await page.getByRole('button', { name: 'Align Left', exact: true }).click();
  let project = await saved(page);
  expect(project.objects.map((o) => o.transform[4])).toEqual([50, 50]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  project = await saved(page);
  expect(project.objects.map((o) => o.transform[4])).toEqual([10, 50]);
  await page.getByLabel('Align to', { exact: true }).selectOption('bed');
  await page.getByRole('button', { name: 'Align Left', exact: true }).click();
  expect((await saved(page)).objects.map((o) => o.transform[4])).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test('distributes centres and unequal edge gaps', async ({ page }) => {
  await openObjects(page, [box('A', 0, 20, 20), box('B', 25, 20), box('C', 90, 20, 30)]);
  await select(page, 'Box A');
  await select(page, 'Box B', true);
  await select(page, 'Box C', true);
  await page.getByRole('button', { name: 'Space centres X', exact: true }).click();
  expect((await saved(page)).objects[1].transform[4]).toBeCloseTo(52.5);
  await page.getByRole('button', { name: 'Equal gaps X', exact: true }).click();
  expect((await saved(page)).objects[1].transform[4]).toBeCloseTo(50);
});

test('previews and cancels arrays without saving copies; commits and undoes a grid', async ({ page }) => {
  await openObjects(page, [box('A', 100, 100)]);
  await select(page, 'Box A');
  await page.getByLabel('Array type').selectOption('grid');
  await page.getByLabel('Columns', { exact: true }).fill('3');
  await page.getByLabel('Columns', { exact: true }).press('Enter');
  expect((await saved(page)).objects).toHaveLength(1);
  await page.getByRole('button', { name: 'Cancel array' }).click();
  await expect(page.getByTestId('object-row')).toHaveCount(1);
  await page.getByLabel('Array type').selectOption('grid');
  await page.getByRole('button', { name: 'Create array' }).click();
  await expect(page.getByTestId('object-row')).toHaveCount(6);
  const project = await saved(page);
  expect(new Set(project.objects.map((o) => o.id)).size).toBe(6);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('object-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByTestId('object-row')).toHaveCount(6);
});

test('creates a partial circular array with rotated copies', async ({ page }) => {
  await openObjects(page, [box('A', 100, 100)]);
  await select(page, 'Box A');
  await page.getByLabel('Array type').selectOption('circle');
  for (const [label, value] of [
    ['Count', '3'],
    ['Sweep', '180'],
    ['Centre X', '105'],
    ['Centre Y', '80'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Enter');
  }
  await page.getByLabel('Rotate copies').check();
  await page.getByRole('button', { name: 'Create array' }).click();
  const project = await saved(page);
  expect(project.objects).toHaveLength(3);
  expect(project.objects[1].transform[1]).toBeCloseTo(1);
  expect(project.objects[2].transform[0]).toBeCloseTo(-1);
});

test('converts text to editable nodes and undo restores text', async ({ page }) => {
  await openObjects(page, [text]);
  await select(page, 'Letter O');
  await page.getByTestId('text-to-paths').click();
  await expect(page.getByTestId('tool-node')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-node').first()).toBeVisible();
  const converted = (await saved(page)).objects[0];
  expect(converted).toMatchObject({ kind: 'vector', transform: text.transform, paths: text.paths });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('text-inspector')).toBeVisible();
  await expect(page.getByTestId('text-content')).toHaveValue('O');
});

test('attaches editable text to a curve, offsets it, persists it, and detaches with undo', async ({
  page,
}) => {
  const guide: VectorObject = {
    ...box('Guide', 50, 50),
    paths: [
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [{ type: 'C', c1: { x: 20, y: 30 }, c2: { x: 60, y: 30 }, to: { x: 80, y: 0 } }],
      },
    ],
  };
  await openObjects(page, [{ ...text, text: 'Laser', name: 'Laser' }, guide]);
  await select(page, 'Laser');
  await select(page, 'Box Guide', true);
  await page.getByRole('button', { name: 'Text on selected path' }).click();
  await expect(page.getByLabel('Path offset', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Loading font')).toHaveCount(0);
  await page.getByLabel('Path offset', { exact: true }).fill('10');
  await page.getByLabel('Path offset', { exact: true }).press('Enter');
  await expect(page.getByLabel('Loading font')).toHaveCount(0);
  let project = await saved(page);
  expect(project.objects[0]).toMatchObject({ kind: 'text', text: 'Laser', pathLayout: { offset: 10 } });
  expect(project.objects[1]).toEqual(guide);
  await page.getByTestId('text-content').fill('Badge');
  await page.getByTestId('text-size').click();
  await expect(page.getByLabel('Loading font')).toHaveCount(0);
  project = await saved(page);
  expect(project.objects[0]).toMatchObject({ kind: 'text', text: 'Badge', pathLayout: { offset: 10 } });
  const beforeGuideEdit = project.objects[0] as TextObject;
  await select(page, 'Box Guide');
  await page.getByTestId('sel-x').fill('70');
  await page.getByTestId('sel-x').press('Enter');
  await select(page, 'Badge');
  await expect(page.getByLabel('Loading font')).toHaveCount(0);
  const followed = (await saved(page)).objects[0] as TextObject;
  expect(followed.pathLayout!.guideId).toBe(guide.id);
  expect(followed.pathLayout!.path.start.x).toBeCloseTo(beforeGuideEdit.pathLayout!.path.start.x + 20);
  expect(followed.paths.length).toBeGreaterThan(0);
  expect(followed.paths).not.toEqual(beforeGuideEdit.paths);
  await page.getByRole('button', { name: 'Detach text from path' }).click();
  await expect(page.getByLabel('Path offset', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Path offset', { exact: true })).toHaveValue('10.00');
  await page.getByTestId('text-size').scrollIntoViewIfNeeded();
  if (process.env.LASERFORGE_QA_SCREENSHOT) {
    await page.screenshot({ path: process.env.LASERFORGE_QA_SCREENSHOT });
  }
});

test('arc slider bends editable text in both directions, persists and undoes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openObjects(page, [{ ...text, text: 'LASER FORGE', name: 'Arc lettering' }]);
  await select(page, 'Arc lettering');
  const arc = page.getByTestId('text-arc-angle');
  await expect(arc).toHaveValue('0');
  async function bend(value: string) {
    await arc.evaluate((input: HTMLInputElement, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await expect(page.getByLabel('Loading font')).toHaveCount(0);
  }
  await bend('90');
  const up = (await saved(page)).objects[0] as TextObject;
  expect(up).toMatchObject({ kind: 'text', arcAngle: 90, text: 'LASER FORGE' });
  expect(up.paths.length).toBeGreaterThan(0);
  await bend('-90');
  const down = (await saved(page)).objects[0] as TextObject;
  expect(down.arcAngle).toBe(-90);
  expect(down.paths).not.toEqual(up.paths);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(arc).toHaveValue('90');
  await page.getByTestId('text-content').fill('Editable arc');
  await expect(arc).toHaveValue('90');
  await expect(page.getByLabel('Loading font')).toHaveCount(0);
  await arc.scrollIntoViewIfNeeded();
  if (process.env.LASERFORGE_QA_SCREENSHOT) {
    await page.screenshot({ path: process.env.LASERFORGE_QA_SCREENSHOT });
  }
  expect(errors).toEqual([]);
});

test('rotates imported images with the angle field and saves their transform', async ({ page }) => {
  await newProject(page);
  await importFile(page, 'logo.png');
  const angle = page.getByTestId('sel-angle');
  await expect(angle).toBeEnabled();
  await angle.fill('30');
  await angle.press('Enter');
  const object = (await saved(page)).objects[0];
  expect(object.kind).toBe('image');
  expect((Math.atan2(object.transform[1], object.transform[0]) * 180) / Math.PI).toBeCloseTo(30);
});

test('simplifies Bézier nodes in the existing preview and undo workflow', async ({ page }) => {
  const curve: VectorObject = {
    ...box('Curve', 50, 50),
    paths: [
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [
          { type: 'C', c1: { x: 0, y: 4 }, c2: { x: 2, y: 6 }, to: { x: 4, y: 6 } },
          { type: 'C', c1: { x: 6, y: 6 }, c2: { x: 8, y: 4 }, to: { x: 8, y: 0 } },
        ],
      },
    ],
  };
  await openObjects(page, [curve]);
  await select(page, 'Box Curve');
  await page.getByTestId('tool-simplify').click();
  await expect(page.getByTestId('simplify-count')).toContainText('3 → 2');
  await page.getByRole('button', { name: 'Apply simplification' }).click();
  expect(((await saved(page)).objects[0] as VectorObject).paths[0].segments).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(((await saved(page)).objects[0] as VectorObject).paths).toEqual(curve.paths);
});
