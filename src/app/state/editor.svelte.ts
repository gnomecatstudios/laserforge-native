/**
 * Editor state: the open project, selection, tools and undo history. Every project mutation goes
 * through `commit`, which records an undo step and marks the document dirty.
 */
import { groupLeaves, pruneGroups, syncGroupFrames, addNewObjectsToScope } from 'libopenlaser/project';
import { syncLinkedText } from '../lib/linked-text';
import type { MoveList } from 'libopenlaser/cam';
import { defaultLayer, LAYER_PALETTE, MODE_COLORS, nextLayerName } from 'libopenlaser/project';
import { createProject } from 'libopenlaser/project';
import { History } from 'libopenlaser/project';
import { makeId } from 'libopenlaser/project';
import * as ops from 'libopenlaser/project';
import { keepsAspectByDefault } from '../lib/selection';
import type { Anchor, Asset, Id, Layer, LayerMode, Project, SceneObject } from 'libopenlaser/project';

export type Tool = 'select' | 'node' | 'pen' | 'pan' | 'rect' | 'ellipse' | 'shape' | 'text' | 'measure';
export type ViewMode = 'design' | 'bitmap' | 'preview';

/** A G-code file opened in sender mode: it bypasses design and CAM. */
export interface GcodeDocument {
  name: string;
  lines: string[];
  moves: MoveList;
}

export class Editor {
  project = $state.raw<Project | null>(null);
  selection = $state.raw<ReadonlySet<Id>>(new Set());
  activeLayerId = $state<Id | null>(null);
  tool = $state<Tool>('select');
  groupScope = $state<Id | null>(null);
  /** Shape the Shapes tool draws. */
  shapeKind = $state('star');
  /** Reference point for the X/Y/W/H fields and scaling. */
  anchor = $state<Anchor>('bl');
  /** The chain button's choice, for the selection it was made on; other selections use their default. */
  private aspectChoice = $state<{ selection: string; keep: boolean } | null>(null);

  /** Keep proportions when resizing: on for text, images and imported art unless the user unlinks. */
  get keepAspect(): boolean {
    const key = [...this.selection].sort().join(' ');
    if (this.aspectChoice?.selection === key) return this.aspectChoice.keep;
    const project = this.project;
    return project ? keepsAspectByDefault(project.objects.filter((o) => this.selection.has(o.id))) : false;
  }

  set keepAspect(keep: boolean) {
    this.aspectChoice = { selection: [...this.selection].sort().join(' '), keep };
  }
  view = $state<ViewMode>('design');
  gcode = $state.raw<GcodeDocument | null>(null);
  /** Changes since the last save to a file. */
  dirty = $state(false);
  fileName = $state<string | null>(null);
  fileHandle: FileSystemFileHandle | null = null;
  /** Bumps on every history change so canUndo/canRedo stay reactive. */
  private historyTick = $state(0);
  private history = new History<Project>();

  get canUndo(): boolean {
    void this.historyTick;
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    void this.historyTick;
    return this.history.canRedo;
  }

  get activeLayer(): Layer | null {
    return this.project?.layers.find((l) => l.id === this.activeLayerId) ?? null;
  }

  get hasDocument(): boolean {
    return this.project !== null || this.gcode !== null;
  }

  /** Applies a pure project operation as one undoable step. */
  commit(change: (project: Project) => Project, options: { coalesce?: string; record?: boolean } = {}): void {
    const current = this.project;
    if (!current) return;
    const next = syncLinkedText(
      syncGroupFrames(current, pruneGroups(addNewObjectsToScope(current, change(current), this.groupScope))),
    );
    if (next === current) return;
    // `record: false` is for derived data (text outlines) that follows an edit already on the stack.
    if (options.record !== false) this.history.record(current, options.coalesce ?? null);
    this.project = { ...next, updatedAt: new Date().toISOString() };
    this.dirty = true;
    this.historyTick++;
    this.pruneSelection();
  }

  /** Ends a coalescing run (end of a drag or scrub). */
  sealHistory(): void {
    this.history.seal();
  }

  undo(): void {
    if (!this.project) return;
    const previous = this.history.undo(this.project);
    if (previous) this.restore(previous);
  }

  redo(): void {
    if (!this.project) return;
    const next = this.history.redo(this.project);
    if (next) this.restore(next);
  }

  private restore(project: Project): void {
    this.project = project;
    this.dirty = true;
    this.historyTick++;
    this.pruneSelection();
  }

  private pruneSelection(): void {
    const project = this.project;
    if (!project) return;
    if (this.groupScope && !project.groups?.some((g) => g.id === this.groupScope)) this.groupScope = null;
    if (this.selection.size) {
      const ids = new Set(project.objects.map((o) => o.id));
      const kept = [...this.selection].filter((id) => ids.has(id));
      if (kept.length !== this.selection.size) this.selection = new Set(kept);
    }
    if (!project.layers.some((l) => l.id === this.activeLayerId)) {
      this.activeLayerId = project.layers[0]?.id ?? null;
    }
  }

  open(project: Project, file: { name?: string | null; handle?: FileSystemFileHandle | null } = {}): void {
    this.project = project;
    this.groupScope = null;
    this.gcode = null;
    this.selection = new Set();
    this.activeLayerId = project.layers[0]?.id ?? null;
    this.history.clear();
    this.historyTick++;
    this.dirty = false;
    this.fileName = file.name ?? null;
    this.fileHandle = file.handle ?? null;
    this.view = 'design';
    this.tool = 'select';
  }

  newProject(machineProfileId: Id | null, name = 'Untitled'): void {
    this.open(createProject({ name, machineProfileId }));
  }

  openGcode(doc: GcodeDocument): void {
    this.groupScope = null;
    this.project = null;
    this.gcode = doc;
    this.selection = new Set();
    this.history.clear();
    this.historyTick++;
    this.dirty = false;
    this.fileName = doc.name;
    this.fileHandle = null;
    this.view = 'preview';
  }

  close(): void {
    this.groupScope = null;
    this.project = null;
    this.gcode = null;
    this.selection = new Set();
    this.history.clear();
    this.historyTick++;
    this.dirty = false;
    this.fileName = null;
    this.fileHandle = null;
    this.view = 'design';
  }

  /** Opens Bitmap mode on one image: its engraving preview, tone and color separation. */
  editImage(id: Id): void {
    this.select([id]);
    this.view = 'bitmap';
  }

  select(ids: Iterable<Id>, mode: 'replace' | 'toggle' | 'add' = 'replace'): void {
    const next = mode === 'replace' ? new Set<Id>() : new Set(this.selection);
    const expanded = new Set<Id>();
    for (const id of ids) {
      if (!this.inScope(id)) continue;
      const unit = this.scopeUnit(id);
      const leaves = this.project ? groupLeaves(this.project, unit) : [unit];
      if (unit !== id && this.project?.objects.some((o) => leaves.includes(o.id) && o.locked)) continue;
      for (const leaf of leaves) expanded.add(leaf);
    }
    for (const id of expanded) {
      if (mode === 'toggle' && next.has(id)) next.delete(id);
      else next.add(id);
    }
    this.selection = next;
    // Selecting objects on one layer makes it the active layer, so its settings show.
    const first = this.project?.objects.find((o) => next.has(o.id));
    if (first) this.activeLayerId = first.layerId;
  }

  inScope(id: Id): boolean {
    return !this.groupScope || (!!this.project && groupLeaves(this.project, this.groupScope).includes(id));
  }

  scopeUnit(id: Id): Id {
    const groups = this.project?.groups ?? [];
    let unit = id;
    let parent = groups.find((g) => g.children.includes(unit));
    while (parent && parent.id !== this.groupScope) {
      unit = parent.id;
      parent = groups.find((g) => g.children.includes(unit));
    }
    return unit;
  }

  get selectedUnits(): Id[] {
    return [...new Set([...this.selection].map((id) => this.scopeUnit(id)))];
  }

  get selectedGroup(): Id | null {
    const units = this.selectedUnits;
    return units.length === 1 && this.project?.groups?.some((g) => g.id === units[0]) ? units[0] : null;
  }

  enterGroup(id: Id): void {
    if (!this.project?.groups?.some((g) => g.id === id)) return;
    this.groupScope = id;
    this.clearSelection();
    this.tool = 'select';
  }

  exitGroup(): void {
    const id = this.groupScope;
    this.groupScope = this.project?.groups?.find((g) => g.children.includes(id!))?.id ?? null;
    this.clearSelection();
  }

  selectAll(): void {
    this.select(this.project?.objects.filter((o) => o.visible && !o.locked).map((o) => o.id) ?? []);
  }

  clearSelection(): void {
    if (this.selection.size) this.selection = new Set();
  }

  /**
   * The layer new art of this mode goes on: the active layer when it fits, else the first such
   * layer, else a new one. A new layer is returned uncommitted, so it is added in the same step as
   * its objects and one undo removes both.
   */
  layerFor(mode: LayerMode): { id: Id; created: Layer | null } {
    const project = this.project;
    if (!project) throw new Error('No project is open.');
    const active = this.activeLayer;
    if (active && (active.mode === mode || (mode !== 'image' && active.mode !== 'image')))
      return { id: active.id, created: null };
    const existing = project.layers.find((l) => l.mode === mode);
    if (existing) return { id: existing.id, created: null };
    const layer = this.makeLayer(mode);
    return { id: layer.id, created: layer };
  }

  /**
   * A new image layer, uncommitted (it is added with its first image, as one undo step). It
   * starts from the engraving settings of the last image layer, if there is one.
   */
  newImageLayer(name?: string): Layer {
    const last = this.project?.layers.findLast((l) => l.mode === 'image');
    const layer = last ? { ...this.layerLike(last), visible: true, output: true } : this.makeLayer('image');
    return name?.trim() ? { ...layer, name: name.trim() } : layer;
  }

  /** A new layer with `source`'s engraving settings and its own id, name and color. */
  layerLike(source: Layer): Layer {
    const fresh = this.makeLayer(source.mode);
    return { ...source, id: fresh.id, name: fresh.name, color: fresh.color };
  }

  /**
   * Moves one object off a shared layer onto a copy of it placed right after, so its settings can
   * change without changing the others'. One undo step. Returns the new layer.
   */
  ownLayer(objectId: Id): Layer | null {
    const project = this.project;
    const object = project?.objects.find((o) => o.id === objectId);
    const index = project?.layers.findIndex((l) => l.id === object?.layerId) ?? -1;
    if (!project || !object || index < 0) return null;
    const layer = this.layerLike(project.layers[index]);
    this.commit((p) => ops.setObjectsLayer(ops.addLayer(p, layer, index + 1), new Set([objectId]), layer.id));
    this.sealHistory();
    this.activeLayerId = layer.id;
    return layer;
  }

  /**
   * Adds new objects (built for their layer) and their layer if it is new, as one undo step.
   * `target` is where they go: `layerFor(mode)` unless given.
   */
  addOnLayer<T extends SceneObject>(
    mode: LayerMode,
    build: (layerId: Id) => T[],
    assets: Asset[] = [],
    target?: { id: Id; created: Layer | null },
  ): T[] {
    const { id, created } = target ?? this.layerFor(mode);
    const objects = build(id);
    if (objects.length === 0) return objects;
    this.commit((p) => ops.addObjects(created ? ops.addLayer(p, created) : p, objects, assets));
    this.activeLayerId = id;
    this.select(objects.map((o) => o.id));
    return objects;
  }

  /** Adds an empty layer and makes it active; objects are dragged onto it in the Layers panel. */
  addLayer(mode: LayerMode): Layer {
    const layer = this.makeLayer(mode);
    this.commit((p) => ops.addLayer(p, layer));
    this.activeLayerId = layer.id;
    return layer;
  }

  makeLayer(mode: LayerMode, color?: string): Layer {
    const used = new Set(this.project?.layers.map((l) => l.color.toLowerCase()) ?? []);
    const preferred = color ?? MODE_COLORS[mode];
    const pick = used.has(preferred.toLowerCase())
      ? (LAYER_PALETTE.find((p) => !used.has(p.color.toLowerCase()))?.color ?? preferred)
      : preferred;
    return defaultLayer({ id: makeId(), mode, color: pick, name: nextLayerName(this.project?.layers ?? []) });
  }
}

export const editor = new Editor();
