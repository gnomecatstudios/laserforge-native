import { createGroup, groupLeaves, makeId, ungroup } from 'libopenlaser/project';
import { editor } from './state/editor.svelte';
import { toast } from '$lib/ui/toasts.svelte';

export function groupSelection(): void {
  if (!editor.project || editor.selectedUnits.length < 2) return;
  if (editor.project.objects.some((o) => editor.selection.has(o.id) && o.locked)) return;
  const id = makeId();
  try {
    editor.commit((p) =>
      createGroup(p, editor.selectedUnits, id, `Group ${(p.groups?.length ?? 0) + 1}`, editor.groupScope),
    );
    editor.select(groupLeaves(editor.project, id));
    editor.tool = 'select';
  } catch (error) {
    toast.warning(error instanceof Error ? error.message : 'Unable to group selection.');
  }
}
export function ungroupSelection(): void {
  const id = editor.selectedGroup;
  if (!id) return;
  editor.commit((p) => ungroup(p, id));
}
export function renameGroup(name: string): void {
  const id = editor.selectedGroup;
  if (!id || !name.trim()) return;
  editor.commit((p) => ({
    ...p,
    groups: p.groups?.map((g) => (g.id === id ? { ...g, name: name.trim() } : g)),
  }));
}
