/** The nodes picked in the node editor, so Delete removes them rather than the whole object. */
import { updateObject, type Project, type VectorObject } from 'libopenlaser/project';
import { editor } from './editor.svelte';
import { deleteNode, pathNodes, type NodeRef } from '../canvas/node-edit';

export interface PickedNode {
  objectId: string;
  node: NodeRef;
}

/** Selected, unlocked, visible vectors on visible layers: the ones the node tool edits. */
export function editableVectors(project: Project | null): VectorObject[] {
  if (!project || editor.tool !== 'node' || editor.view !== 'design') return [];
  return project.objects.filter(
    (o): o is VectorObject =>
      o.kind === 'vector' &&
      !o.locked &&
      o.visible &&
      editor.selection.has(o.id) &&
      project.layers.some((l) => l.id === o.layerId && l.visible),
  );
}

const same = (a: PickedNode, b: PickedNode) =>
  a.objectId === b.objectId &&
  a.node.path === b.node.path &&
  a.node.index === b.node.index &&
  a.node.control === b.node.control;

class NodeSelection {
  /** Picked anchors. Curve handles can be dragged but never picked. */
  picked = $state<PickedNode[]>([]);

  is(objectId: string, node: NodeRef): boolean {
    return this.picked.some((p) => same(p, { objectId, node }));
  }

  /** Pick one anchor: replace the picks, add to them, or toggle it in or out. */
  pick(objectId: string, node: NodeRef, mode: 'replace' | 'add' | 'toggle' = 'replace') {
    if (node.control) return;
    const entry = { objectId, node: { path: node.path, index: node.index } };
    if (mode === 'replace') this.picked = [entry];
    else if (this.is(objectId, node)) {
      if (mode === 'toggle') this.picked = this.picked.filter((p) => !same(p, entry));
    } else this.picked = [...this.picked, entry];
  }

  /** Pick several anchors at once, as from a box drag. */
  pickMany(entries: PickedNode[], additive: boolean) {
    const anchors = entries.filter((e) => !e.node.control);
    const base = additive ? this.picked : [];
    this.picked = [...base, ...anchors.filter((e) => !base.some((p) => same(p, e)))];
  }

  clear() {
    if (this.picked.length) this.picked = [];
  }

  /** Picked anchors that still exist on an object the node tool is editing, grouped by object. */
  targets(): { object: VectorObject; nodes: NodeRef[] }[] {
    const objects = editableVectors(editor.project);
    return objects
      .map((object) => {
        const anchors = pathNodes(object.paths).filter((n) => !n.control);
        const nodes = this.picked
          .filter((p) => p.objectId === object.id)
          .map((p) => p.node)
          .filter((node) => anchors.some((n) => n.path === node.path && n.index === node.index));
        return { object, nodes };
      })
      .filter((t) => t.nodes.length);
  }

  /** Delete one anchor; returns false when the path is too short to lose another node. */
  remove(object: VectorObject, node: NodeRef): boolean {
    return this.removeAll([{ object, nodes: [node] }]);
  }

  /**
   * Delete anchors in one undo step. Each path keeps at least two anchors; nodes past that are
   * skipped. Returns false when nothing could be removed.
   */
  removeAll(targets: { object: VectorObject; nodes: NodeRef[] }[]): boolean {
    const changes = new Map<string, VectorObject['paths']>();
    for (const { object, nodes } of targets) {
      // Later anchors first, so removing one never shifts the index of another still to go.
      const ordered = [...nodes].sort((a, b) => b.path - a.path || b.index - a.index);
      let paths = object.paths;
      for (const node of ordered) paths = deleteNode(paths, node);
      if (paths !== object.paths) changes.set(object.id, paths);
    }
    if (!changes.size) return false;
    editor.sealHistory();
    editor.commit((p) => {
      let next = p;
      for (const [id, paths] of changes) next = updateObject(next, id, { paths, shape: undefined });
      return next;
    });
    editor.sealHistory();
    this.picked = [];
    return true;
  }

  removeSelected(): boolean {
    return this.removeAll(this.targets());
  }
}

export const nodeSelection = new NodeSelection();
