/** The native app's own releases: browser-tab Laser Forge releases would replace the app-window launcher. */
export const DOWNLOAD_REPO = 'gnomecatstudios/laserforge-native';
export const DOWNLOADS_URL = `https://github.com/${DOWNLOAD_REPO}/releases/latest`;
export const RELEASE_API = `https://api.github.com/repos/${DOWNLOAD_REPO}/releases/latest`;

export const PLATFORMS = {
  'windows-x64': 'Windows · 64-bit',
  'linux-x64': 'Linux · x64',
  'raspberry-pi-arm64': 'Linux / Raspberry Pi · ARM64',
  'raspberry-pi-arm32': 'Linux / Raspberry Pi · ARM32',
} as const;
export type Platform = keyof typeof PLATFORMS;
export interface Release {
  version: string;
  url: string;
  downloads: Partial<Record<Platform, string>>;
}

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && Object.hasOwn(PLATFORMS, value);
}

function versionParts(value: string): number[] | null {
  if (!/^\d+\.\d+\.\d+$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isNewer(candidate: string, current: string): boolean {
  const next = versionParts(candidate);
  const previous = versionParts(current);
  if (!next || !previous) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== previous[i]) return next[i] > previous[i];
  }
  return false;
}

/** Only stable releases and exact package URLs from our public downloads repository. */
export function parseRelease(value: unknown): Release {
  if (!value || typeof value !== 'object') throw new Error('Invalid release');
  const data = value as Record<string, unknown>;
  const tag = data.tag_name;
  if (
    typeof tag !== 'string' ||
    !tag.startsWith('v') ||
    !versionParts(tag.slice(1)) ||
    data.draft !== false ||
    data.prerelease !== false ||
    !Array.isArray(data.assets)
  ) {
    throw new Error('Invalid release');
  }
  const base = `https://github.com/${DOWNLOAD_REPO}/releases`;
  if (data.html_url !== `${base}/tag/${tag}`) throw new Error('Invalid release URL');
  const downloads: Release['downloads'] = {};
  for (const platform of Object.keys(PLATFORMS) as Platform[]) {
    const short = platform === 'raspberry-pi-arm64' ? 'RPi-ARM64' : platform === 'raspberry-pi-arm32' ? 'RPi-ARM32' : platform;
    for (const suffix of new Set([`${short}-${tag}`, `${platform}-${tag}`, short, platform])) {
    const name = `LaserForge-Portable-${suffix}.zip`;
    const url = `${base}/download/${tag}/${name}`;
    if (
      data.assets.some((asset: unknown) => {
        if (!asset || typeof asset !== 'object') return false;
        const entry = asset as Record<string, unknown>;
        return (
          entry.name === name &&
          entry.browser_download_url === url &&
          entry.state === 'uploaded' &&
          typeof entry.size === 'number' &&
          entry.size > 0
        );
      })
    )
      {
        downloads[platform] = url;
        break;
      }
    }
  }
  if (!Object.keys(downloads).length) throw new Error('No portable downloads');
  return { version: tag.slice(1), url: `${base}/tag/${tag}`, downloads };
}

export async function fetchRelease(): Promise<Release> {
  const response = await fetch(RELEASE_API, {
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
    credentials: 'omit',
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`Update check failed (${response.status})`);
  return parseRelease(await response.json());
}

