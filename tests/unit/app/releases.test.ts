import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOWNLOAD_REPO,
  fetchRelease,
  isNewer,
  isPlatform,
  parseRelease,
  PLATFORMS,
} from '$app/updates/releases';

function release() {
  const base = `https://github.com/${DOWNLOAD_REPO}/releases`;
  return {
    tag_name: 'v0.3.0',
    html_url: `${base}/tag/v0.3.0`,
    draft: false,
    prerelease: false,
    assets: Object.keys(PLATFORMS).map((platform) => ({
      name: `LaserForge-Portable-${platform}.zip`,
      state: 'uploaded',
      size: 100,
      browser_download_url: `${base}/download/v0.3.0/LaserForge-Portable-${platform}.zip`,
    })),
  };
}

afterEach(() => vi.unstubAllGlobals());
describe('portable releases', () => {
  it.each([
    ['0.10.0', '0.9.0', true],
    ['1.0.0', '0.99.99', true],
    ['0.2.1', '0.2.0', true],
    ['0.2.0', '0.2.0', false],
    ['0.1.9', '0.2.0', false],
    ['0.3.0-beta', '0.2.0', false],
    ['garbage', '0.2.0', false],
    ['0.3.0', 'unknown', false],
  ])('compares %s against %s', (next, current, expected) => {
    expect(isNewer(next, current)).toBe(expected);
  });
  it('maps all four supported architectures to their own package', () => {
    const parsed = parseRelease(release());
    expect(Object.keys(parsed.downloads)).toHaveLength(4);
    for (const p of Object.keys(PLATFORMS)) {
      expect(isPlatform(p)).toBe(true);
      if (isPlatform(p)) expect(parsed.downloads[p]).toContain(`${p}.zip`);
    }
    expect(isPlatform('__proto__')).toBe(false);
    expect(isPlatform('toString')).toBe(false);
    expect(isPlatform('linux-arm')).toBe(false);
  });
  it('ignores unsupported packages in historical releases', () => {
    const data = release();
    for (const platform of ['macos-intel', 'macos-apple-silicon']) {
      expect(isPlatform(platform)).toBe(false);
      data.assets.push({
        name: `LaserForge-Portable-${platform}.zip`,
        state: 'uploaded',
        size: 100,
        browser_download_url: `https://github.com/${DOWNLOAD_REPO}/releases/download/v0.3.0/LaserForge-Portable-${platform}.zip`,
      });
    }
    expect(Object.keys(parseRelease(data).downloads)).toEqual(Object.keys(PLATFORMS));
  });
  it('rejects drafts, prereleases, bad versions and redirected release URLs', () => {
    for (const change of [
      { draft: true },
      { prerelease: true },
      { tag_name: 'v1.0.0-rc' },
      { html_url: 'https://evil.example/release' },
      { assets: [] },
    ]) {
      expect(() => parseRelease({ ...release(), ...change })).toThrow();
    }
  });
  it('does not offer missing, incomplete or foreign downloads', () => {
    const data = release();
    data.assets[0].browser_download_url = 'javascript:alert(1)';
    data.assets[1].state = 'new';
    data.assets[2].size = 0;
    expect(Object.keys(parseRelease(data).downloads)).toEqual([
      'raspberry-pi-arm32',
    ]);
  });
  it('reports HTTP failures and uses credential-free uncached checks with a timeout', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchRelease()).rejects.toThrow('403');
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

