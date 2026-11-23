/**
 * Scan art with a phone. The portable launcher serves a camera page on the local network;
 * this tab shows its address as a QR code and imports each photo the phone sends.
 */
import { errorMessage } from '$lib/ui/errors';
import { toast } from '$lib/ui/toasts.svelte';
import { importPhoto } from '../actions';

const HEADERS = { 'X-LaserForge-Capture': '1' };
const INK_ONLY_KEY = 'laserforge.phone-capture.ink-only';
const POLL_MS = 1_500;

type Status = 'idle' | 'starting' | 'ready' | 'unavailable' | 'error';

class PhoneCapture {
  open = $state(false);
  status = $state<Status>('idle');
  error = $state('');
  urls = $state<string[]>([]);
  /** Which of `urls` the QR code shows; the computer may be on several networks. */
  choice = $state(0);
  received = $state(0);
  url = $derived(this.urls[this.choice] ?? '');
  /** Which layer photos go on: 'each' for a new layer per photo, or an image layer's id. */
  layer = $state('each');
  /** Clean each photo down to its pen or marker ink as it arrives. Remembered between sessions. */
  inkOnly = $state(loadInkOnly());

  setInkOnly(value: boolean): void {
    this.inkOnly = value;
    try {
      localStorage.setItem(INK_ONLY_KEY, value ? '1' : '0');
    } catch {
      /* Storage may be unavailable; the choice still holds for this session. */
    }
  }
}

function loadInkOnly(): boolean {
  try {
    return localStorage.getItem(INK_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}

export const phoneCapture = new PhoneCapture();

let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

export async function openPhoneCapture(): Promise<void> {
  phoneCapture.open = true;
  phoneCapture.status = 'starting';
  phoneCapture.error = '';
  phoneCapture.received = 0;
  const mine = ++generation;
  try {
    const response = await fetch('/api/phone-capture/start', {
      method: 'POST',
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (mine !== generation) return;
    if (response.status === 404 || response.status === 405) {
      phoneCapture.status = 'unavailable';
      return;
    }
    if (!response.ok) throw new Error((await response.text()).trim() || `HTTP ${response.status}`);
    const data: unknown = await response.json();
    const urls =
      data && typeof data === 'object' && 'urls' in data && Array.isArray(data.urls)
        ? data.urls.filter((u): u is string => typeof u === 'string')
        : [];
    if (mine !== generation) return;
    phoneCapture.urls = urls;
    phoneCapture.choice = 0;
    if (urls.length === 0) {
      phoneCapture.status = 'error';
      phoneCapture.error =
        'This computer is not on a network your phone can reach. Connect it to Wi-Fi or Ethernet.';
      return;
    }
    phoneCapture.status = 'ready';
    poll(mine);
  } catch (error) {
    if (mine !== generation) return;
    // The web edition has no launcher behind it; a JSON parse or network failure means the same.
    phoneCapture.status =
      error instanceof SyntaxError || error instanceof TypeError ? 'unavailable' : 'error';
    phoneCapture.error = errorMessage(error);
  }
}

export function closePhoneCapture(): void {
  generation++;
  clearTimeout(timer);
  phoneCapture.open = false;
  if (phoneCapture.status === 'ready') {
    void fetch('/api/phone-capture/stop', { method: 'POST', headers: HEADERS }).catch(() => {});
  }
  phoneCapture.status = 'idle';
}

function poll(mine: number): void {
  timer = setTimeout(async () => {
    if (mine !== generation) return;
    try {
      // Drain everything waiting before sleeping again.
      for (;;) {
        const response = await fetch('/api/phone-capture/take', {
          method: 'POST',
          headers: HEADERS,
          cache: 'no-store',
          signal: AbortSignal.timeout(30_000),
        });
        if (mine !== generation) return;
        if (response.status === 409) {
          // The launcher let capture lapse (or restarted); start a fresh session.
          void openPhoneCapture();
          return;
        }
        if (response.status !== 200) break;
        const blob = await response.blob();
        const raw = response.headers.get('X-Capture-Name') ?? '';
        let name = 'phone-photo.jpg';
        try {
          name = decodeURIComponent(raw) || name;
        } catch {
          /* keep the default */
        }
        const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
        const layer = phoneCapture.layer;
        await importPhoto(file, {
          inkOnly: phoneCapture.inkOnly,
          layer: layer === 'each' ? { kind: 'each' } : { kind: 'layer', id: layer },
        });
        phoneCapture.received++;
        toast.success(`Imported ${name} from your phone.`);
      }
    } catch {
      /* Transient; try again on the next tick. */
    }
    poll(mine);
  }, POLL_MS);
}
