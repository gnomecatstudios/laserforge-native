/** The node picked in the node editor, so Delete removes it rather than the whole object. */
import { updateObject, type VectorObject } from 'libopenlaser/project';
import { editor } from './editor.svelte';
import { deleteNode, pathNodes, type NodeRef } from '../canvas/node-edit';

class NodeSelection {
  current = $state<{ objectId: string; node: NodeRef } | null>(null);

  is(objectId: string, node: NodeRef): boolean {
    const c = this.current;
    return (
      !!c &&
      c.objectId === objectId &&
      c.node.path === node.path &&
      c.node.index === node.index &&
      c.node.control === node.control
    );
  }

  /** The selected anchor, if it still exists on an editable, selected vector in the node tool. */
  target(): { object: VectorObject; node: NodeRef } | null {
    const c = this.current;
    if (!c || c.node.control || editor.tool !== 'node' || editor.view !== 'design') return null;
    if (!editor.selection.has(c.objectId)) return null;
    const object = editor.project?.objects.find((o) => o.id === c.objectId);
    if (!object || object.kind !== 'vector' || object.locked) return null;
    const exists = pathNodes(object.paths).some(
      (n) => !n.control && n.path === c.node.path && n.index === c.node.index,
    );
    return exists ? { object, node: c.node } : null;
  }

  /** Delete one anchor; returns false when the path is too short to lose another node. */
  remove(object: VectorObject, node: NodeRef): boolean {
    const paths = deleteNode(object.paths, node);
    if (paths === object.paths) return false;
    editor.sealHistory();
    editor.commit((p) => updateObject(p, object.id, { paths, shape: undefined }));
    editor.sealHistory();
    this.current = null;
    return true;
  }

  removeSelected(): boolean {
    const t = this.target();
    return t ? this.remove(t.object, t.node) : false;
  }
}

export const nodeSelection = new NodeSelection();
