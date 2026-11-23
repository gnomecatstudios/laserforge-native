<script lang="ts">
  import qrcode from 'qrcode-generator';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Toggle from '$lib/ui/Toggle.svelte';
  import { closePhoneCapture, openPhoneCapture, phoneCapture } from '../phone/phone-capture.svelte';
  import { editor } from '../state/editor.svelte';

  /** Photos arrive one by one, so the layer is chosen here once rather than asked per photo. */
  const imageLayers = $derived(editor.project?.layers.filter((l) => l.mode === 'image') ?? []);
  $effect(() => {
    // A layer deleted since it was picked: back to a new layer per photo.
    if (phoneCapture.layer !== 'each' && !imageLayers.some((l) => l.id === phoneCapture.layer))
      phoneCapture.layer = 'each';
  });

  /** QR modules as one SVG path, black on white in both themes so every phone camera reads it. */
  const qr = $derived.by(() => {
    if (!phoneCapture.url) return null;
    const code = qrcode(0, 'M');
    code.addData(phoneCapture.url);
    code.make();
    const size = code.getModuleCount();
    let d = '';
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) if (code.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
    return { size, d };
  });

  let open = $derived(phoneCapture.open);
</script>

<Dialog
  bind:open={() => open, (next) => (next ? undefined : closePhoneCapture())}
  title="Scan art with your phone"
  description="Point your phone's camera at the code, then photograph your artwork."
  width={420}
  testid="phone-capture-dialog"
>
  {#if phoneCapture.status === 'starting'}
    <p class="muted">Starting…</p>
  {:else if phoneCapture.status === 'unavailable'}
    <p>
      Phone scanning needs the Laser Forge desktop launcher for Windows, Linux or Raspberry Pi. In this
      browser edition, use <strong>Import art</strong> instead. On a phone or tablet, it can open the camera directly.
    </p>
  {:else if phoneCapture.status === 'error'}
    <p class="error">{phoneCapture.error}</p>
    <button type="button" class="btn" onclick={() => void openPhoneCapture()}>Try again</button>
  {:else if qr}
    <div class="qr" data-testid="phone-capture-qr">
      <svg
        viewBox="-4 -4 {qr.size + 8} {qr.size + 8}"
        shape-rendering="crispEdges"
        role="img"
        aria-label="QR code"
      >
        <rect x="-4" y="-4" width={qr.size + 8} height={qr.size + 8} fill="#fff" />
        <path d={qr.d} fill="#000" />
      </svg>
    </div>
    <ol class="steps">
      <li>Connect your phone to the same Wi-Fi as this computer.</li>
      <li>Scan the code and tap <strong>Take photo</strong>.</li>
      <li>Photos appear on the bed as images, ready to trace or engrave.</li>
    </ol>
    <div class="ink">
      <Toggle
        label="Ink only mode"
        hint="For pen and marker drawings on paper. Removes shadows, uneven light and the paper itself, leaving black lines on a transparent background"
        checked={phoneCapture.inkOnly}
        onchange={(c) => phoneCapture.setInkOnly(c)}
        testid="phone-capture-ink-only"
      />
    </div>
    <label class="network">
      Put photos on
      <select bind:value={phoneCapture.layer} data-testid="phone-capture-layer">
        <option value="each">A new layer for each photo</option>
        {#each imageLayers as layer (layer.id)}<option value={layer.id}>{layer.name}</option>{/each}
      </select>
    </label>
    {#if phoneCapture.urls.length > 1}
      <label class="network">
        Network
        <select bind:value={phoneCapture.choice}>
          {#each phoneCapture.urls as url, i (url)}
            <option value={i}>{new URL(url).hostname}</option>
          {/each}
        </select>
      </label>
    {/if}
    <p class="url"><code>{phoneCapture.url}</code></p>
    <p class="muted small">
      {#if phoneCapture.received > 0}
        Received {phoneCapture.received} photo{phoneCapture.received === 1 ? '' : 's'}. Keep scanning or close
        when done.
      {:else}
        Waiting for photos… If the page will not load, allow Laser Forge through your firewall (port 5191).
      {/if}
    </p>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn" onclick={closePhoneCapture}>Done</button>
  {/snippet}
</Dialog>

<style>
  .qr {
    display: grid;
    place-items: center;
    margin: 4px 0 12px;
  }
  .qr svg {
    width: 220px;
    height: 220px;
    border-radius: var(--ol-radius-md);
  }
  .steps {
    margin: 0 0 12px;
    padding-left: 20px;
    display: grid;
    gap: 4px;
  }
  .ink {
    margin-bottom: 8px;
  }
  .network {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    color: var(--ol-text-muted);
  }
  .url {
    margin: 0 0 8px;
    word-break: break-all;
    font-size: var(--ol-fs-sm);
  }
  .muted {
    color: var(--ol-text-muted);
  }
  .small {
    font-size: var(--ol-fs-sm);
  }
  .error {
    color: var(--ol-stop);
    margin-bottom: 12px;
  }
</style>
