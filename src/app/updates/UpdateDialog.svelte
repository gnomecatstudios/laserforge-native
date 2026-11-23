<script lang="ts">
  import Dialog from '$lib/ui/Dialog.svelte';
  import Logo from '$lib/ui/Logo.svelte';
  import { APP_VERSION } from '$lib/config/app';
  import { ui } from '../state/ui.svelte';
  import { DOWNLOADS_URL, PLATFORMS, type Platform } from './releases';
  import { checkForUpdates, laserBusy, runNativeUpdate, updates } from './updates.svelte';

  // A modal must never cover Stop: it hides while the laser is running, moving or held.
  // An idle connected laser is fine; installing disconnects it first.
  const visible = $derived(updates.open && !laserBusy() && !ui.tourOpen);
  const download = $derived(updates.platform ? updates.release?.downloads[updates.platform] : undefined);
</script>

<Dialog
  open={visible}
  title={updates.checking
    ? 'Checking for updates…'
    : updates.error
      ? 'Could not check for updates'
      : updates.available
        ? 'Update available'
        : 'You’re up to date'}
  description="Portable app updates"
  onclose={() => {
    updates.open = false;
  }}
  testid="update-dialog"
>
  <Logo size={40} />
  <p>Installed version: {APP_VERSION}</p>
  {#if updates.checking}
    <p role="status">Checking the latest Laser Forge release…</p>
  {:else if updates.error}
    <p>Check your internet connection and try again. You can keep using Laser Forge offline.</p>
    <button class="btn" onclick={() => void checkForUpdates()}>Try again</button>
  {:else if updates.available && updates.release}
    <p>Laser Forge {updates.release.version} is ready to download.</p>
    {#if !updates.native}
      <label for="update-platform">Your platform</label>
      <select id="update-platform" bind:value={updates.platform}>
        <option value="">Choose your platform</option>
        {#each Object.entries(PLATFORMS) as [id, label] (id)}
          <option value={id} disabled={!updates.release.downloads[id as Platform]}>{label}</option>
        {/each}
      </select>
      {#if updates.platform && !download}<p>This release has no package for the selected platform.</p>{/if}
    {/if}
    {#if updates.native}
      <p>
        Download the update here, then save your project before installing and restarting Laser Forge. A
        connected laser is disconnected automatically if it is idle. Python is not required.
      </p>
      {#if updates.nativeStatus === 'downloading'}
        <p role="status">Downloading and verifying the update…</p>
      {:else if updates.nativeStatus === 'ready'}
        <p role="status">
          Version {updates.nativeVersion} is ready to install.
        </p>
      {:else if updates.nativeStatus === 'restarting'}
        <p role="status">
          Restarting Laser Forge… This window reloads with the new version when it is installed. If it
          does not, close this window and open Laser Forge again to see the update message.
        </p>
      {:else if updates.nativeStatus === 'current'}
        <p role="status">You’re running the latest available version.</p>
      {/if}
      {#if updates.nativeError}<p role="alert">{updates.nativeError}</p>{/if}
    {:else}
      <p>
        Save your project, then close Laser Forge and its launcher before replacing the app. Extract the ZIP
        into a new folder and open the launcher. If you use the Python update launcher, updates download in
        the background and install the next time you launch. The native launcher uses manual updates.
      </p>
    {/if}
    <a class="notes" href={updates.release.url} target="_blank" rel="noopener noreferrer"
      >Release notes and installation instructions</a
    >
  {:else}
    <p>You’re running the latest available version of Laser Forge.</p>
  {/if}
  {#snippet footer()}
    <button
      class="btn"
      onclick={() => {
        updates.open = false;
      }}>{updates.available ? 'Later' : 'Close'}</button
    >
    {#if !updates.checking && !updates.error && updates.available && updates.native}
      <button
        class="btn signal"
        disabled={['downloading', 'restarting', 'current'].includes(updates.nativeStatus)}
        onclick={() => void runNativeUpdate(updates.nativeStatus === 'ready' ? 'install' : 'download')}
      >
        {updates.nativeStatus === 'ready'
          ? 'Install and restart'
          : updates.nativeStatus === 'downloading'
            ? 'Downloading…'
            : updates.nativeStatus === 'restarting'
              ? 'Restarting…'
              : 'Download update'}
      </button>
    {:else if !updates.checking && !updates.error && updates.available && download}
      <a class="btn signal download" href={download} target="_blank" rel="noopener noreferrer"
        >Download update</a
      >
    {:else if updates.error}
      <a class="btn" href={DOWNLOADS_URL} target="_blank" rel="noopener noreferrer">View downloads</a>
    {/if}
  {/snippet}
</Dialog>

<style>
  p {
    margin: 12px 0;
    line-height: 1.5;
    color: var(--ol-text-2);
  }
  label {
    display: block;
    margin-bottom: 6px;
  }
  select {
    width: 100%;
    height: var(--ol-control-h);
    padding: 0 8px;
    border: 1px solid var(--ol-border);
    border-radius: var(--ol-radius-md);
    background: var(--ol-surface-2);
  }
  .notes {
    color: var(--ol-text-2);
  }
  .download {
    color: var(--ol-on-signal);
  }
  a.btn {
    text-decoration: none;
  }
</style>
