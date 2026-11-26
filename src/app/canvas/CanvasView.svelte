<script lang="ts">
  import { groupLeaves } from 'libopenlaser/project';
  import { currentBed } from '../state/work-area';
  import { onMount } from 'svelte';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import Maximize from '@lucide/svelte/icons/maximize';
  import { IDENTITY, apply, multiply, rotationAbout, translation } from 'libopenlaser/geometry';
  import type { Mat2D, Rect, Vec2 } from 'libopenlaser/geometry';
  import { setObjectTransforms, transformObjects } from 'libopenlaser/project';
  import { makeId } from 'libopenlaser/project';
  import type { Id, SceneObject } from 'libopenlaser/project';
  import { editor } from '../state/editor.svelte';
  import { canvas } from '../state/canvas.svelte';
  import { preview } from '../state/preview.svelte';
  import { machine } from '../state/machine.svelte';
  import { boundsOf, resizeAbout, selectedObjects } from '../lib/selection';
  import { bedRectToScreen, bedToScreen, screenToBed, zoomAt, type BedFrame } from './viewport';
  import {
    drawBed,
    drawDashedRect,
    drawLaserHead,
    drawJobGhost,
    drawObjectHighlight,
    drawObjects,
    drawRulers,
    readPalette,
    screenPath,
  } from './scene-render';
  import { drawGuides, drawMeasure, drawSelection, drawShapeGhost } from './overlays';
  import { SNAP_PX, snapMove, translateRect, type Guide } from './guides';
  import { hitObject } from './hit-test';
  import { drawPreview, headAt, previewGeometry } from './preview-render';
  import {
    angleAround,
    handlesFor,
    hitHandle,
    normalizeRect,
    oppositeHandle,
    scaleFromDrag,
    selectionBox,
    snapAngle,
    type Handle,
    type HandleId,
  } from './handles';
  import { ImageLooks } from './image-cache';
  import { cursorFor, marqueeHits, shapeObject, type DrawnShape } from './tools';
  import { textOutlines } from '../state/text.svelte';
  import { ui } from '../state/ui.svelte';
  import TextEditOverlay from './TextEditOverlay.svelte';
  import NodeEditor from './NodeEditor.svelte';
  import { pathNodes } from './node-edit';
  import { editableVectors, nodeSelection } from '../state/nodes.svelte';
  import PenOverlay from './PenOverlay.svelte';
  import { pen } from '../state/pen.svelte';
  import CanvasContextMenu from './CanvasContextMenu.svelte';
  import BedWarning from './BedWarning.svelte';
  import ErrorBoundary from '$lib/ui/ErrorBoundary.svelte';

  let host: HTMLDivElement;
  let el: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let frame = 0;
  let spaceHeld = $state(false);
  let hoverHandle = $state<HandleId | null>(null);

  const images = new ImageLooks(() => invalidate());

  // A fitted rotary or slide brings its own work area.
  const bed: BedFrame = $derived(currentBed());

  type Drag =
    | { kind: 'pan'; x: number; y: number; offsetX: number; offsetY: number }
    | {
        kind: 'move';
        start: Vec2;
        originals: Map<Id, Mat2D>;
        moved: boolean;
        /** The selection's box at the start, and what it can line up with. */
        box: Rect | null;
        targets: Rect[];
      }
    | {
        kind: 'scale';
        handle: Exclude<HandleId, 'rotate'>;
        pivot: Vec2;
        start: Vec2;
        originals: Map<Id, Mat2D>;
      }
    | { kind: 'rotate'; center: Vec2; startAngle: number; originals: Map<Id, Mat2D> }
    | {
        kind: 'marquee';
        start: Vec2;
        current: Vec2;
        additive: boolean;
        /** Node tool: the box picks path nodes; a plain click with `clearOnClick` deselects. */
        nodes?: { clearOnClick: boolean };
      }
    | { kind: 'shape'; shape: DrawnShape; start: Vec2; current: Vec2 }
    | { kind: 'measure' };

  let drag = $state.raw<Drag | null>(null);
  let guides = $state.raw<Guide[]>([]);

  const designing = $derived(editor.view === 'design' && editor.project !== null && editor.gcode === null);
  const selection = $derived(
    editor.project && designing ? selectedObjects(editor.project, editor.selection) : [],
  );
  const selectionBounds = $derived(boundsOf(selection));
  const sizeBox = $derived(
    selectionBounds ? selectionBox(bedRectToScreen(canvas.view, bed, selectionBounds)) : null,
  );
  const canResize = $derived(selection.length > 0 && selection.every((o) => !o.locked));

  function editSize(event: Event, axis: 'width' | 'height') {
    const input = event.currentTarget as HTMLInputElement;
    const value = Number(input.value);
    const bounds = selectionBounds;
    if (!bounds || !canResize) return;
    const old = axis === 'width' ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY;
    if (!Number.isFinite(value) || value < 0.01 || old <= 0) {
      input.value = old.toFixed(3);
      return;
    }
    if (Math.abs(value - old) < 1e-9) return;
    const matrix = resizeAbout(bounds, editor.anchor, { [axis]: value }, editor.keepAspect);
    editor.commit((p) => transformObjects(p, editor.selection, matrix));
    editor.sealHistory();
  }

  function sizeKey(event: KeyboardEvent, current: number) {
    event.stopPropagation();
    const input = event.currentTarget as HTMLInputElement;
    if (event.key === 'Escape') {
      input.value = current.toFixed(3);
      input.blur();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
  }

  const rotatable = $derived(selection.length > 0);
  /** Objects that glow because their row in the Layers panel is hovered. */
  const highlighted = $derived.by((): ReadonlySet<string> => {
    if (ui.hoverObjectId) return new Set([ui.hoverObjectId]);
    const layerId = ui.hoverLayerId;
    if (!layerId || !editor.project) return new Set();
    return new Set(editor.project.objects.filter((o) => o.layerId === layerId).map((o) => o.id));
  });

  function invalidate() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  $effect(() => {
    // Everything the picture depends on; reading it registers the dependency.
    void [
      editor.project,
      editor.selection,
      editor.view,
      editor.gcode,
      canvas.view,
      canvas.size,
      canvas.measure,
      canvas.outlinePreview,
      canvas.layoutPreview,
      canvas.editingTextId,
      bed,
      drag,
      guides,
    ];
    void [preview.result, preview.scrub, machine.headPosition, machine.jobOffset, hoverHandle, highlighted];
    invalidate();
  });

  function selectionHandles(): Handle[] {
    if (!selectionBounds) return [];
    return handlesFor(selectionBox(bedRectToScreen(canvas.view, bed, selectionBounds)), rotatable);
  }

  function draw() {
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const palette = readPalette(el);
    bedColor = palette.bed;
    drawBed(ctx, canvas.view, bed, palette, canvas.size);

    const project = editor.project;
    const moves = editor.gcode?.moves ?? (editor.view === 'preview' ? preview.result?.moves : undefined);
    if (editor.view === 'preview' || editor.gcode) {
      if (moves) {
        const geometry = previewGeometry(moves);
        const upTo = preview.scrub ?? moves.count;
        drawPreview(ctx, geometry, upTo, canvas.view, bed, {
          burnLow: palette.signalSoft,
          burnHigh: palette.signal,
          travel: palette.beam,
        });
        if (preview.scrub !== null) {
          const at = headAt(moves, upTo);
          if (at) drawLaserHead(ctx, bedToScreen(canvas.view, bed, at), palette);
        }
      }
    } else if (project) {
      drawObjects(
        ctx,
        project,
        canvas.view,
        bed,
        (object, layer) => images.look(object, layer, project.assets[object.assetId]),
        palette,
        canvas.editingTextId,
      );
      if (canvas.layoutPreview.length) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        drawObjects(
          ctx,
          { ...project, objects: canvas.layoutPreview },
          canvas.view,
          bed,
          (object, layer) => images.look(object, layer, project.assets[object.assetId]),
          palette,
          null,
        );
        ctx.restore();
      }
      const offset = machine.jobOffset;
      if (offset && (offset.x !== 0 || offset.y !== 0))
        drawJobGhost(ctx, project, offset, canvas.view, bed, palette);
      if (highlighted.size) drawObjectHighlight(ctx, project, highlighted, canvas.view, bed, palette);
      if (selectionBounds && editor.tool !== 'node') {
        const box = selectionBox(bedRectToScreen(canvas.view, bed, selectionBounds));
        drawSelection(ctx, box, selectionHandles(), palette);
      }
    }

    drawGuides(ctx, canvas.view, bed, guides, palette.signal);
    if (drag?.kind === 'marquee')
      drawDashedRect(ctx, normalizeRect(drag.start, drag.current), palette.beam, 0.08);
    if (drag?.kind === 'shape') {
      if (typeof drag.shape === 'string')
        drawShapeGhost(ctx, canvas.view, bed, drag.shape, drag.start, drag.current, palette.signal);
      else {
        // Library shapes preview with their real outline.
        const ghost = shapeObject(drag.shape, normalizeRect(drag.start, drag.current), '', '', bed);
        if (ghost) {
          ctx.strokeStyle = palette.signal;
          ctx.lineWidth = 1.4;
          ctx.stroke(screenPath(ghost, canvas.view, bed));
        }
      }
    }
    if (canvas.outlinePreview?.length) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = palette.signal;
      ctx.lineWidth = 1.5;
      ctx.stroke(screenPath({ paths: canvas.outlinePreview, transform: IDENTITY }, canvas.view, bed));
      ctx.restore();
    }
    if (canvas.measure) drawMeasure(ctx, canvas.view, bed, canvas.measure.from, canvas.measure.to, palette);

    const head = machine.headPosition;
    if (head && preview.scrub === null) drawLaserHead(ctx, bedToScreen(canvas.view, bed, head), palette);
    drawRulers(ctx, canvas.view, bed, palette, { width, height });
  }

  // ---------------------------------------------------------------- input

  function local(event: { clientX: number; clientY: number }): Vec2 {
    const r = el.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }

  function hitAt(screen: Vec2): SceneObject | null {
    if (!editor.project || !ctx) return null;
    const scoped = editor.groupScope
      ? { ...editor.project, objects: editor.project.objects.filter((o) => editor.inScope(o.id)) }
      : editor.project;
    return (
      hitObject(ctx, scoped, canvas.view, bed, screen) ??
      (editor.groupScope ? hitObject(ctx, editor.project, canvas.view, bed, screen) : null)
    );
  }

  /** Boxes a moved selection lines up with: the other visible objects and the bed. */
  function snapTargets(): Rect[] {
    const others = (editor.project?.objects ?? []).filter((o) => o.visible && !editor.selection.has(o.id));
    const boxes = others.flatMap((o) => boundsOf([o]) ?? []);
    return [...boxes, { minX: 0, minY: 0, maxX: bed.width, maxY: bed.height }];
  }

  function originals(): Map<Id, Mat2D> {
    return new Map(selection.filter((o) => !o.locked).map((o) => [o.id, o.transform]));
  }

  function commitTransforms(source: Map<Id, Mat2D>, matrix: Mat2D) {
    const next = new Map<Id, Mat2D>();
    for (const [id, t] of source) next.set(id, multiply(matrix, t));
    editor.commit((p) => setObjectTransforms(p, next), { coalesce: 'canvas-drag' });
  }

  function onpointerdown(event: PointerEvent) {
    el.focus({ preventScroll: true });
    const screen = local(event);
    const bedPoint = screenToBed(canvas.view, bed, screen);
    const panning =
      event.button === 1 || spaceHeld || editor.tool === 'pan' || (!designing && editor.tool !== 'measure');
    if (event.button !== 0 && event.button !== 1) return;
    el.setPointerCapture(event.pointerId);
    if (panning) {
      drag = {
        kind: 'pan',
        x: event.clientX,
        y: event.clientY,
        offsetX: canvas.view.offsetX,
        offsetY: canvas.view.offsetY,
      };
      return;
    }
    if (editor.tool === 'pen') {
      const first = pen.points[0];
      if (
        first &&
        pen.points.length >= 3 &&
        Math.hypot(first.x - bedPoint.x, first.y - bedPoint.y) * canvas.view.zoom < 10
      )
        pen.finish(true);
      else pen.add(bedPoint);
      return;
    }
    if (editor.tool === 'node') {
      const hit = hitAt(screen);
      const editing = hit?.kind === 'vector' && !hit.locked && editor.selection.has(hit.id);
      if (hit?.kind === 'vector' && !hit.locked && !editing) {
        editor.select([hit.id], event.shiftKey ? 'toggle' : 'replace');
        nodeSelection.clear();
        return;
      }
      // Empty space or the shape being edited: drag a box to pick its nodes.
      drag = {
        kind: 'marquee',
        start: screen,
        current: screen,
        additive: event.shiftKey,
        nodes: { clearOnClick: !editing },
      };
      return;
    }
    if (editor.tool === 'measure') {
      canvas.measure = { from: bedPoint, to: bedPoint };
      drag = { kind: 'measure' };
      return;
    }
    if (editor.tool === 'rect' || editor.tool === 'ellipse' || editor.tool === 'shape') {
      const shape: DrawnShape = editor.tool === 'shape' ? { library: editor.shapeKind } : editor.tool;
      drag = { kind: 'shape', shape, start: bedPoint, current: bedPoint };
      return;
    }
    if (editor.tool === 'text') {
      // Keep the browser from focusing the canvas on mouse-down, which would steal the caret.
      event.preventDefault();
      el.releasePointerCapture(event.pointerId);
      canvas.editText(textOutlines.create(bedPoint, bed), true);
      editor.tool = 'select';
      return;
    }
    const handle = hitHandle(screen, selectionHandles());
    if (handle && selectionBounds) {
      if (handle.id === 'rotate') {
        const center = {
          x: (selectionBounds.minX + selectionBounds.maxX) / 2,
          y: (selectionBounds.minY + selectionBounds.maxY) / 2,
        };
        drag = { kind: 'rotate', center, startAngle: angleAround(center, bedPoint), originals: originals() };
      } else {
        const box = selectionBox(bedRectToScreen(canvas.view, bed, selectionBounds));
        const handles = handlesFor(box, false);
        const opposite = handles.find(
          (h) => h.id === oppositeHandle(handle.id as Exclude<HandleId, 'rotate'>),
        )!;
        const pivot = screenToBed(canvas.view, bed, opposite);
        const start = screenToBed(canvas.view, bed, handle);
        drag = {
          kind: 'scale',
          handle: handle.id as Exclude<HandleId, 'rotate'>,
          pivot,
          start,
          originals: originals(),
        };
      }
      return;
    }
    const hit = hitAt(screen);
    if (hit && !editor.inScope(hit.id)) {
      editor.exitGroup();
      return;
    }
    if (!hit && editor.groupScope && editor.project) {
      const ids = new Set(groupLeaves(editor.project, editor.groupScope));
      const bounds = boundsOf(editor.project.objects.filter((o) => ids.has(o.id)));
      if (
        !bounds ||
        bedPoint.x < bounds.minX ||
        bedPoint.x > bounds.maxX ||
        bedPoint.y < bounds.minY ||
        bedPoint.y > bounds.maxY
      ) {
        editor.exitGroup();
        return;
      }
    }
    if (hit) {
      if (event.shiftKey) editor.select([hit.id], 'toggle');
      else if (!editor.selection.has(hit.id)) editor.select([hit.id]);
      drag = {
        kind: 'move',
        start: bedPoint,
        originals: originals(),
        moved: false,
        box: selectionBounds,
        targets: snapTargets(),
      };
    } else {
      if (!event.shiftKey) editor.clearSelection();
      drag = { kind: 'marquee', start: screen, current: screen, additive: event.shiftKey };
    }
  }

  function onpointermove(event: PointerEvent) {
    const screen = local(event);
    const bedPoint = screenToBed(canvas.view, bed, screen);
    canvas.cursor = bedPoint;
    const d = drag;
    if (!d) {
      hoverHandle =
        designing && editor.tool === 'select' ? (hitHandle(screen, selectionHandles())?.id ?? null) : null;
      return;
    }
    switch (d.kind) {
      case 'pan':
        canvas.view = {
          ...canvas.view,
          offsetX: d.offsetX + event.clientX - d.x,
          offsetY: d.offsetY + event.clientY - d.y,
        };
        break;
      case 'move': {
        let dx = bedPoint.x - d.start.x;
        let dy = bedPoint.y - d.start.y;
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (!d.moved && Math.hypot(dx, dy) * canvas.view.zoom < 3) return;
        d.moved = true;
        // Alt moves freely; otherwise edges and centres snap to the other objects and the bed.
        const snap =
          d.box && !event.altKey
            ? snapMove(translateRect(d.box, dx, dy), d.targets, SNAP_PX / canvas.view.zoom, {
                x: event.shiftKey && dx === 0,
                y: event.shiftKey && dy === 0,
              })
            : null;
        guides = snap?.guides ?? [];
        dx += snap?.dx ?? 0;
        dy += snap?.dy ?? 0;
        commitTransforms(d.originals, translation(dx, dy));
        break;
      }
      case 'scale':
        // Shift flips the selection's aspect setting for this drag.
        commitTransforms(
          d.originals,
          scaleFromDrag(d.handle, d.pivot, d.start, bedPoint, editor.keepAspect !== event.shiftKey),
        );
        break;
      case 'rotate': {
        let delta = angleAround(d.center, bedPoint) - d.startAngle;
        if (event.shiftKey) delta = snapAngle(delta);
        commitTransforms(d.originals, rotationAbout(delta, d.center.x, d.center.y));
        break;
      }
      case 'marquee':
        drag = { ...d, current: screen };
        break;
      case 'shape':
        drag = { ...d, current: event.shiftKey ? square(d.start, bedPoint) : bedPoint };
        break;
      case 'measure':
        if (canvas.measure) canvas.measure = { from: canvas.measure.from, to: bedPoint };
        break;
    }
  }

  function square(a: Vec2, b: Vec2): Vec2 {
    const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    return { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s };
  }

  function onpointerup(event: PointerEvent) {
    const d = drag;
    drag = null;
    guides = [];
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    if (!d) return;
    if (d.kind === 'move' || d.kind === 'scale' || d.kind === 'rotate') editor.sealHistory();
    if (d.kind === 'marquee' && d.nodes) {
      const box = normalizeRect(d.start, d.current);
      if (box.maxX - box.minX < 3 && box.maxY - box.minY < 3) {
        // A click: off the shapes deselects as before; on the edited shape it drops the picks.
        if (d.additive) return;
        if (d.nodes.clearOnClick) editor.clearSelection();
        nodeSelection.clear();
        return;
      }
      const inside = (p: Vec2) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
      nodeSelection.pickMany(
        editableVectors(editor.project).flatMap((object) =>
          pathNodes(object.paths)
            .filter(
              (n) => !n.control && inside(bedToScreen(canvas.view, bed, apply(object.transform, n.point))),
            )
            .map((n) => ({ objectId: object.id, node: { path: n.path, index: n.index } })),
        ),
        d.additive,
      );
      return;
    }
    if (d.kind === 'marquee') {
      const box = normalizeRect(d.start, d.current);
      if (box.maxX - box.minX < 3 && box.maxY - box.minY < 3) return;
      if (editor.project)
        editor.select(marqueeHits(editor.project, canvas.view, bed, box), d.additive ? 'add' : 'replace');
    }
    if (d.kind === 'shape') createShape(d.shape, normalizeRect(d.start, d.current));
  }

  function groupBreadcrumbs() {
    const groups = editor.project?.groups ?? [];
    const chain = [];
    let group = groups.find((g) => g.id === editor.groupScope);
    while (group) {
      chain.unshift(group);
      const id = group.id;
      group = groups.find((g) => g.children.includes(id));
    }
    return chain;
  }
  function ondblclick(event: MouseEvent) {
    if (!designing) return;
    const hit = hitAt(local(event));
    if (hit && !editor.inScope(hit.id)) {
      editor.exitGroup();
      return;
    }
    if (hit) {
      const unit = editor.scopeUnit(hit.id);
      if (editor.project?.groups?.some((g) => g.id === unit)) {
        editor.enterGroup(unit);
        return;
      }
    }
    if (hit?.kind === 'vector' && !hit.locked) {
      editor.select([hit.id]);
      editor.tool = 'node';
      return;
    }
    if (hit?.kind === 'text' && !hit.locked) {
      editor.select([hit.id]);
      if (!hit.pathLayout) canvas.editText(hit.id);
      return;
    }
    if (hit?.kind === 'image') editor.editImage(hit.id);
  }

  function createShape(shape: DrawnShape, r: Rect) {
    if (!shapeObject(shape, r, '', '', bed)) return;
    editor.addOnLayer('line', (layerId) => [shapeObject(shape, r, layerId, makeId(), bed)!]);
    // One shape per pick of the tool; back to Select so the new shape can be adjusted right away.
    editor.tool = 'select';
  }

  function onwheel(event: WheelEvent) {
    event.preventDefault();
    const screen = local(event);
    const mouseWheel =
      event.deltaMode !== 0 ||
      (event.deltaX === 0 && Math.abs(event.deltaY) >= 50 && Number.isInteger(event.deltaY));
    if (event.ctrlKey || event.metaKey || mouseWheel) {
      // A wheel notch zooms the same with or without Ctrl; the finer Ctrl rate is for trackpad
      // pinch, which reports small pixel deltas with ctrlKey set.
      const rate = event.deltaMode === 1 ? 0.05 : mouseWheel ? 0.002 : event.ctrlKey ? 0.01 : 0.002;
      const factor = Math.exp(-event.deltaY * rate);
      canvas.view = zoomAt(canvas.view, factor, screen);
    } else {
      canvas.view = {
        ...canvas.view,
        offsetX: canvas.view.offsetX - event.deltaX,
        offsetY: canvas.view.offsetY - event.deltaY,
      };
    }
  }

  const cursor = $derived(
    cursorFor({
      drag: drag?.kind ?? null,
      panning: spaceHeld || editor.tool === 'pan' || (!designing && editor.tool !== 'measure'),
      tool: editor.tool,
      handle: hoverHandle,
    }),
  );

  onMount(() => {
    ctx = el.getContext('2d');
    const resize = () => {
      const r = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.max(1, Math.round(r.width * dpr));
      el.height = Math.max(1, Math.round(r.height * dpr));
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      canvas.size = { width: r.width, height: r.height };
      if (!canvas.fitted && r.width > 0) canvas.fit(bed);
      invalidate();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const keydown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        if (!spaceHeld) spaceHeld = true;
        if (e.target === el || e.target === document.body) e.preventDefault();
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld = false;
    };
    const theme = new MutationObserver(() => invalidate());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = matchMedia('(prefers-color-scheme: light)');
    scheme.addEventListener('change', invalidate);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    return () => {
      observer.disconnect();
      theme.disconnect();
      scheme.removeEventListener('change', invalidate);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      cancelAnimationFrame(frame);
    };
  });

  $effect(() => {
    // Refit when the machine's bed size changes.
    void bed.width;
    void bed.height;
    canvas.fitted = false;
    if (canvas.size.width > 0) canvas.fit(bed);
  });

  $effect(() => {
    if (editor.project) images.prune(new Set(editor.project.objects.map((o) => o.id)));
  });

  /** Bed colour from the theme, for the in-place text editor's ink. */
  let bedColor = $state('#121417');

  const empty = $derived(designing && editor.project !== null && editor.project.objects.length === 0);
</script>

<div class="canvas-host" bind:this={host}>
  {#if editor.groupScope}
    <nav class="group-breadcrumb" aria-label="Group breadcrumbs">
      <button
        type="button"
        class="btn ghost"
        onclick={() => {
          editor.groupScope = null;
          editor.clearSelection();
        }}>Workspace</button
      >
      {#each groupBreadcrumbs() as group (group.id)}
        <span>›</span><button type="button" class="btn ghost" onclick={() => editor.enterGroup(group.id)}
          >{group.name}</button
        >
      {/each}
    </nav>
  {/if}
  <CanvasContextMenu
    disabled={!designing}
    oncontextmenu={(event) => {
      const hit = hitAt(local(event));
      if (hit && !editor.selection.has(hit.id)) editor.select([hit.id]);
      else if (!hit) editor.clearSelection();
    }}
  >
    <canvas
      bind:this={el}
      tabindex="0"
      aria-label="Machine bed"
      style:cursor
      data-testid="bed-canvas"
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      onpointercancel={onpointerup}
      onpointerleave={() => (canvas.cursor = null)}
      {onwheel}
      {ondblclick}
    ></canvas>
  </CanvasContextMenu>

  {#if designing && selectionBounds && sizeBox && editor.tool === 'select' && !canvas.editingTextId}
    <div
      class="size-pill"
      role="group"
      aria-label="Selection dimensions in millimeters"
      style:left={`${Math.max(90, Math.min(canvas.size.width - 90, (sizeBox.minX + sizeBox.maxX) / 2))}px`}
      style:top={`${Math.max(0, Math.min(canvas.size.height - 26, sizeBox.maxY + 8))}px`}
    >
      <input
        aria-label="Selection width in millimeters"
        data-testid="canvas-size-width"
        type="text"
        inputmode="decimal"
        value={(selectionBounds.maxX - selectionBounds.minX).toFixed(3)}
        disabled={!canResize || selectionBounds.maxX === selectionBounds.minX}
        onfocus={(e) => e.currentTarget.select()}
        onchange={(e) => editSize(e, 'width')}
        onkeydown={(e) => sizeKey(e, selectionBounds!.maxX - selectionBounds!.minX)}
      />
      <span>×</span>
      <input
        aria-label="Selection height in millimeters"
        data-testid="canvas-size-height"
        type="text"
        inputmode="decimal"
        value={(selectionBounds.maxY - selectionBounds.minY).toFixed(3)}
        disabled={!canResize || selectionBounds.maxY === selectionBounds.minY}
        onfocus={(e) => e.currentTarget.select()}
        onchange={(e) => editSize(e, 'height')}
        onkeydown={(e) => sizeKey(e, selectionBounds!.maxY - selectionBounds!.minY)}
      />
      <span>mm</span>
    </div>
  {/if}

  <ErrorBoundary name="Node editor" compact><NodeEditor {bed} /><PenOverlay {bed} /></ErrorBoundary>
  <TextEditOverlay {bed} {bedColor} />
  <ErrorBoundary name="Bed warning" compact><BedWarning /></ErrorBoundary>

  {#if empty}
    <p class="empty" data-testid="empty-hint">Import art with the Image tool, or drop files here</p>
  {/if}

  <div class="zoom" role="group" aria-label="Zoom">
    <button type="button" class="icon-btn" aria-label="Zoom out" onclick={() => canvas.zoomBy(1 / 1.25)}
      ><Minus size={16} /></button
    >
    <span class="pct mono" data-testid="zoom-percent">{canvas.percent}%</span>
    <button type="button" class="icon-btn" aria-label="Zoom in" onclick={() => canvas.zoomBy(1.25)}
      ><Plus size={16} /></button
    >
    <button type="button" class="btn ghost small" onclick={() => canvas.fit(bed)}
      ><Maximize size={14} />Fit bed</button
    >
  </div>
</div>

<style>
  .group-breadcrumb {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 3;
    display: flex;
    align-items: center;
    background: var(--ol-bg);
    border: 1px solid var(--ol-border);
  }
  .canvas-host {
    position: relative;
    flex-grow: 1;
    min-height: 0;
    overflow: hidden;
  }

  canvas {
    display: block;
    touch-action: none;
    outline: none;
  }

  .size-pill {
    position: absolute;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 5px;
    border-radius: 5px;
    background: var(--ol-beam);
    color: var(--ol-bg);
    font: 500 11px var(--ol-font-mono);
    white-space: nowrap;
  }
  .size-pill input {
    width: 7ch;
    min-width: 0;
    padding: 1px 2px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: center;
    cursor: text;
  }
  .size-pill input:focus {
    background: var(--ol-bg);
    color: var(--ol-text);
    outline: 1px solid var(--ol-text);
  }
  .size-pill input:disabled {
    cursor: default;
  }

  .empty {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    color: var(--ol-text-dim);
    white-space: nowrap;
    pointer-events: none;
  }

  .zoom {
    position: absolute;
    right: 16px;
    bottom: 16px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: var(--ol-radius-md);
    background: var(--ol-surface);
    border: 1px solid var(--ol-border);
  }

  .pct {
    font-size: var(--ol-fs-sm);
    font-weight: 500;
    padding: 0 6px;
    min-width: 48px;
    text-align: center;
  }
</style>
