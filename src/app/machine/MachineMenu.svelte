<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Cpu from '@lucide/svelte/icons/cpu';
  import { shownAdapter } from '../machines/registry';
  import { profiles } from '../state/profiles.svelte';
  import { ui } from '../state/ui.svelte';
  import { currentBed } from '../state/work-area';

  /**
   * Opens the Machine panel, docked at the left of the workspace so the bed stays in view and
   * shortcuts keep working while you jog and frame. It closes from this button, its × or Escape.
   */
  const adapter = $derived(shownAdapter());
  const area = $derived(currentBed());
</script>

<button
  type="button"
  class="machine-trigger"
  aria-label="Machine: {profiles.active.name}"
  aria-expanded={ui.machineOpen}
  aria-controls="machine-dock"
  data-state={ui.machineOpen ? 'open' : 'closed'}
  title="{profiles.active.name} · {Math.round(area.width)} × {Math.round(area.height)} mm"
  onclick={() => (ui.machineOpen = !ui.machineOpen)}
  data-testid="machine-menu"
>
  <Cpu size={16} />
  <span class="label">
    <span class="name">{profiles.active.name}</span>
    <span class="mono dims">{Math.round(area.width)} × {Math.round(area.height)} mm</span>
  </span>
  {#if adapter.badge}<adapter.badge />{/if}
  <ChevronDown size={15} class="chev" />
</button>

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
</style>
