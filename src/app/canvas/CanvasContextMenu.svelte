<script lang="ts">
  import type { Snippet } from 'svelte';
  import ArrangeDialog from '../workspace/ArrangeDialog.svelte';
  import { arrangement } from '../state/arrange.svelte';
  import { alignObjects, distributeObjects, type Alignment } from '../lib/layout';
  import { boundsOf } from '../lib/selection';
  import { setObjectTransforms, groupLeaves } from 'libopenlaser/project';
  import { currentBed } from '../state/work-area';
  import { multiply, translation } from 'libopenlaser/geometry';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { ContextMenu } from 'bits-ui';
  import Scissors from '@lucide/svelte/icons/scissors';
  import Copy from '@lucide/svelte/icons/copy';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Combine from '@lucide/svelte/icons/combine';
  import Spline from '@lucide/svelte/icons/spline';
  import SquircleDashed from '@lucide/svelte/icons/squircle-dashed';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import { ui } from '../state/ui.svelte';
  import { editor } from '../state/editor.svelte';
  import * as actions from '../edit-actions';
  import { BOOLEAN_COMMANDS } from '../shortcuts';
  import { formatCombo } from '../lib/keys';
  import { booleanSelection, booleanSelectionIssue } from '../unite';
  import { groupSelection, ungroupSelection, renameGroup } from '../group-actions';
  import { textOutlines } from '../state/text.svelte';
  import * as textActions from '../text-actions';
  import BooleanIcon from './BooleanIcon.svelte';

  let {
    children,
    disabled,
    oncontextmenu,
  }: { children: Snippet; disabled: boolean; oncontextmenu: (event: MouseEvent) => void } = $props();
  let open = $state(false);
  let renaming = $state(false);
  let groupName = $state('');
  const selected = $derived(editor.project?.objects.filter((o) => editor.selection.has(o.id)) ?? []);
  const editable = $derived(selected.length > 0 && selected.every((o) => !o.locked));
  /** A lone image opens in Bitmap mode from here, as with a double-click or Enter. */
  const loneImage = $derived(selected.length === 1 && selected[0].kind === 'image' ? selected[0] : null);
  const texts = $derived(selected.filter((o) => o.kind === 'text'));
  const textGeometryReady = $derived(
    texts.length > 0 &&
      texts.every(
        (o) =>
          !textOutlines.pending.has(o.id) &&
          !o.outlineDirty &&
          o.paths.length > 0 &&
          !o.missingGlyphs?.length,
      ),
  );
  const issue = $derived(open ? booleanSelectionIssue() : null);
  /** Simplify works on unlocked vectors; images are traced from Edit image. */
  const simplifiable = $derived(
    selected.filter((o) => o.kind === 'vector' && o.visible && !o.locked).length > 0,
  );
  /** Opens a toolbar panel once the menu has handed focus back, so the panel takes focus (and Escape). */
  function later(run: () => void) {
    requestAnimationFrame(() => requestAnimationFrame(run));
  }
  function simplify() {
    later(() => (ui.simplifyOpen = true));
  }
  const base = $derived(
    editor.project?.objects.find((o) => o.id === [...editor.selection][0])?.name ?? 'first selected object',
  );
  function layoutUnits() {
    const p = editor.project;
    if (!p) return [];
    return editor.selectedUnits.flatMap((id) => {
      const objects = p.objects.filter((o) => groupLeaves(p, id).includes(o.id));
      const bounds = boundsOf(objects);
      if (!bounds || objects.some((o) => o.locked)) return [];
      return [{ id, objects, bounds }];
    });
  }
  function layoutAction(command: Alignment | 'distribute-x' | 'distribute-y' | 'fit') {
    const units = layoutUnits();
    const proxies = units.map((u) => ({
      id: u.id,
      name: u.id,
      kind: 'image' as const,
      assetId: '',
      layerId: '',
      locked: false,
      visible: true,
      width: u.bounds.maxX - u.bounds.minX,
      height: u.bounds.maxY - u.bounds.minY,
      transform: translation(u.bounds.minX, u.bounds.minY),
    }));
    const bounds = boundsOf(proxies);
    if (!bounds) return;
    let changes;
    if (command.startsWith('distribute'))
      changes = distributeObjects(proxies, command === 'distribute-x' ? 'x' : 'y', 'gaps');
    else if (command === 'fit') {
      const bed = currentBed();
      if (bounds.maxX - bounds.minX > bed.width || bounds.maxY - bounds.minY > bed.height) {
        arrangement.show();
        return;
      }
      const dx = Math.max(-bounds.minX, Math.min(0, bed.width - bounds.maxX));
      const dy = Math.max(-bounds.minY, Math.min(0, bed.height - bounds.maxY));
      changes = new Map(proxies.map((o) => [o.id, multiply(translation(dx, dy), o.transform)]));
    } else changes = alignObjects(proxies, bounds, command as Alignment);
    const transforms = new Map();
    for (const unit of units) {
      const changed = changes.get(unit.id);
      if (!changed) continue;
      const delta = translation(changed[4] - unit.bounds.minX, changed[5] - unit.bounds.minY);
      for (const object of unit.objects) transforms.set(object.id, multiply(delta, object.transform));
    }
    editor.sealHistory();
    editor.commit((p) => setObjectTransforms(p, transforms));
  }
  const edits = [
    { label: 'Cut', key: 'Mod+X', icon: Scissors, run: actions.cutSelection, editable: true },
    { label: 'Copy', key: 'Mod+C', icon: Copy, run: actions.copySelection, editable: false },
    { label: 'Paste', key: 'Mod+V', icon: ClipboardPaste, run: actions.paste, editable: false },
    { label: 'Duplicate', key: 'Mod+D', icon: CopyPlus, run: actions.duplicateSelection, editable: false },
  ];
</script>

<ContextMenu.Root bind:open>
  <ContextMenu.Trigger {disabled} {oncontextmenu} style="display: contents;">
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content
      class="ol-menu canvas-menu"
      data-canvas-menu
      collisionPadding={8}
      preventScroll={false}
      onCloseAutoFocus={() =>
        document.querySelector<HTMLCanvasElement>('[data-testid="bed-canvas"]')?.focus()}
    >
      {#if loneImage}
        {@const id = loneImage.id}
        <ContextMenu.Item
          class="ol-menu-item"
          onSelect={() => later(() => editor.editImage(id))}
          data-testid="menu-edit-image"
        >
          <SlidersHorizontal size={15} /><span>Edit image</span><span class="ol-menu-keys mono"
            >{formatCombo('Enter')}</span
          >
        </ContextMenu.Item>
        <ContextMenu.Separator class="ol-menu-sep" />
      {/if}
      {#each edits as edit (edit.label)}
        <ContextMenu.Item
          class="ol-menu-item"
          disabled={edit.label === 'Paste'
            ? !actions.canPaste()
            : edit.editable
              ? !editable
              : !selected.length}
          onSelect={edit.run}
        >
          <edit.icon size={15} /><span>{edit.label}</span><span class="ol-menu-keys mono"
            >{formatCombo(edit.key)}</span
          >
        </ContextMenu.Item>
      {/each}
      <ContextMenu.Separator class="ol-menu-sep" />
      <ContextMenu.Item
        class="ol-menu-item"
        disabled={!!issue}
        title={issue ?? undefined}
        onSelect={() => booleanSelection('union')}
        data-testid="menu-union"
      >
        <BooleanIcon operation="union" /><span>Union</span><span class="ol-menu-keys mono"
          >{formatCombo('Mod+Shift+U')}</span
        >
      </ContextMenu.Item>
      <ContextMenu.Item
        class="ol-menu-item"
        disabled={!simplifiable}
        onSelect={simplify}
        data-testid="menu-simplify"
      >
        <Spline size={15} /><span>Simplify Path…</span>
      </ContextMenu.Item>
      <ContextMenu.Item
        class="ol-menu-item"
        disabled={!selected.length}
        onSelect={() => later(() => (ui.outlineOpen = true))}
        data-testid="menu-outline"
      >
        <SquircleDashed size={15} /><span>Outline…</span><span class="ol-menu-keys mono"
          >{formatCombo('O')}</span
        >
      </ContextMenu.Item>
      <ContextMenu.Separator class="ol-menu-sep" />
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger
          class="ol-menu-item"
          disabled={!!issue}
          title={issue ?? `Subtract uses ${base} as the base (first selected).`}
        >
          <Combine size={15} /><span>Boolean</span><ChevronRight size={15} />
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent class="ol-menu canvas-menu" data-canvas-menu collisionPadding={8}>
            {#each BOOLEAN_COMMANDS as command (command.operation)}
              <ContextMenu.Item
                class="ol-menu-item"
                onSelect={() => booleanSelection(command.operation)}
                title={command.operation === 'subtract'
                  ? `Base: ${base}. All later selections are subtracted from it.`
                  : undefined}
              >
                <BooleanIcon operation={command.operation} /><span>{command.label}</span><span
                  class="ol-menu-keys mono">{formatCombo(command.keys)}</span
                >
              </ContextMenu.Item>
            {/each}
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger class="ol-menu-item" disabled={!selected.length}
          ><span>Arrange</span><ChevronRight size={15} /></ContextMenu.SubTrigger
        >
        <ContextMenu.Portal
          ><ContextMenu.SubContent class="ol-menu canvas-menu" data-canvas-menu collisionPadding={8}>
            <ContextMenu.Item class="ol-menu-item" onSelect={() => arrangement.show()}
              >Smart Arrange</ContextMenu.Item
            >
            <ContextMenu.Item class="ol-menu-item" onSelect={() => arrangement.show('contour', true)}
              >Auto Nest</ContextMenu.Item
            >
            <ContextMenu.Separator class="ol-menu-sep" />
            {#each [{ label: 'Arrange Horizontally', mode: 'horizontal' }, { label: 'Arrange Vertically', mode: 'vertical' }, { label: 'Arrange in Grid', mode: 'grid' }, { label: 'Arrange in Circle', mode: 'circle' }] as item (item.label)}
              <ContextMenu.Item
                class="ol-menu-item"
                onSelect={() => arrangement.show(item.mode as 'horizontal' | 'vertical' | 'grid' | 'circle')}
                >{item.label}</ContextMenu.Item
              >
            {/each}
            <ContextMenu.Separator class="ol-menu-sep" />
            <ContextMenu.Sub
              ><ContextMenu.SubTrigger class="ol-menu-item"
                ><span>Distribute Evenly</span><ChevronRight size={15} /></ContextMenu.SubTrigger
              ><ContextMenu.Portal
                ><ContextMenu.SubContent class="ol-menu canvas-menu" collisionPadding={8}>
                  <ContextMenu.Item class="ol-menu-item" onSelect={() => layoutAction('distribute-x')}
                    >Horizontal gaps</ContextMenu.Item
                  >
                  <ContextMenu.Item class="ol-menu-item" onSelect={() => layoutAction('distribute-y')}
                    >Vertical gaps</ContextMenu.Item
                  >
                </ContextMenu.SubContent></ContextMenu.Portal
              ></ContextMenu.Sub
            >
            <ContextMenu.Sub
              ><ContextMenu.SubTrigger class="ol-menu-item"
                ><span>Align Objects</span><ChevronRight size={15} /></ContextMenu.SubTrigger
              ><ContextMenu.Portal
                ><ContextMenu.SubContent class="ol-menu canvas-menu" collisionPadding={8}>
                  {#each [{ label: 'Left', mode: 'left' }, { label: 'Horizontal center', mode: 'center-x' }, { label: 'Right', mode: 'right' }, { label: 'Top', mode: 'top' }, { label: 'Vertical center', mode: 'center-y' }, { label: 'Bottom', mode: 'bottom' }] as item (item.label)}
                    <ContextMenu.Item
                      class="ol-menu-item"
                      onSelect={() => layoutAction(item.mode as Alignment)}>{item.label}</ContextMenu.Item
                    >
                  {/each}
                </ContextMenu.SubContent></ContextMenu.Portal
              ></ContextMenu.Sub
            >
            <ContextMenu.Item class="ol-menu-item" onSelect={() => layoutAction('fit')}
              >Fit to Material</ContextMenu.Item
            >
          </ContextMenu.SubContent></ContextMenu.Portal
        >
      </ContextMenu.Sub>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger class="ol-menu-item" disabled={!selected.length}
          ><span>Group</span><ChevronRight size={15} /></ContextMenu.SubTrigger
        >
        <ContextMenu.Portal
          ><ContextMenu.SubContent class="ol-menu canvas-menu" data-canvas-menu collisionPadding={8}>
            <ContextMenu.Item
              class="ol-menu-item"
              disabled={!editable || editor.selectedUnits.length < 2}
              onSelect={groupSelection}
              ><span>Group Selection</span><span class="ol-menu-keys mono">{formatCombo('Mod+G')}</span
              ></ContextMenu.Item
            >
            <ContextMenu.Item
              class="ol-menu-item"
              disabled={!editable || !editor.selectedGroup}
              onSelect={ungroupSelection}
              ><span>Ungroup</span><span class="ol-menu-keys mono">{formatCombo('Mod+Shift+G')}</span
              ></ContextMenu.Item
            >
            <ContextMenu.Item
              class="ol-menu-item"
              disabled={!editor.selectedGroup}
              onSelect={() => {
                groupName = editor.project?.groups?.find((g) => g.id === editor.selectedGroup)?.name ?? '';
                renaming = true;
              }}>Rename Group</ContextMenu.Item
            >
          </ContextMenu.SubContent></ContextMenu.Portal
        >
      </ContextMenu.Sub>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger class="ol-menu-item" disabled={!texts.length || !editable}
          ><span>Modify Text</span><ChevronRight size={15} /></ContextMenu.SubTrigger
        >
        <ContextMenu.Portal
          ><ContextMenu.SubContent class="ol-menu canvas-menu" data-canvas-menu collisionPadding={8}>
            {#each [{ label: 'Edit Text', property: 'Text' }, { label: 'Change Font', property: 'Search fonts' }, { label: 'Bold / Italic', property: 'Weight' }, { label: 'Character Spacing', property: 'Letter spacing' }, { label: 'Line Spacing', property: 'Line height' }, { label: 'Text Alignment', property: 'Align left' }] as item (item.label)}
              <ContextMenu.Item
                class="ol-menu-item"
                onSelect={() => textActions.focusTextProperty(item.property)}>{item.label}</ContextMenu.Item
              >
            {/each}
            <ContextMenu.Separator class="ol-menu-sep" />
            <ContextMenu.Item class="ol-menu-item" onSelect={() => textActions.addTextModifier('curve')}
              >Curve Text</ContextMenu.Item
            >
            <ContextMenu.Item
              class="ol-menu-item"
              disabled={!textActions.canAttachTextToPath(selected)}
              onSelect={textActions.attachTextToPath}>Text Along Path</ContextMenu.Item
            >
            <ContextMenu.Item class="ol-menu-item" onSelect={() => textActions.addTextModifier('warp')}
              >Warp Text</ContextMenu.Item
            >
            <ContextMenu.Separator class="ol-menu-sep" />
            <ContextMenu.Item
              class="ol-menu-item"
              disabled={!textGeometryReady}
              onSelect={textActions.convertSelectedText}>Convert to Path</ContextMenu.Item
            >
            <ContextMenu.Item
              class="ol-menu-item"
              disabled={!textGeometryReady}
              onSelect={textActions.weldSelectedText}>Weld Letters</ContextMenu.Item
            >
          </ContextMenu.SubContent></ContextMenu.Portal
        >
      </ContextMenu.Sub>
      <ContextMenu.Separator class="ol-menu-sep" />
      <ContextMenu.Item class="ol-menu-item" disabled={!editable} onSelect={actions.deleteSelection}>
        <Trash2 size={15} /><span>Delete</span><span class="ol-menu-keys mono">{formatCombo('Delete')}</span>
      </ContextMenu.Item>
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>

{#if arrangement.open}<ArrangeDialog />{/if}
{#if renaming}
  <Dialog open={renaming} title="Rename Group" onclose={() => (renaming = false)}>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        renameGroup(groupName);
        renaming = false;
      }}
    >
      <label>Group name<input class="input" aria-label="Group name" bind:value={groupName} /></label>
      <button type="button" class="btn" onclick={() => (renaming = false)}>Cancel</button>
      <button type="submit" class="btn start" disabled={!groupName.trim()}>Rename</button>
    </form>
  </Dialog>
{/if}

<style>
  :global(.canvas-menu) {
    max-width: calc(100vw - 16px);
    max-height: var(--bits-context-menu-content-available-height, calc(100vh - 16px));
    overflow-y: auto;
  }
  :global(.canvas-menu .ol-menu-item) {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  :global(.canvas-menu .ol-menu-item > span:first-of-type) {
    flex: 1;
  }
</style>
