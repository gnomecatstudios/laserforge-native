# Advanced design tools — implementation and validation report

Status: merged to main (#8) and prepared for v0.2.9; the acceptance items below remain open.
The browser rendering architecture and portable launcher are preserved.

## Implemented surfaces

- Text participates in Union, Subtract, Intersect and XOR using evaluated glyph
  outlines. First selection is the subtraction base. Missing/pending outlines
  reject the operation without modifying sources. Undo restores editable text.
- Modify Text routes content, fonts, styles, spacing and alignment to the existing
  text inspector. Curve and Warp add editable stack entries; Convert to Path and
  Weld Letters use the complete evaluated cache.
- Curve/warp entries can be enabled, disabled, edited, reordered, reset and removed.
  Warp presets are arch, inverted arch, wave, bulge, squeeze, perspective and slant.
  Curve controls include signed intensity, radius, starting angle, angular offset,
  reverse direction and inside orientation. Existing linked-path text remains live.
- Hierarchical groups preserve source objects, layers, references and transformations.
  Ctrl+G groups; Ctrl+Shift+G ungroups one level. Double-click enters groups,
  Escape exits one level, Ctrl+A respects scope, and breadcrumbs change scope.
  Rename, copy/paste, duplication, arrays, deletion and undo preserve hierarchy.
- Arrange exposes Smart Arrange, Auto Nest, horizontal, vertical, grid, circular,
  equal-gap distribution, alignment and non-scaling Fit to Material commands.
  Existing alignment/distribution geometry is reused, including the existing panel.
- The arrangement dialog provides material dimensions, spacing, margin, rotation,
  grain restrictions, group preservation, locked-object handling and mode controls.
  Preview does not change the project. Apply is atomic; cancel discards the preview.
- Nesting runs in a cancellable worker, checks final polygon collisions, accounts
  for kerf, reports utilization/overflow and requires explicit partial acceptance.
  Locked parts remain obstacles. Open paths and images use conservative footprints.

## Architecture and serialization

No new dependencies. No changes to the renderer, controller protocols, job sending,
platform target list, portable updater or publishing code. No job is sent by an
arrangement command.

Stale cached text remains visible for stable editing bounds, but Boolean operations,
conversion, arrangement, print SVG and CAM reject it until refresh completes.

The existing outliner supplies shaping, kerning, fallback fonts, multiline layout
and holes. Ordered modifiers extend that evaluation path. Cached evaluated paths
remain the shared workspace/Boolean/CAM representation. Group archive coordinates
use parent-child affine composition; schema 2 loads schema 1 projects through an
additive migration. See `decisions.md` for the runtime cache and placement design.

Primary changed modules:

- `packages/libopenlaser/src/fonts/{outline,modifiers}.ts`
- `packages/libopenlaser/src/project/{types,boolean,groups,operations,serialize,factory,migrations,index}.ts`
- `src/app/{text-actions,group-actions,edit-actions,unite,shortcuts}.ts`
- `src/app/state/{editor,text,arrange}.svelte.ts`
- `src/app/canvas/{CanvasView,CanvasContextMenu}.svelte`
- `src/app/inspector/TextInspector.svelte`
- `src/app/lib/{layout,arrange,print-svg}.ts`
- `src/app/workspace/{LayoutPanel,ArrangeDialog}.svelte`
- `src/lib/workers/arrange.worker.ts`
- `packages/libopenlaser/src/cam/layers.ts` (block stale text for every encoder).
- New text Boolean, modifier, group and arrangement unit tests and advanced browser tests.

The concurrent home-screen change from main (`f362364`) was merged into the feature
branch without replacing it.

## Validation

- Full unit suite: 127 files, 1,119 tests passed.
- Full Chromium runs exercised 107 scenarios. The first run passed 106/107, with
  one machine-flow timeout that passed alone and in the subsequent full run.
  After merging main, the next full run passed 105/107 and exposed a text-edit
  placeholder-bounds regression and an obsolete home-screen dimension assertion.
  The regression was fixed by retaining display geometry with an explicit stale
  flag that blocks manufacturing output; the tour test now checks dimensions in
  the workspace while preserving the updated home screen.
- Final affected browser rerun: 13/13 passed, including both repairs and a fourth
  advanced-design test for text Boolean subtraction and editable-text undo.
- Earlier focused layout/advanced-design browser run: 12/12 passed.
- Svelte check: no errors or warnings. ESLint and production/library builds checked.
- Portable Python suite: 23 tests, one platform-specific skip.
- Build output retains existing Vite/HarfBuzz externalization and chunk-size warnings.
- Browser plugin unavailable; Playwright used at localhost:5191, 1440×900.

All four portable targets cross-built successfully using Go 1.24.0 installed in
the execution workspace. Archive parity and branding checks passed for Windows
x64, Linux x64, Raspberry Pi ARM64 and ARM32, including the source archive.
Validation packages were kept outside the repository and were not published. Cross-compilation does not establish Windows or
Raspberry Pi runtime/hardware compatibility. No physical laser job was sent.

## Acceptance items still open

These must remain open rather than describing the entire specification as complete:

- A full application SVG export surface and SVG export regression coverage.
- Independent grid X/Y gaps and cell alignment, and an explicit opt-in scaling
  control for Fit to Material. Current manual grid uses one shared minimum gap.
- Dedicated path orientation/inside-outside controls beyond existing offset,
  alignment and reverse controls. Path attachment remains the existing baseline
  layout stage, rather than a reorderable stack entry.
- Interactive canvas handles for new curve parameters and a broader set of warp
  horizontal/vertical controls.
- Broader manufacturing fixtures, cutout classification beyond line-layer metadata,
  high-volume performance measurements and exhaustive cross-feature acceptance tests.
- Native runtime verification on Windows and Raspberry Pi, and physical controller
  validation. Only existing simulated-controller tests have been exercised here.
- Public portable publishing. Version v0.2.9 is selected and the work is on main;
  the release is published by running the portable build workflow with publish enabled.

Nesting remains heuristic. Utilization is placed footprint area divided by total
material area; overlapping artwork within a group is unioned. Stationary obstacles
are excluded from the displayed occupied-area numerator. Hole nesting is restricted
to one line layer with optimized cut ordering; review manufacturing semantics before
using it. Open geometry and images intentionally consume conservative bounding areas.

## Commit sequence

- `931d88f` — evaluated text Boolean foundations.
- `b8306d8` — text modifier controls and welding.
- `97074e2` — hierarchy, scoped editing and local-coordinate persistence.
- `2305805` — worker placement and collision validation.
- `fc116dc` — context menus and browser interaction tests.
- `8b25a6c` — modifier transactions and bounded trial comparison.
- `9fd1e6c` — incorporate the concurrent main-branch home-screen update.
- `4ed6612` — disabled conversion states and scoped text-property focus.
- Subsequent validation commits record stale-cache regression repairs and final checks.

This report and the pull request track validation and outstanding acceptance work;
main must not be promoted as a completed implementation while the items above remain.
