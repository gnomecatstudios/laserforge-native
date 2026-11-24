import { expect, test, type Page } from '@playwright/test';
import { connectVirtual, newProject, openConsole, prepare } from './helpers';

const repo = 'https://github.com/gnomecatstudios/laserforge-native/releases';
const api = 'https://api.github.com/repos/gnomecatstudios/laserforge-native/releases/latest';
function release(version = '3.1.0') {
  return {
    tag_name: `v${version}`,
    html_url: `${repo}/tag/v${version}`,
    draft: false,
    prerelease: false,
    assets: ['linux-x64', 'windows-x64', 'raspberry-pi-arm64', 'raspberry-pi-arm32'].map((p) => ({
      name: `LaserForge-Portable-${p}.zip`,
      state: 'uploaded',
      size: 100,
      browser_download_url: `${repo}/download/v${version}/LaserForge-Portable-${p}.zip`,
    })),
  };
}
async function portable(page: Page, platform = 'linux-x64') {
  await page.route('**/portable-platform.json', (r) => r.fulfill({ json: { platform, version: '3.0.0' } }));
}

test.beforeEach(async ({ page }) => {
  await prepare(page);
  await page.route(api, (r) => r.fulfill({ json: release() }));
});

test('portable startup offers the exact platform, Later closes, About can reopen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await portable(page, 'raspberry-pi-arm64');
  await page.goto('/');
  await expect(page).toHaveTitle(/Laser Forge/);
  const popup = page.getByTestId('update-dialog');
  await expect(popup).toContainText('Update available');
  await expect(popup.getByLabel('Your platform')).toHaveValue('raspberry-pi-arm64');
  await expect(popup.getByRole('link', { name: 'Download update', exact: true })).toHaveAttribute(
    'href',
    `${repo}/download/v3.1.0/LaserForge-Portable-raspberry-pi-arm64.zip`,
  );
  await popup.getByRole('button', { name: 'Later' }).click();
  await expect(popup).toBeHidden();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'About', exact: true })
    .click();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(popup).toContainText('Update available');
  await popup.getByLabel('Your platform').selectOption('windows-x64');
  await expect(popup.getByRole('link', { name: 'Download update', exact: true })).toHaveAttribute(
    'href',
    /windows-x64.zip$/,
  );
  await page.context().route('**/releases/download/v3.1.0/LaserForge-Portable-windows-x64.zip', (r) =>
    r.fulfill({
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="LaserForge-Portable-windows-x64.zip"',
      },
      body: Buffer.from('PK\x05\x06' + '\0'.repeat(18), 'binary'),
    }),
  );
  const downloaded = page.waitForEvent('download');
  await popup.getByRole('link', { name: 'Download update', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('LaserForge-Portable-windows-x64.zip');
  await expect(page).toHaveURL(/#\/about$/);
  expect(errors).toEqual([]);
});

test('current version has no automatic popup; manual check confirms it', async ({ page }) => {
  await portable(page);
  await page.route(api, (r) => r.fulfill({ json: release('3.0.0') }));
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'About', exact: true })
    .click();
  await expect(page.getByTestId('update-dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.getByTestId('update-dialog')).toContainText('You’re up to date');
});

test('offline checks stay quiet automatically and allow a manual retry', async ({ page }) => {
  await portable(page);
  await page.route(api, (r) => r.fulfill({ status: 503 }));
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'About', exact: true })
    .click();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  const popup = page.getByTestId('update-dialog');
  await expect(popup).toContainText('Could not check for updates');
  await expect(popup.getByRole('link', { name: 'Download update', exact: true })).toHaveCount(0);
  await page.route(api, (r) => r.fulfill({ json: release() }));
  await popup.getByRole('button', { name: 'Try again' }).click();
  await expect(popup).toContainText('Update available');
});

test('pending automatic notification never covers connected machine controls', async ({ page }) => {
  await portable(page);
  let deliver: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  await page.route(api, async (r) => {
    await gate;
    await r.fulfill({ json: release() });
  });
  await newProject(page);
  await connectVirtual(page);
  await openConsole(page);
  deliver!();
  await page.getByTestId('console-input').fill('$J=G91 G21 X300 F600');
  await page.getByTestId('console-input').press('Enter');
  await expect(page.getByTestId('machine-state')).toHaveText(/JOG/i);
  await expect(page.getByTestId('update-dialog')).toBeHidden();
  await page.getByTestId('app-menu').click();
  await page.getByRole('menuitem', { name: 'Check for updates' }).click();
  await expect(page.getByText('The laser is busy. Update once the job finishes.')).toBeVisible();
  await expect(page.getByTestId('update-dialog')).toBeHidden();
  await expect(page.getByTestId('stop')).toBeEnabled();
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('machine-state')).toHaveText(/IDLE/i);
  // The automatic check stays quiet while connected; a manual check works once the laser is idle.
  await expect(page.getByTestId('update-dialog')).toBeHidden();
  await page.getByTestId('app-menu').click();
  await page.getByRole('menuitem', { name: 'Check for updates' }).click();
  await expect(page.getByTestId('update-dialog')).toContainText('Update available');
});

test('native launcher checks for updates while GitHub rate-limits its API', async ({ page }) => {
  await portable(page, 'windows-x64');
  let apiChecks = 0;
  await page.route(api, (r) => {
    apiChecks++;
    return r.fulfill({ status: 403, json: { message: 'API rate limit exceeded' } });
  });
  let latest: string | null = '3.1.0';
  await page.route('**/api/portable-update**', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { token: 't', status: 'idle' } });
    expect(new URL(r.request().url()).searchParams.get('action')).toBe('check');
    expect(r.request().headers()['x-laserforge-update']).toBe('t');
    return latest ? r.fulfill({ json: { version: latest } }) : r.fulfill({ status: 502, body: 'offline' });
  });
  await page.goto('/');
  const popup = page.getByTestId('update-dialog');
  await expect(popup).toContainText('Laser Forge 3.1.0 is ready to download.');
  await expect(popup.getByRole('button', { name: 'Download update' })).toBeEnabled();
  await expect(popup.getByRole('link', { name: 'Release notes and installation instructions' })).toHaveAttribute(
    'href',
    `${repo}/tag/v3.1.0`,
  );
  await popup.getByRole('button', { name: 'Later' }).click();
  latest = null;
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'About', exact: true })
    .click();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(popup).toContainText('Could not check for updates');
  expect(apiChecks).toBe(0);
});

test('installing disconnects an idle laser automatically', async ({ page }) => {
  await portable(page);
  const posts: string[] = [];
  await page.route('**/api/portable-update**', async (r) => {
    if (r.request().method() === 'POST') {
      const action = new URL(r.request().url()).searchParams.get('action') ?? '';
      if (action === 'check') return r.fulfill({ json: { version: '3.1.0' } });
      posts.push(action);
      await r.fulfill({ status: 200, body: 'ok' });
    } else {
      await r.fulfill({ json: { token: 't', status: 'ready', version: '3.1.0' } });
    }
  });
  page.on('dialog', (d) => {
    expect(d.message()).toContain('idle laser will be disconnected');
    void d.accept();
  });
  await page.goto('/');
  await page.getByTestId('update-dialog').getByRole('button', { name: 'Later' }).click();
  await page.getByTestId('new-project').click();
  await connectVirtual(page);
  await page.getByTestId('app-menu').click();
  await page.getByRole('menuitem', { name: 'Check for updates' }).click();
  const popup = page.getByTestId('update-dialog');
  await popup.getByRole('button', { name: 'Install and restart' }).click();
  await expect.poll(() => posts).toEqual(['install']);
  await expect(page.getByTestId('machine-state')).toHaveText(/OFFLINE/i);
});

test('mobile dialog fits and unknown platforms require an explicit selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/portable-platform.json', (r) => r.fulfill({ status: 404 }));
  await page.goto('/#/about');
  await page.getByRole('button', { name: 'Check for updates' }).click();
  const popup = page.getByTestId('update-dialog');
  await expect(popup).toContainText('Update available');
  await expect(popup.getByRole('link', { name: 'Download update', exact: true })).toHaveCount(0);
  await popup.getByLabel('Your platform').selectOption('linux-x64');
  await expect(popup.getByRole('link', { name: 'Download update', exact: true })).toHaveAttribute(
    'href',
    /linux-x64.zip$/,
  );
  const box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('Ctrl+Alt+U and Ctrl+U check for updates from anywhere', async ({ page }) => {
  await portable(page);
  await page.route(api, (r) => r.fulfill({ json: release('3.0.0') }));
  await newProject(page);
  await expect(page.getByTestId('update-dialog')).toBeHidden();
  await page.keyboard.press('Control+Alt+u');
  await expect(page.getByTestId('update-dialog')).toContainText('You’re up to date');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('update-dialog')).toBeHidden();
  await page.keyboard.press('Control+u');
  await expect(page.getByTestId('update-dialog')).toContainText('You’re up to date');
});
