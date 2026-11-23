<script lang="ts">
  import { Popover } from 'bits-ui';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Cpu from '@lucide/svelte/icons/cpu';
  import ErrorBoundary from '$lib/ui/ErrorBoundary.svelte';
  import { shownAdapter } from '../machines/registry';
  import { profiles } from '../state/profiles.svelte';
  import { ui } from '../state/ui.svelte';
  import { currentBed } from '../state/work-area';
  import MachinePanel from './MachinePanel.svelte';

  /**
   * The machine, its work area and its controls, in a dropdown off the top bar. It stays open
   * while you work on the bed (jogging, framing), and closes from its button, × or Escape.
   */
  const adapter = $derived(shownAdapter());
  const area = $derived(currentBed());
</script>

<Popover.Root bind:open={ui.machineOpen}>
  <Popover.Trigger
    class="machine-trigger"
    aria-label="Machine: {profiles.active.name}"
    title="{profiles.active.name} · {Math.round(area.width)} × {Math.round(area.height)} mm"
    data-testid="machine-menu"
  >
    <Cpu size={16} />
    <span class="label">
      <span class="name">{profiles.active.name}</span>
      <span class="mono dims">{Math.round(area.width)} × {Math.round(area.height)} mm</span>
    </span>
    {#if adapter.badge}<adapter.badge />{/if}
    <ChevronDown size={15} class="chev" />
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      class="machine-dropdown"
      sideOffset={6}
      align="start"
      interactOutsideBehavior="ignore"
      trapFocus={false}
    >
      <ErrorBoundary name="Machine"><MachinePanel /></ErrorBoundary>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.machine-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    min-width: 0;
    flex-shrink: 1;
    max-width: 380px;
    padding: 0 8px 0 10px;
    border-radius: var(--ol-radius-md);
    border: 1px solid var(--ol-border);
    background: var(--ol-surface-2);
    color: var(--ol-text);
  }

  :global(.machine-trigger:hover),
  :global(.machine-trigger[data-state='open']) {
    border-color: var(--ol-border-strong);
  }

  :global(.machine-trigger .chev) {
    flex-shrink: 0;
    color: var(--ol-text-muted);
    transition: transform 0.15s ease;
  }

  :global(.machine-trigger[data-state='open'] .chev) {
    transform: rotate(180deg);
  }

  .label {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dims {
    flex-shrink: 0;
    font-size: var(--ol-fs-xs);
    color: var(--ol-text-muted);
    white-space: nowrap;
  }

  :global(.machine-dropdown) {
    z-index: 50;
    width: 360px;
    max-height: calc(100vh - var(--ol-topbar-h) - 24px);
    overflow-y: auto;
    border-radius: var(--ol-radius-md);
    background: var(--ol-surface);
    border: 1px solid var(--ol-border-strong);
    box-shadow: var(--ol-shadow-pop);
    outline: none;
  }
</style>
