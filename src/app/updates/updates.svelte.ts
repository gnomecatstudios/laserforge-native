import { APP_VERSION } from '$lib/config/app';
import { toast } from '$lib/ui/toasts.svelte';
import { connectedSession } from '../machines/registry';
import { fetchRelease, isNewer, isPlatform, nativeRelease, type Platform, type Release } from './releases';

class Updates {
  open = $state(false);
  checking = $state(false);
  error = $state(false);
  release = $state.raw<Release | null>(null);
  platform = $state<Platform | ''>('');
  native = $state(false);
  nativeStatus = $state('idle');
  nativeError = $state('');
  nativeVersion = $state('');
  get available() {
    return !!this.release && isNewer(this.release.version, APP_VERSION);
  }
}
export const updates = new Updates();

/** The laser is running, moving or held: updating now could interrupt it. Idle connections are fine. */
export function laserBusy(): boolean {
  const session = connectedSession();
  return !!session && (session.jobActive || session.canStop);
}

const BUSY_MESSAGE = 'The laser is busy. Update once the job finishes.';

export async function checkForUpdates(manual = true): Promise<void> {
  if (manual && laserBusy()) {
    toast.info(BUSY_MESSAGE);
    return;
  }
  if (manual) updates.open = true;
  if (updates.checking) return;
  updates.checking = true;
  updates.error = false;
  try {
    updates.release = updates.native ? await fetchNativeRelease() : await fetchRelease();
    // Automatic checks never pop up over a connected laser; a manual check may, once it is idle.
    if (updates.available && (manual || !connectedSession())) updates.open = true;
  } catch {
    updates.error = true;
  } finally {
    updates.checking = false;
  }
}

/** Native packages embed their exact architecture; browser UA strings cannot identify ARM reliably. */
export async function installUpdateChecks(): Promise<void> {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return;
  try {
    const response = await fetch('./portable-platform.json', {
      signal: AbortSignal.timeout(3_000),
      cache: 'no-store',
    });
    if (!response.ok) return;
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('platform' in data) || !isPlatform(data.platform)) return;
    updates.platform = data.platform;
    try {
      await refreshNativeUpdate();
    } catch {
      /* Older launchers use manual downloads. */
    }
    await checkForUpdates(false);
  } catch {
    // Normal for the web edition, older launchers, and an offline machine.
  }
}

let nativeToken = '';

async function refreshNativeUpdate(): Promise<void> {
  const response = await fetch('/api/portable-update', {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error('Native updater unavailable');
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== 'object' ||
    !('token' in data) ||
    typeof data.token !== 'string' ||
    !('status' in data) ||
    typeof data.status !== 'string'
  )
    throw new Error('Invalid updater response');
  nativeToken = data.token;
  updates.native = true;
  updates.nativeStatus = data.status;
  updates.nativeError = 'error' in data && typeof data.error === 'string' ? data.error : '';
  updates.nativeVersion = 'version' in data && typeof data.version === 'string' ? data.version : '';
}

/**
 * The launcher reads the latest release from GitHub's release page. GitHub's API allows
 * only 60 anonymous requests an hour per IP address, which shared networks run out of.
 */
async function fetchNativeRelease(): Promise<Release> {
  await refreshNativeUpdate(); // a fresh token if the launcher restarted
  if (!isPlatform(updates.platform)) throw new Error('Unknown platform');
  const response = await fetch('/api/portable-update?action=check', {
    method: 'POST',
    headers: { 'X-LaserForge-Update': nativeToken },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Update check failed (${response.status})`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('version' in data) || typeof data.version !== 'string')
    throw new Error('Invalid updater response');
  return nativeRelease(data.version, updates.platform);
}

/** Reload once the updated launcher serves: each launcher issues a fresh update token. */
async function reloadWhenRestarted(previousToken: string): Promise<void> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    try {
      const response = await fetch('/api/portable-update', {
        cache: 'no-store',
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) continue;
      const data: unknown = await response.json();
      if (data && typeof data === 'object' && 'token' in data && data.token !== previousToken) {
        location.reload();
        return;
      }
    } catch {
      // The launcher is still restarting.
    }
  }
}

export async function runNativeUpdate(action: 'download' | 'install'): Promise<void> {
  if (!updates.native || ['downloading', 'restarting'].includes(updates.nativeStatus)) return;
  if (laserBusy()) {
    updates.nativeError = BUSY_MESSAGE;
    return;
  }
  if (action === 'install') {
    const connected = !!connectedSession();
    const question = connected
      ? 'Save your project before continuing. The idle laser will be disconnected. Install the update and restart Laser Forge now?'
      : 'Save your project before continuing. Install the update and restart Laser Forge now?';
    if (!window.confirm(question)) return;
    // Re-check after the prompt: a job may have started while it was open.
    if (laserBusy()) {
      updates.nativeError = BUSY_MESSAGE;
      return;
    }
    const session = connectedSession();
    if (session) {
      try {
        await session.disconnect();
      } catch {
        /* checked below */
      }
      if (connectedSession()) {
        updates.nativeError = 'Could not disconnect the laser. Disconnect it, then install again.';
        return;
      }
    }
  }
  updates.nativeError = '';
  updates.nativeStatus = action === 'install' ? 'restarting' : 'downloading';
  try {
    const response = await fetch('/api/portable-update?action=' + action, {
      method: 'POST',
      headers: { 'X-LaserForge-Update': nativeToken },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(await response.text());
    if (action === 'install') {
      // The helper releases the old server, installs, and starts the new launcher, which
      // reuses this app window. Keep it available if the OS blocks restarting.
      updates.nativeStatus = 'restarting';
      void reloadWhenRestarted(nativeToken);
      return;
    }
    do {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await refreshNativeUpdate();
    } while (updates.nativeStatus === 'downloading');
  } catch (error) {
    updates.nativeStatus = 'error';
    updates.nativeError = error instanceof Error ? error.message : 'Update failed. Try again.';
  }
}
