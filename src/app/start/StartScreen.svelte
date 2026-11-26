<script lang="ts">
  import ConnectButton from '../connect/ConnectButton.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import File from '@lucide/svelte/icons/file';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import CircleHelp from '@lucide/svelte/icons/circle-help';
  import Info from '@lucide/svelte/icons/info';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Glasses from '@lucide/svelte/icons/glasses';
  import Wind from '@lucide/svelte/icons/wind';
  import Eye from '@lucide/svelte/icons/eye';
  import FireExtinguisher from '@lucide/svelte/icons/fire-extinguisher';
  import type { Component } from 'svelte';
  import Logo from '$lib/ui/Logo.svelte';
  import GithubMark from '$lib/ui/GithubMark.svelte';
  import ErrorBoundary from '$lib/ui/ErrorBoundary.svelte';
  import { REPO_URL } from '$lib/config/app';
  import { isWebSerialSupported } from 'libopenlaser/machine';
  import { relativeTime } from '../lib/format';
  import { preferences } from '../state/preferences.svelte';
  import { profiles } from '../state/profiles.svelte';
  import { route } from '../state/route.svelte';
  import { session } from '../state/session.svelte';
  import { ui } from '../state/ui.svelte';
  import { pwa } from '../pwa.svelte';
  import ConnectHelpButton from '../connect/ConnectHelpButton.svelte';
  import * as actions from '../actions';

  /** Connected from here: the work comes first, so the design opens straight away. */
  function startConnected() {
    actions.ensureDocument();
  }

  const serial = isWebSerialSupported();
  const theme = $derived(preferences.value.theme === 'dark' ? 'dark' : 'light');
  const profile = $derived(profiles.active);

  /** The habits the pre-flight checklist asks for, shown before there is a job to start. */
  const SAFETY: Array<{ icon: Component; title: string; text: string }> = [
    { icon: Glasses, title: 'Safety glasses on', text: 'Rated for your laser’s wavelength.' },
    { icon: Wind, title: 'Smoke extracted', text: 'Ventilate the room. Never cut PVC or vinyl.' },
    { icon: Eye, title: 'Stay with the laser', text: 'Watch the whole job. Flare-ups happen in seconds.' },
    {
      icon: FireExtinguisher,
      title: 'Extinguisher in reach',
      text: 'CO₂ extinguisher or fire blanket nearby.',
    },
  ];

  function toggleTheme() {
    void preferences.update({ theme: theme === 'dark' ? 'light' : 'dark' });
  }
</script>

<div class="start" data-theme={theme} data-testid="start-screen">
  <header class="top">
    <Logo size={32} fontSize={19} />
    <nav aria-label="Main">
      <button type="button" class="icon-btn" aria-label="Help" title="Help" onclick={() => route.go('help')}
        ><CircleHelp size={18} /></button
      >
      <button
        type="button"
        class="icon-btn"
        aria-label="About"
        title="About"
        onclick={() => route.go('about')}><Info size={18} /></button
      >
      <a
        class="icon-btn"
        href={REPO_URL}
        target="_blank"
        rel="noopener"
        aria-label="Source code on GitHub"
        title="GitHub"><GithubMark /></a
      >
      <button
        type="button"
        class="icon-btn framed"
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        onclick={toggleTheme}
      >
        {#if theme === 'dark'}<Sun size={18} />{:else}<Moon size={18} />{/if}
      </button>
    </nav>
  </header>

  <main class="main">
    <section class="lead">
      <div class="cards">
        <button type="button" class="card" onclick={() => actions.newProject()} data-testid="new-project">
          <Plus size={24} /><span class="card-title">New Project</span>
        </button>
        <button type="button" class="card" onclick={() => actions.openFile()}>
          <FolderOpen size={24} /><span class="card-title">Open Project</span>
        </button>
      </div>
      <div class="panel connection">
        <div class="panel-head">
          <div class="connection-label">
            <h2>Laser Connection</h2>
            <span class="serial-pill" class:missing={!serial} data-testid="serial-pill">
              <span class="dot"></span>{serial ? 'USB available' : 'USB unavailable'}
            </span>
            <span class="empty">{profile.name}</span>
          </div>
          <ConnectButton size="big" testid="start-connect" before={startConnected} />
        </div>
        <div class="secondary-actions">
          <ConnectHelpButton />
        </div>
      </div>
    </section>

    <aside class="side">
      <ErrorBoundary name="Recent projects">
        <div class="panel recents">
          <div class="panel-head">
            <h2>Recent projects</h2>
          </div>
          {#if session.recents.length === 0}
            <p class="empty">Projects you open or create show up here.</p>
          {:else}
            <ul>
              {#each session.recents.slice(0, 6) as recent (recent.id)}
                <li class="recent">
                  <button type="button" class="recent-open" onclick={() => actions.openRecent(recent.id)}>
                    <File size={20} />
                    <span class="recent-text">
                      <span class="recent-name">{recent.name}</span>
                      <span class="recent-meta"
                        >{recent.layerCount}
                        {recent.layerCount === 1 ? 'layer' : 'layers'} · edited {relativeTime(
                          recent.updatedAt,
                        )}</span
                      >
                    </span>
                    <ChevronRight size={16} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn sm forget"
                    aria-label="Remove {recent.name} from recent projects"
                    onclick={() => session.forget(recent.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </ErrorBoundary>
      <div class="panel safety" data-testid="start-safety">
        <div class="panel-head">
          <h2>Safety habits</h2>
        </div>
        <ul class="habits">
          {#each SAFETY as habit (habit.title)}
            <li>
              <habit.icon size={18} />
              <span class="habit-text"><strong>{habit.title}</strong><span>{habit.text}</span></span>
            </li>
          {/each}
        </ul>
        <p class="empty small">Press <span class="kbd">Esc</span> to stop the laser at any time.</p>
      </div>
    </aside>
  </main>

  <footer class="foot">
    <span>LaserForge · Free and open source</span>
    <span class="foot-links">
      <button type="button" class="link" onclick={() => (ui.tourOpen = true)}>Tour</button>
      {#if pwa.offlineReady}<span class="mono">Offline ready</span>{/if}
    </span>
  </footer>
</div>

<style>
  .start {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--ol-bg);
    color: var(--ol-text);
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px clamp(16px, 4vw, 48px);
  }

  nav {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .icon-btn.framed {
    width: 40px;
    height: 40px;
    border: 1px solid var(--ol-border);
    background: var(--ol-surface);
    border-radius: var(--ol-radius-md);
  }

  .main {
    flex-grow: 1;
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: 24px clamp(16px, 4vw, 48px) 48px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-items: flex-start;
  }

  .lead {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .serial-pill {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--ol-surface);
    border: 1px solid var(--ol-border);
    font: 500 var(--ol-fs-sm) var(--ol-font-mono);
    color: var(--ol-text-2);
  }

  .serial-pill .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ol-text-muted);
  }

  .serial-pill.missing {
    background: var(--ol-hold-tint);
    border-color: var(--ol-hold);
  }

  .serial-pill.missing .dot {
    background: var(--ol-hold);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .card {
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    border-radius: var(--ol-radius-lg);
    border: 1px solid var(--ol-border);
    background: var(--ol-surface);
    color: var(--ol-text);
  }

  .card:hover {
    border-color: var(--ol-border-strong);
  }

  .card :global(svg) {
    color: var(--ol-signal);
  }

  .card-title {
    font-size: var(--ol-fs-lg);
    font-weight: 600;
  }

  .side {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .panel {
    border-radius: var(--ol-radius-xl);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--ol-surface);
    border: 1px solid var(--ol-border);
    color: var(--ol-text);
  }

  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h2 {
    font-size: var(--ol-fs-lg);
    font-weight: 600;
  }

  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: none;
    padding: 0;
    color: var(--ol-signal);
    font-size: var(--ol-fs-md);
  }

  .link:hover {
    text-decoration: underline;
  }

  .empty {
    color: var(--ol-text-muted);
  }

  ul {
    list-style: none;
    margin: 0 -10px;
    padding: 0;
  }

  .habits {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .habits li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .habits li > :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--ol-beam);
  }

  .habit-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .habit-text span {
    color: var(--ol-text-muted);
    font-size: var(--ol-fs-sm);
  }

  .safety .small {
    margin: 0;
    font-size: var(--ol-fs-sm);
  }

  .recent {
    position: relative;
    display: flex;
    align-items: center;
  }

  .recent-open {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px;
    border-radius: 12px;
    border: 0;
    background: transparent;
    color: var(--ol-text);
    text-align: left;
  }

  .recent-open:hover {
    background: var(--ol-surface-2);
  }

  .recent-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .recent-name {
    font-size: var(--ol-fs-lg);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-meta {
    color: var(--ol-text-muted);
  }

  .forget {
    position: absolute;
    right: 34px;
    opacity: 0;
  }

  .recent:hover .forget,
  .forget:focus-visible {
    opacity: 1;
  }

  .connection-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .connection .panel-head {
    flex-wrap: wrap;
    gap: 12px;
  }
  .secondary-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: 18px clamp(16px, 4vw, 48px);
    border-top: 1px solid var(--ol-border);
    color: var(--ol-text-muted);
  }

  .foot-links {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .foot .link {
    color: var(--ol-text-muted);
  }
</style>
