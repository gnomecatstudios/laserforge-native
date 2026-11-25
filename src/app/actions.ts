/**
 * User-level commands shared by buttons, menus, shortcuts and drag-and-drop. Each one reports its
 * outcome with a toast instead of throwing.
 */
import { PROJECT_EXTENSION } from '$lib/config/app';
import { multiply, translation } from 'libopenlaser/geometry';
import { decodeImage, defaultImageSize, readImageDpi, sniffImageMime } from 'libopenlaser/import';
import { parseDxf } from 'libopenlaser/import';
import {
  importSvg,
  buildProjectObjectsFromSvg,
  type SvgColorGroup,
  type SvgImportResult,
} from 'libopenlaser/import';
import { makeId } from 'libopenlaser/project';
import { addLayer, addObjects } from 'libopenlaser/project';
import { deserializeProject, serializeProject } from 'libopenlaser/project';
import type { Asset, Id, ImageObject, Layer, SceneObject } from 'libopenlaser/project';
import { nextLayerName } from 'libopenlaser/project';
import {
  IMAGE_FILES,
  VECTOR_FILES,
  type FileKind,
  GCODE_FILES,
  PROJECT_FILES,
  extensionOf,
  openFiles,
  safeFileName,
  saveFileAs,
  writeToHandle,
} from '$lib/storage/files';
import { errorMessage, reportError } from '$lib/ui/errors';
import { toast } from '$lib/ui/toasts.svelte';
import { extractInkInWorker, parseGcodeInWorker } from './lib/cam-client';
import { placeInk } from './lib/ink-place';
import { baseName } from './lib/file-name';
import { activeAdapter, DEFAULT_ADAPTER } from './machines/registry';
import { exportGcode } from './machines/grbl/export';
import { imagePlacement, placeCentered } from './lib/placement';
import { commandFor, fileKind, looksLikeProject, type FileKindId } from './lib/file-kind';
import { boundsOf } from './lib/selection';
import { canvas } from './state/canvas.svelte';
import { editor } from './state/editor.svelte';
import { imageLayerQuestion, type ImageLayerChoice } from './state/image-layer.svelte';
import { preview } from './state/preview.svelte';
import { profiles } from './state/profiles.svelte';
import { session } from './state/session.svelte';
import { currentBed } from './state/work-area';
import { ui } from './state/ui.svelte';

function bedFrame() {
  return currentBed();
}

// ------------------------------------------------------------------ documents

export function newProject(name?: string): void {
  if (editor.project) void session.flush();
  editor.newProject(profiles.active.id, name);
  preview.reset();
  canvas.fit(bedFrame());
}

export function closeDocument(): void {
  if (editor.project) void session.flush();
  editor.close();
  preview.reset();
  void session.rememberOpen(null);
  void session.refreshRecents();
}

export async function openRecent(id: Id): Promise<void> {
  try {
    const project = await session.openRecent(id);
    if (!project) {
      toast.error('That project is no longer stored in this browser.');
      await session.forget(id);
      return;
    }
    editor.open(project);
    session.markSaved(project);
    preview.reset();
    canvas.fit(bedFrame());
  } catch (error) {
    toast.error(`Could not open the project: ${errorMessage(error)}`);
  }
}

/** Open: .olaser projects and G-code files. Images (SVG included) come in through the Image tool. */
export async function openFile(): Promise<void> {
  try {
    const [opened] = await openFiles([PROJECT_FILES, GCODE_FILES], { id: 'projects' });
    if (!opened) return;
    const kind = fileKind(opened.name);
    if (kind === 'project' || kind === 'gcode') {
      await importFiles([{ file: opened.file, handle: opened.handle }], ['project', 'gcode']);
      return;
    }
    // A file that lost its extension: projects are zips (or Laser Forge JSON); anything else is G-code text.
    const head = new Uint8Array(await opened.file.slice(0, 64).arrayBuffer());
    if (looksLikeProject(head)) await openProjectFromFile(opened.file, opened.handle);
    else await openGcodeText(opened.name, await opened.file.text());
  } catch (error) {
    toast.error(`Could not open the file: ${errorMessage(error)}`);
  }
}

async function openProjectFromFile(file: File, handle?: FileSystemFileHandle): Promise<void> {
  const project = await deserializeProject(new Uint8Array(await file.arrayBuffer()));
  if (editor.project) await session.flush();
  editor.open(project, { name: file.name, handle: handle ?? null });
  preview.reset();
  canvas.fit(bedFrame());
  await session.flush(project);
  toast.success(`Opened ${project.name}`);
}

export async function saveProject(): Promise<void> {
  const project = editor.project;
  if (!project) return;
  if (!editor.fileHandle) return saveProjectAs();
  try {
    const bytes = await serializeProject(project);
    const ok = await writeToHandle(
      editor.fileHandle,
      new Blob([bytes as BlobPart], { type: 'application/zip' }),
    );
    if (!ok) return saveProjectAs();
    editor.dirty = false;
    toast.success(`Saved ${editor.fileName ?? project.name}`);
  } catch (error) {
    toast.error(`Could not save: ${errorMessage(error)}`);
  }
}

export async function saveProjectAs(): Promise<void> {
  const project = editor.project;
  if (!project) return;
  try {
    const bytes = await serializeProject(project);
    const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
    const outcome = await saveFileAs(safeFileName(project.name, PROJECT_EXTENSION), blob, PROJECT_FILES, {
      id: 'projects',
    });
    if (outcome.status === 'saved') {
      editor.fileHandle = outcome.handle;
      editor.fileName = outcome.handle.name;
      editor.dirty = false;
      toast.success(`Saved ${outcome.handle.name}`);
    } else if (outcome.status === 'downloaded') {
      editor.dirty = false;
      toast.success('Project downloaded');
    } else if (outcome.status === 'failed') {
      toast.error(outcome.reason);
    }
  } catch (error) {
    toast.error(`Could not save: ${errorMessage(error)}`);
  }
}

// ------------------------------------------------------------------ import

async function pickAndImport(
  kinds: FileKind[],
  allow: FileKindId[],
  id: string,
  options: ImportOptions = {},
): Promise<void> {
  try {
    const files = await openFiles(kinds, { multiple: true, id });
    await importFiles(
      files.map((f) => ({ file: f.file, handle: f.handle })),
      allow,
      options,
    );
  } catch (error) {
    toast.error(`Could not import: ${errorMessage(error)}`);
  }
}

/** The Image tool, ⌘I and the start screen: SVG and raster images. */
export function importArt(): Promise<void> {
  return pickAndImport([VECTOR_FILES, IMAGE_FILES], ['vector', 'image'], 'art');
}

/**
 * Import a drawing (⌘⌥I): photos of pen or marker drawings, each cleaned down to its ink as it
 * arrives (ink only mode), as the phone scanner's switch does. Shares the Image tool's folder.
 */
export function importDrawing(): Promise<void> {
  return pickAndImport([IMAGE_FILES], ['image'], 'art', { inkOnly: true });
}

export interface ImportOptions {
  /** Clean each imported photo down to its pen or marker ink (see `keepOnlyInk`). */
  inkOnly?: boolean;
  /** Where images go. Unset, the import asks (see ImageLayerDialog). */
  layer?: ImageLayerChoice;
}

const ALL_KINDS: FileKindId[] = ['project', 'gcode', 'vector', 'image'];

/**
 * Routes files by kind: projects open, G-code goes to the sender, art is added to the project.
 * `allow` limits what a command takes (drag and drop takes everything).
 */
export async function importFiles(
  files: Array<{ file: File; handle?: FileSystemFileHandle }>,
  allow: FileKindId[] = ALL_KINDS,
  options: ImportOptions = {},
): Promise<void> {
  // Images are gathered so one question covers them all.
  const images: File[] = [];
  for (const { file, handle } of files) {
    const kind = fileKind(file.name, file.type);
    try {
      if (!kind || !allow.includes(kind)) {
        toast.warning(`${file.name} goes through ${commandFor(kind)}.`);
        continue;
      }
      if (kind === 'project') await openProjectFromFile(file, handle);
      else if (kind === 'gcode') await openGcodeText(file.name, await file.text());
      else if (kind === 'vector') await beginVectorImport(file.name, await file.text());
      else images.push(file);
    } catch (error) {
      reportError(error, 'Import');
      toast.error(`Could not import ${file.name}: ${errorMessage(error)}`);
    }
  }
  if (images.length) await importImages(images, options);
}

/** Asks which layer (unless `options.layer` says), then adds each image there. */
async function importImages(files: File[], options: ImportOptions): Promise<void> {
  ensureProject(files[0].name);
  const choice =
    options.layer ??
    (await imageLayerQuestion.ask(
      files.map((f) => f.name),
      !!options.inkOnly,
    ));
  if (!choice) return;
  /** The one new layer for all, once the first image has created it. */
  let shared: Id | null = null;
  const target = (): { id: Id; created: Layer | null } => {
    if (choice.kind === 'layer') {
      const layer = editor.project?.layers.find((l) => l.id === choice.id && l.mode === 'image');
      if (layer) return { id: layer.id, created: null };
    } else if (choice.kind === 'new' && shared) {
      if (editor.project?.layers.some((l) => l.id === shared)) return { id: shared, created: null };
    }
    const created = editor.newImageLayer(choice.kind === 'new' ? choice.name : undefined);
    if (choice.kind === 'new') shared = created.id;
    return { id: created.id, created };
  };
  for (const file of files) {
    try {
      const id = await importImage(file, target);
      // Its own undo step after the import, so undo brings the full photo back.
      if (options.inkOnly) await keepOnlyInk(id);
    } catch (error) {
      reportError(error, 'Import');
      toast.error(`Could not import ${file.name}: ${errorMessage(error)}`);
    }
  }
}

function ensureProject(nameHint: string): void {
  if (!editor.project) newProject(baseName(nameHint));
}

async function beginVectorImport(fileName: string, text: string): Promise<void> {
  const pending =
    extensionOf(fileName) === '.dxf'
      ? { format: 'dxf' as const, fileName, drawing: parseDxf(text) }
      : { format: 'svg' as const, fileName, text, result: importSvg(text) };
  ensureProject(fileName);
  ui.vectorImport = pending;
}

/** Finishes an SVG or DXF import with the dialog's result and its color → layer id (or 'new') choices. */
export function completeVectorImport(result: SvgImportResult, mapping: Map<SvgColorGroup, Id | 'new'>): void {
  const pending = ui.vectorImport;
  ui.vectorImport = null;
  const project = editor.project;
  if (!pending || !project) return;
  try {
    const byKey = new Map([...mapping].map(([g, id]) => [`${g.kind}:${g.color}`, id]));
    const built = buildProjectObjectsFromSvg(result, project.layers, makeId, {
      layerName: nextLayerName,
      name: baseName(pending.fileName),
      layerFor: (group) => {
        const choice = byKey.get(`${group.kind}:${group.color}`);
        return choice && choice !== 'new' ? choice : undefined;
      },
    });
    if (built.objects.length === 0) {
      toast.warning('The drawing has no shapes Laser Forge can engrave.');
      return;
    }
    const content = boundsOf(built.objects);
    const placement = content ? placeCentered(bedFrame(), content) : translation(0, 0);
    const objects = built.objects.map(
      (o) => ({ ...o, transform: multiply(placement, o.transform) }) as SceneObject,
    );
    editor.commit((p) => {
      let next = p;
      for (const layer of built.layersToAdd) next = addLayer(next, layer);
      return addObjects(next, objects, built.assets);
    });
    editor.select(objects.map((o) => o.id));
    const ignored = Object.entries(result.ignored);
    if (ignored.length) toast.warning(`Skipped: ${ignored.map(([k, n]) => `${n} ${k}`).join(', ')}`);
  } catch (error) {
    toast.error(`Could not import ${pending.fileName}: ${errorMessage(error)}`);
  }
}

export function cancelVectorImport(): void {
  ui.vectorImport = null;
}

/** Imports one photo, cleaned up to its pen or marker ink with `inkOnly`. */
export function importPhoto(file: File, options: ImportOptions = {}): Promise<void> {
  return importFiles([{ file }], ['image'], options);
}

/**
 * Ink only mode: keeps only the ink of a photographed drawing. Shadows, uneven light and paper texture go, and
 * the image becomes black ink on transparency, cropped to the drawing where it was on the photo.
 */
export async function keepOnlyInk(imageId: Id): Promise<boolean> {
  const before = editor.project;
  const image = before?.objects.find((o): o is ImageObject => o.id === imageId && o.kind === 'image');
  const asset = image && before?.assets[image.assetId];
  if (!image || !asset) return false;
  try {
    const result = await extractInkInWorker({ assetId: asset.id, blob: asset.data });
    if (!result.ink) {
      toast.warning(`No pen or marker lines were found in ${image.name}.`);
      return false;
    }
    // The image may have been deleted or replaced while the worker ran.
    const now = editor.project?.objects.find((o) => o.id === imageId);
    if (!now || now.kind !== 'image' || now.assetId !== asset.id) return false;
    editor.commit((p) => placeInk(p, imageId, result, makeId));
    return true;
  } catch (error) {
    reportError(error, 'Ink only mode');
    toast.error(`Could not clean up ${image.name}: ${errorMessage(error)}`);
    return false;
  }
}

/** Adds one image on the layer `target` gives, asked once the image has decoded. */
async function importImage(file: File, target: () => { id: Id; created: Layer | null }): Promise<Id> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(bytes) ?? file.type;
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const raster = await decodeImage(blob);
  const bed = bedFrame();
  const size = defaultImageSize(raster, readImageDpi(bytes), bed);
  ensureProject(file.name);
  const asset: Asset = {
    id: makeId(),
    mime,
    name: file.name,
    data: blob,
    widthPx: raster.width,
    heightPx: raster.height,
  };
  const [object] = editor.addOnLayer(
    'image',
    (layerId): ImageObject[] => [
      {
        id: makeId(),
        kind: 'image',
        layerId,
        name: file.name,
        locked: false,
        visible: true,
        // Centred and upright on screen, whatever corner the machine homes in.
        transform: imagePlacement(bed, size),
        assetId: asset.id,
        width: size.width,
        height: size.height,
      },
    ],
    [asset],
    target(),
  );
  if (size.clamped) toast.info(`${file.name} was scaled down to fit the bed.`);
  return object.id;
}

export async function openGcodeText(name: string, text: string): Promise<void> {
  const parsed = await parseGcodeInWorker(text, profiles.active.maxS);
  if (editor.project) await session.flush();
  editor.openGcode({ name, lines: parsed.lines, moves: parsed.moves });
  preview.reset();
  if (parsed.moves.bounds) canvas.fitTo(bedFrame(), parsed.moves.bounds);
  if (parsed.longLines.length) {
    toast.warning(`${parsed.longLines.length} lines are 80 characters or longer. GRBL rejects them.`);
  }
}

// ------------------------------------------------------------------ export and print

/** Export in the selected machine's format. An opened G-code file stays G-code, whatever the machine. */
export function exportJob(): Promise<void> {
  return editor.project ? activeAdapter().exportJob() : exportGcode();
}

export function printDesign(): void {
  if (!editor.project || editor.project.objects.length === 0) {
    toast.info('Add something to the bed to print a template.');
    return;
  }
  ui.printOpen = true;
}

// ------------------------------------------------------------------ editing

export {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  nudge,
  paste,
} from './edit-actions';

export function zoomToSelection(): void {
  const project = editor.project;
  const bounds = project ? boundsOf(project.objects.filter((o) => editor.selection.has(o.id))) : null;
  if (bounds) canvas.fitTo(bedFrame(), bounds);
  else canvas.fit(bedFrame());
}

// ------------------------------------------------------------------ machine

/** Start screen: a blank project to work in, unless one is open. */
export function ensureDocument(): void {
  if (!editor.hasDocument) newProject();
}

/** Start screen: a blank project and the selected machine's virtual device. */
export async function startWithVirtualMachine(): Promise<void> {
  ensureDocument();
  // Machines without a live link (Ruida) fall back to the default machine, as before.
  const live = activeAdapter().live ?? DEFAULT_ADAPTER.live;
  const transport = live?.transports.find((t) => t.virtual);
  if (live && transport) await live.session.connect(transport.kind);
}

/** Opens the Trace dialog for the selected image (or the only image when nothing is selected). */
export function traceSelectedImage(): void {
  const project = editor.project;
  if (!project) return;
  const images = project.objects.filter((o) => o.kind === 'image');
  const selected = images.filter((o) => editor.selection.has(o.id));
  const target = selected.length === 1 ? selected[0] : images.length === 1 ? images[0] : null;
  if (!target) {
    toast.info(images.length ? 'Select the image to trace.' : 'Import an image to trace it.');
    return;
  }
  ui.traceImageId = target.id;
}
