# DRAWING ENGINE ARCHITECTURE

_Date: 2026-06-25. Updated 2026-07-13 for the 88-entry manifest/84-adapter catalog,
2026-07-17 for capability-driven parity, shared creation gestures, atomic transforms, and
interaction-frame rendering, and 2026-07-19 for exact-precision render signatures._

The current post-Phase 8 maintenance record is
`DRAWING_TOOLS_POST_PHASE8_MAINTENANCE_2026-07-13.md`. Older dated counts in
feature-specific sections below are historical implementation notes, not the
current registry size or test total.

## Architecture rule (read before touching drawing/chart interaction)

Never fix a drawing-interaction bug by adding a conditional hack or patching around pointer
events. Chart interaction and drawing interaction must stay independent (canvas
`pointerEvents:"none"` + document capture-phase listeners — see the render/interaction layers
below). TradingView's behavior is the reference implementation. If fixing one bug causes another
interaction regression, stop and fix the interaction architecture itself rather than layering
another special case on top.

Before considering any drawing/chart-interaction task complete, manually verify all of: chart wheel
zoom, chart pan, crosshair, drawing creation, drawing selection, drawing movement, endpoint
dragging, context menu, delete, duplicate. A task touching this area is not done until all of these
still work, not just the one you were fixing.

## Overview

The Drawing Engine is a canvas-based overlay system that renders 84 persistent
drawing tools on top of the Lightweight Charts price chart. All geometry is
stored in `(time, price)` data space and projected to pixel coordinates each
frame, so drawings remain pinned to data through zoom, pan, and resize. Four
additional manifest entries describe non-persistent interaction modes.

For the shared chart zoom/pan/viewport invalidation contract, see
`ZOOM_VIEWPORT_SYNC_ARCHITECTURE.md`.

## Architecture layers

> The engine is **plugin/adapter based** — there is no giant `switch` and no
> `drawingHitTest.ts`. Every tool is provided by a self-registering plugin under
> `drawing/tools/plugins/`, and the renderer / hit-tester / interaction manager delegate
> to it polymorphically via `ToolRegistry.getTool(tool)`. A family plugin may
> register several related ids; the contract is one adapter per persistent id,
> not one physical file per id.

```
┌────────────────────────────────────────────────────────────────────┐
│                     Interaction Layer                              │
│  DrawingLayer.tsx              ← React wiring: pointer→data         │
│                                  (fromEvent), projectors, render    │
│                                  loop setup, store↔canvas glue      │
│  interaction/                  ← pointer state machine: create,     │
│    DrawingInteractionManager     move, resize-anchor, multi-drag,   │
│                                  hover, keyboard                    │
│  DrawingToolbar.tsx            ← tool selection, color picker       │
│  DrawingContextMenu.tsx        ← right-click actions               │
│  history/ (CommandManager,     ← undo/redo, clipboard, keyboard     │
│    useCommandHistory, ...)                                          │
└───────────────────────────┬────────────────────────────────────────┘
                            │ reads/writes
┌───────────────────────────▼────────────────────────────────────────┐
│                     State Layer                                    │
│  chartStore.ts        ← single source of truth                     │
│  drawings[], selectedDrawingId, selectedDrawingIds, activeTool,    │
│  drawColor, drawingsHidden, drawingsLocked                         │
│  Persistence: backend Phase 7 `/drawings` in remote mode;           │
│  localStorage `drawings:<symbol>` only as anonymous/cache fallback  │
└───────────────────────────┬────────────────────────────────────────┘
                            │ delegates to
┌───────────────────────────▼────────────────────────────────────────┐
│                     Rendering / Geometry Layer                     │
│  renderer/CanvasRenderer.ts   ← dirty-driven rAF render loop +      │
│                                  memo guard (see render contract)   │
│  renderer/CoordinateCache.ts  ← frame-local (time,price)→px cache   │
│  renderer/SpatialIndex.ts     ← viewport cull for many drawings     │
│  drawingRenderer.ts           ← renderDrawing(): delegates to       │
│                                  adapter.render()                   │
│  hittest/HitTestEngine.ts     ← hitTest(): delegates to             │
│                                  adapter.hitTest() + drag policy     │
│  tools/ToolRegistry.ts        ← DrawingAdapter interface + registry │
│  tools/plugins/*Tool.ts       ← tool/family plugins (render +       │
│                                  hitTest + move/anchor + bbox)      │
│  tools/adapters.ts            ← side-effect imports = registration  │
│  geometry/helpers.ts          ← HANDLE_RADIUS, TOL, distances       │
│  Projector: (time,price) → (x,y) pixels                            │
└────────────────────────────────────────────────────────────────────┘
```

## Data flow

```
1. User starts a two-point tool such as Trend Line or Rectangle
   → DrawingInteractionManager (Drawing-mode pointerdown)
   → CreationSession owns the confirmed anchors; CreationGesture owns drag threshold/pointer id
   → machine = Drawing, anchors=[p1]

2. User moves the pointer (before the 2nd click)
   → pointermove → machineRef.anchors = [p1, cursor] → scheduleRedraw (markDirty)
   → CanvasRenderer paints a live "rubber-band" preview (a __pending drawing)

3. User clicks the second point, or drags at least 4 CSS px and releases
   → pointerdown or pointerup → addDrawing({ tool:'trendline', points:[p1,p2] })
     + history CreateCommand
   → chartStore.addDrawing() → appends to drawings[], updates local cache,
     queues backend `/drawings/batch` upsert when authenticated
   → DrawingLayer's store-change effect → markDirty → repaint

4. Chart pan/zoom/resize
   → onVersionChange (subscribeVisibleLogicalRangeChange + ResizeObserver) → markDirty(true)
   → CanvasRenderer re-projects every drawing's (time,price) → pixels and repaints
     (forceNext bypasses the memo guard; CoordinateCache is cleared for the frame)

5. User picks 'cursor' tool and clicks near a drawing
   → DrawingInteractionManager (cursor pointerdown) → hitTest(drawings, point, toX, toY)
   → selectDrawing(hit.id); if hit a handle → ResizingHandle, else → MovingDrawing
   → store-change effect / scheduleRedraw → repaint in "selected" state (handles visible)
```

See **Render loop & repaint contract** below for exactly what triggers a repaint and how
the memo guard decides whether a frame is actually painted.

## Single source of truth

- **chartStore.drawings[]** is the SSOT for all drawing objects
- **chartStore.selectedDrawingId / selectedDrawingIds** drive selection rendering
- **chartStore.activeTool** determines the current creation mode
- **drawingRenderer.ts** (`renderDrawing`) and **hittest/HitTestEngine.ts** (`hitTest`) are
  pure — they read the Drawing model and delegate to the tool adapter, never mutating state
- **Tool adapters are store-independent.** Runtime read-only inputs are supplied by the composition
  root through `Projector.barIntervalSeconds`, `Projector.market`, and the optional
  `DrawingAdapterInteractionContext`; adapters do not import chart/Jotai stores.
- **drawingToolManifest.ts** is the SSOT for catalog metadata and cross-cutting capabilities,
  including creation topology, defaults, settings, shortcuts, overlays/lifecycle, position side,
  snapshot/content requirements, alerts, magnets, and viewport culling.
- **Persistence** is co-located with state mutations in chartStore: authenticated users lazy-load
  drawings by symbol from backend Phase 7 and flush create/update/delete through a debounced batch
  queue keyed by frontend `Drawing.id` (`clientId` server-side); anonymous users keep the existing
  localStorage fallback
- Transient interaction state (in-progress anchors, live drag points) lives in the
  **interaction machine / refs**, NOT the store — it is committed to the store only on
  pointerup (via `updateDrawing` + a history command)

## Common color-picker contract

Every chart color control must use
`components/ui/ColorPicker.tsx`; tool-specific palettes and native
`<input type="color">` controls are not allowed. The shared primitive owns:

- the 8-by-10 TradingView-style preset palette,
- opacity range and percentage controls,
- the `+` custom-color view (HEX, saturation/value plane, and hue rail),
- viewport-clamped desktop placement and the mobile bottom-popover layout,
- keyboard/ARIA behavior, and
- the bounded local list of custom colors shared by drawings, positions, and
  indicators.

`colorPickerModel.ts` is the pure color boundary. When a field exposes a
separate opacity property, the picker returns six-digit HEX and updates that
property independently. Otherwise it preserves alpha in standard
`#RRGGBBAA` form, which both CSS and Canvas 2D consume directly. This avoids
inventing tool-specific opacity storage while keeping the UI identical.

`ColorPickerPopover` is portalled to `document.body` for viewport-safe
placement and must keep `data-chart-ui` on its root surface. The drawing
interaction manager owns capture-phase document listeners, so React bubbling
handlers such as `stopPropagation()` are too late to protect a portalled
palette. The chart-UI marker makes preset swatches, the custom `+` view, HSV
controls, and opacity inputs invisible to drawing creation, selection, and
transform handling regardless of where the floating surface overlaps the
canvas.

Selected-object fill controls are capability driven: every target whose
manifest settings schema exposes `fill` receives `fillColor` and `opacity` as
separate patches. Do not encode opacity into `fillColor` for these drawings;
their canvas adapters already apply `Drawing.opacity` while rendering the
fill, so an alpha-bearing fill color would compound transparency.

Creation defaults in `DrawingToolbar` and `MobileDrawingPalette`, selected
object controls in `DrawingSettingsToolbar`, the full drawing and position
dialogs, and indicator input/style fields all compose this same primitive.

### Mutable preview contract

TradingView-style drawing needs pointer feedback to feel immediate. The interaction manager keeps
high-frequency preview data in mutable refs and schedules the canvas render loop with
`requestAnimationFrame()`:

- Creating a 2-point object such as Rectangle/Trendline updates `machineRef.anchors` on every
  pointermove without publishing React state for every pixel.
- `CreationGesture.ts` supplies one drag threshold and pointer-ownership contract for every
  manifest tool with `creationMode: "two-point"`; individual adapters must not implement their
  own press/drag/release interpretation.
- Creation pointer samples use browser coalesced events where available and collapse remaining
  work to the display cadence. `CreationSession.pointerMoveBatch()` appends continuous-tool
  samples with one preview publication.
- Dragging/resizing existing objects updates `livePointsRef` and commits to `chartStore.drawings[]`
  only on pointerup.
- React `machine` state is still published for low-frequency boundaries such as Idle -> Drawing,
  MovingDrawing, ResizingHandle, and reset. UI that only needs the interaction state (cursor,
  chart pan/zoom freeze) stays correct without forcing React renders during the drag itself.
- `interaction/machine.ts` owns `createInitialMachine()` so every interaction gets fresh mutable
  containers (`multiDragOrig`, anchors) instead of sharing state across sessions.
- Hover hit-testing is rAF-throttled. Raw pointermove stores only the latest pointer event; the
  actual `hitTest()` runs at most once per frame. This keeps dense drawings responsive while still
  updating hover/selection affordances immediately to the eye.
- Existing-drawing move/resize uses `PointerFrameCoalescer`: the first sample is applied
  immediately, additional samples in the same animation frame collapse to the newest sample, and
  pointerup flushes its exact coordinate before the store/history commit. This bounds geometry and
  projection work to the display cadence without losing the final drag position. Its default
  scheduler must invoke `requestAnimationFrame` and `cancelAnimationFrame` through `globalThis`;
  passing either browser method as a detached callback loses its required receiver and throws
  `TypeError: Illegal invocation` when the first drag sample is processed.
- Live drag points reuse one mutable `Map` across pointermoves. The arrays inside it are replaced
  with freshly computed geometry, but the container is not reallocated every event.

Future tools should use the adapter contract (`move`, `moveAnchor`, `getAnchors`) and let the
manager handle live preview. Do not call store updates from pointermove for new tools; store writes
belong at the interaction boundary.

### Two-point creation gesture contract - updated 2026-07-17

Every manifest tool with `creationMode: "two-point"` shares the same lifecycle through
`CreationGesture.ts`, `CreationSession.ts`, and `DrawingInteractionManager.ts`:

- click-click remains supported;
- press-drag-release commits after a 4 CSS-pixel threshold;
- the drag transaction is owned by `pointerId`, not by `buttons` or `pressure`, because embedded
  browsers and trackpads may report `buttons = 0` during captured movement;
- the exact pointer-up coordinate is flushed before commit;
- when click-click commits on `pointerdown`, a release guard quarantines that physical pointer
  transaction until its matching `pointerup` or `pointercancel`;
- Keep Drawing may retain the selected tool, but a new object requires a fresh `pointerdown`.
  Hover or movement from the finishing gesture must never arm another object.

This is a common interaction-layer contract for Rectangle, Fib, Channel, line, and every other
two-point adapter. Tool-specific conditionals for thresholds or release behavior are regressions.

### Atomic transform commit - updated 2026-07-17

Existing-drawing move and resize previews remain transient until pointerup. The completed gesture
is committed through `batchUpdateDrawingsAtom` and `BatchMoveDrawingsCommand`:

- one `drawingsAtom` publication, even when a multi-selection moves several drawings;
- one undo/redo history entry containing every changed patch;
- one local persistence write and one coalesced backend sync batch;
- tool-specific geometry and lifecycle patches round-trip with `points`.

Never publish one store update per pointer sample or one intermediate collection per selected
drawing. Those intermediate states add React work, persistence work, and visible tearing.

## Render loop & repaint contract (READ THIS BEFORE TOUCHING THE CANVAS)

> Updated 2026-06-27. This section is the reference for the whole class of "drawing
> doesn't update / drifts / freezes" bugs. Four such bugs were fixed on this date — all
> rooted here. If a drawing visually lags reality, the cause is almost always one of the
> two mechanisms below.

The canvas is painted by a **dirty-driven rAF loop** (`renderer/CanvasRenderer.ts`,
`createRenderLoop`). It is **not** a continuous loop: after each paint it stops and only
schedules a new frame when `markDirty()` is called. Two invariants must both hold for a
drawing to look correct:

### Invariant A — every visible change must call `markDirty()`

`markDirty(force?)` is the ONLY thing that schedules a repaint. It is triggered from:

1. **Viewport changes** — `DrawingLayer`'s `onVersionChange` subscribes to
   `timeScale().subscribeVisibleLogicalRangeChange` + a `ResizeObserver`, and calls
   `markDirty(true)` (the `force` flag — see Invariant B).
2. **Interaction transitions** — `DrawingInteractionManager` calls `scheduleRedraw()`
   (→ `markDirty()`) on state-machine transitions and on every drag `pointermove`.
3. **Store mutations** — `DrawingLayer` has a `useEffect` that calls `markDirty()` whenever
   any render-relevant store slice changes: `drawings`, `selectedDrawingId`,
   `selectedDrawingIds`, `drawingsHidden`, `drawColor`, `activeTool`.

> ⚠️ If you add a new render input (a new store field, a new machine field, a new overlay
> source) you MUST also add a `markDirty()` trigger for it, or it will only repaint on the
> next accidental pan/tick (the "updates a few seconds later" bug — fixed for delete/undo
> on 2026-06-27 by adding trigger #3).

### Invariant B — the memo guard's key must cover everything that affects the pixels

Inside `render()`, after `markDirty` schedules a frame, a **memo guard** early-returns
without repainting if nothing changed. The guard compares the current frame's key against
the previous frame's. The key currently covers:

| Key part | Source | Why |
|---|---|---|
| `drawHash` | `drawings` ids + point `(time,price)` | drawing added/removed/edited |
| `selectedDrawingId` | store | selection styling |
| `selectedDrawingIds` | store | multi-select styling |
| `drawingsHidden` | store | hide-all toggle |
| `hoveredId` | interaction ref | hover outline styling |
| `machineState` | interaction machine | Idle/Drawing/Moving/Resizing |
| `machineAnchorsSig` | machine anchors **incl. positions** | live rubber-band preview |
| `activeTool`, `drawColor` | store | pending preview styling |
| `liveHash` | live drag points `(time,price)` | drag-in-progress preview |
| `cw`, `ch` | canvas pixel size | resize |
| `barIntervalSeconds` | active timeframe | interval-derived labels such as Info Line |
| `marketContext` | referential market-context revision | Position marks, precision, ticks, and stats |
| `forceNext` | viewport subscription | **see below** |

The comparison lives in `renderer/renderMemo.ts` so Node tests can lock the
memo-key contract without importing the browser canvas renderer. Update
`tests/drawing/renderCulling.test.ts` whenever a new render input should affect
pixels.

Every point-bearing key uses `renderer/pointGeometrySignature.ts` and preserves
the exact JavaScript numeric values for `time`, `price`, and optional `pressure`.
Never use `toFixed()`, symbol display precision, or any other quantization for
render/cache identity. Display formatting and cache identity are separate
contracts: on a five-decimal Forex symbol, `1.14361` and `1.14362` are distinct
frames even though both become `1.1436` at four decimals. Pointer work is already
bounded by `PointerFrameCoalescer`, so dropping precision in the memo key only
drops visible movement; it does not provide a valid performance optimization.

`CanvasRenderer` caches the `drawingsHash` by `drawings[]` array identity. During live
drag/resize, store drawings are intentionally unchanged while `liveHash` changes, so re-hashing all
objects every animation frame is wasted work. Any code that mutates a drawing in place would break
this optimization and is not allowed; chartStore actions must replace the drawings array.

The renderer also avoids copying `drawings[]` unless live points or a pending drawing need a
temporary overlay object. Keep this copy-on-write rule intact when adding render inputs.

> ⚠️ The guard tracks **values, not just counts/lengths**. Tracking a length is a trap:
> two of the 2026-06-27 bugs came from keys that ignored position —
> `machineAnchorsSig` originally tracked only anchor *count*, so the live preview froze
> after the first move (count stayed 2 while the point moved). Any new key that can change
> position without changing count/id MUST hash the exact positions without display-level
> rounding.

**`forceNext` (the viewport escape hatch).** On pan/zoom the drawing data is identical —
`drawHash`, sizes, etc. are all unchanged — but every `(time,price)→pixel` mapping has
shifted, so the guard would wrongly skip the repaint. `markDirty(true)` sets `forceNext`,
which bypasses the guard for exactly one frame. This is what keeps drawings **pinned to
candles** through pan/zoom (fixed 2026-06-27).

**Viewport follow-window.** Wheel zoom, pinch, axis drag scaling, double-click reset, and autoscale
can settle across multiple browser frames. If the drawing canvas repaints only once, it can sample
an intermediate mapping and appear one step behind the candles until another chart event happens.
`CanvasRenderer` therefore keeps a short forced repaint window after viewport changes
(`VIEWPORT_FOLLOW_MS`). The invalidation source is shared in
`components/chart/chartViewportEvents.ts`: it listens to LWC logical-range and time-scale size
subscriptions, plus chart-root input events (`wheel`, touch/pinch, active pointer drags, and
double-click reset). Keep this in the renderer/viewport layer, not in individual drawing tools,
because all tools share the same `(time,price) -> pixel` projection.

### Coordinate projection & the frame-local cache

Projection is `(time,price) → pixel` via `timeScale().timeToCoordinate()` /
`series.priceToCoordinate()`, wrapped by `renderer/CoordinateCache.ts`. The cache exists
only to dedupe repeated conversions **within a single frame** (the spatial-index rebuild +
the draw pass both convert the same points).

The frame `Projector` also carries explicit read-only context when pixels depend on more than
coordinates: `barIntervalSeconds` and optional market candles/symbol metadata. Those values are part
of the render memo contract. Transform sessions receive a separate, deliberately small interaction
context containing `tickSize`, `barIntervalSeconds`, and the active chart candle slice for constraints
such as Position handle snapping and logical-width movement. Do not recover any of these inputs by
reading a store from a plugin.

> ⚠️ `CoordinateCache.nextFrame()` MUST clear the cache every frame. It is keyed by
> `(time)` / `(price)` only — NOT by viewport — so a cached pixel is valid for one frame
> only. A previous version only cleared at >100 entries and otherwise bumped an unused
> `generation` counter; with a few drawings the cache never cleared and every frame reused
> the FIRST frame's pixels, so drawings froze on screen and drifted off their candles on
> pan (fixed 2026-06-27).

### Pointer → data conversion (hit-testing)

`DrawingLayer.fromEvent()` converts a pointer event to a `(time,price)` `Point`. The canvas,
the chart container, and the time-scale pane share the same left edge and CSS-pixel width,
so **local X maps 1:1 to a time-scale coordinate**: `coordinateToTime(clientX - rect.left)`.

> ⚠️ Do NOT rescale X by `timeScale().width() / canvas.width`. `timeScale().width()` excludes
> the right price axis, so that scaling compresses every click's X by a margin that grows
> toward the right edge. Hit-testing then disagrees with the rendered geometry: on a
> near-horizontal line the click still lands within body `TOL` but past `HANDLE_RADIUS` from
> the endpoint, so endpoint grabs select the body and drag the whole line instead (fixed
> 2026-06-27). The conversion must match the unscaled `timeToCoordinate` used for rendering,
> exactly like `PriceChart.onContextMenu`.

### Checklist when a drawing "doesn't update correctly"

1. Does the change call `markDirty()`? (Invariant A — add a trigger if not.)
2. Is the change reflected in the guard key? (Invariant B — add/extend a key; hash
   positions, never just counts.)
3. Is it a pan/zoom case? (Needs `markDirty(true)` / `forceNext`.)
4. Is the cache being cleared per frame? (`CoordinateCache.nextFrame`.)
5. Is pointer→data conversion unscaled and matching the render projection? (`fromEvent`.)

## Extensibility

New tools are **plugins**, not `switch` cases. Adding one normally touches the
manifest, a plugin/family adapter, a fixture, and focused tests; it does not add
tool-id branches to the render loop, store, interaction machine, or persistence:

| File | Change |
|---|---|
| `types/drawingToolManifest.ts` | Add the stable id and one manifest entry with creation topology, defaults, settings, and every cross-cutting capability. `DrawingTool` and derived compatibility lists come from this catalog. |
| `tools/plugins/MyNewTool.ts` | Implement/register the adapter. A family file may register related ids. Reuse shared projected geometry so render, hit, bounds, and handles cannot drift. |
| `tools/adapters.ts` | Add `import "./plugins/MyNewTool";` (side-effect registration). |
| `drawing/testing/toolFixtures.ts` | Supply finite points and capability-required snapshots/content. |
| `tests/drawing/*` | Add a focused family regression; the all-adapter contract automatically covers the new persistent id. |

`registerTool` auto-wraps a simple plugin with default `move` / `moveAnchor` / `getAnchors`
(translate-all / move-one-anchor / point-anchors), so most tools only implement the four
core methods. `getTool(tool)` returns the registered adapter; renderer, hit-tester, and
interaction manager all go through it — no tool-specific branching anywhere else.

> When a tool exposes selected handles, `hitTest()` must return a non-body candidate with an
> explicit `anchorIndex` for every handle returned by `getAnchors()`. Body-only tools explicitly
> return no anchors. Candidate availability is separate from interaction resolution: the first
> drag of an unselected drawing is body movement, while a selected drawing can resize only from an
> unambiguous handle inside the pointer-aware radius.

## Canonical drag-target contract

```ts
// HitResult.target (hittest/HitTestEngine.ts)
type HitTarget = "body" | "p0" | "p1" | "p2" | "p3" | "p4" | "p5";
```

`target` is a visual/priority label, not a point index. The stable resize identity is
`HitResult.anchorIndex`, which must match the corresponding `Anchor.index` from `getAnchors()`.
Stored points 0 and 1 normally use `p1`/`p2`; later vertices can share `p0`, and tools such as
Position use virtual indices. `TransformSession` calls `moveAnchor(origPoints, anchorIndex, pointer,
context)` for resize and `move(origPoints, pointer, dragStart, context)` for body movement.

Interaction resolution is deliberately selection- and pointer-aware:

1. The first pointer drag on an unselected drawing resolves to `body`, even if an endpoint is
   nearby. The same gesture selects and moves the object without changing its compact width.
2. When the drawing is already selected, a handle is eligible only inside the precise radius for
   the current pointer type. Mouse uses a tight target; touch uses a larger physical target.
3. If two or more projected anchors overlap inside that radius and no single anchor is
   unambiguous, resolve to `body` instead of choosing an arbitrary `anchorIndex`.
4. An unambiguous selected handle preserves the adapter-supplied `anchorIndex` exactly.

This policy applies equally to mouse and touch entry points. Adapters describe selectable
geometry; the interaction manager decides whether the current gesture is a body move or a handle
resize.

Position creation must snap entry, target, and stop values to the symbol tick before the initial
drawing is persisted. The first render and the post-move render must therefore have identical
width/level semantics. Horizontal and Vertical Line body transforms preserve the initial
pointer-to-line grab offset, preventing the axis-constrained line from jumping on the first move
sample.

Position creation captures the active `ChartContext` candle slice and viewport scale in the same
command request that persists the drawing. Its right edge advances by candle index, skipping closed
sessions, and uses 20 bars or enough bars to cover 160 CSS pixels at the current zoom when room is
available. Near the latest/right-edge bar, creation reduces the span to the available canvas width.
Target and stop defaults are sampled symmetrically from the active price scale up to 96 CSS pixels,
then snapped to the symbol tick. This keeps the first render visible even for dense bar spacing and
high-precision FX prices.

Outside the loaded series, X projection uses logical bar spacing and the median positive cadence of
the active candle slice. The median rejects isolated market/session gaps while supporting replay and
test slices whose actual cadence differs from the toolbar timeframe; with fewer than three deltas,
the configured timeframe remains authoritative. Pointer inversion anchors to an actual Lightweight
Charts logical coordinate, not an assumed zero-based candle-array index. Position body movement uses
the same context to preserve logical span across gaps, and crossed resize handles retain a 12 CSS-pixel
minimum. Rendering, pointer inversion, and transforms must all consume the same active chart context.

Creation and cursor listeners share the document capture phase. The completing creation
`pointerdown` must call `stopImmediatePropagation()` after committing: tool commit can
synchronously switch back to cursor mode, and without this event boundary the cursor listener can
interpret the same physical press as a new Move/Resize gesture. Browser history assertions keep
the last command at `Create Drawing` after a completed click-sequence tool.

The old `movePoints(..., "p1" | "p2" | "body", ...)` surface remains a simple-adapter compatibility
method, but new multi-point logic must not infer identity from its target string. The executable
all-adapter contract probes every unambiguous projected handle and rejects a body result or
mismatched index.

## Shape inner text ("+ Add text") — added 2026-07-02

TradingView-style: selecting a drawing with manifest
`selectionTextEditor: "shape-center"` (Rectangle/RotatedRect/Circle/Ellipse/Triangle) shows a
"+ Add text" affordance centered inside it; clicking
opens the same inline `TextEditor` the standalone Text tool uses, and the typed text patches the
*existing* drawing's `text` field (unlike the Text tool, which creates a brand-new drawing).

- **Rendering**: `plugins/shared.ts`'s `renderShapeText(g, d, ox, oy, w, h)` draws `d.text` honoring
  alignment/bold/italic/color/font size — shared by all 5 shape plugins (previously only
  `RectangleTool` rendered `d.text` at all, despite the settings dialog and `Drawing` type already
  supporting it for every shape — `Circle`/`Ellipse` were also silently missing their `fillColor`
  render entirely, fixed alongside this).
- **Interactive overlay**: `DrawingLayer.tsx` computes the selected shape's screen-space bounding-box
  center via `adapter.boundingBox(d, toX, toY)` (reusing the same per-tool method the hitTest
  pre-filter uses) and renders a floating `data-chart-ui` button there — "+ Add text" when
  `!d.text`, an invisible re-editable hitbox when text already exists. Hidden while
  `machine.state !== "Idle"` (mid-drag/resize) since the live drag preview and this projection would
  otherwise disagree until the drag commits.
- **Inline edit invariant**: once the inline `TextEditor` is open, any pointerdown outside the input
  inside the chart area commits/cancels it and consumes that same pointer event before the drawing
  manager can start a body drag. The input itself is also `data-chart-ui` and
  `data-inline-text-editor`, so capture-level drawing listeners ignore clicks inside the editor.
  The editor is positioned from the shape's current `boundingBox()`, not from a stored click-time
  coordinate. This matches TradingView's shape-text behavior where text editing is a modal edit
  state of the selected shape, not a draggable overlay that can remain behind while the rectangle
  moves.
- Patches go straight through `updateDrawingAtom` (matching how `DrawingSettingsToolbar`'s style
  patches already work) — not undo-tracked, consistent with that existing gap (see
  `KNOWN_ISSUES.md`).
- Verified via a scripted Playwright repro: button appears on selection, click → type → Enter
  patches the shape and the button becomes an invisible re-edit hitbox; screenshot-confirmed the
  text renders centered inside the shape.
- Regression guard: `npm run check:shape-text-editor` asserts `TextEditor` stays marked as chart UI,
  uses outside-pointer commit with a double-commit guard, reports draft text to `DrawingLayer`, and
  keeps the shape editor position derived from current shape bounds while the chart pointerdown is
  consumed before drag starts.

## Vertical line date label - updated 2026-07-02

`vertical` is a body-only one-anchor tool pinned to a chart time. Its selected-state visual should
match TradingView's vertical line: a full-height blue line plus a blue date/time chip on the bottom
time axis.

- **Rendering**: `VerticalTool.ts` draws the vertical segment through the chart and, when selected,
  draws a bottom-pinned date chip instead of the old white center handle.
- **Date format**: the chip uses UTC chart time in the TradingView-like format
  `Thu 02 Jul 26 19:30`.
- **Viewport safety**: the chip is horizontally clamped so vertical lines near the left or right
  edge do not clip the label outside the canvas.
- **Interaction**: hit-testing remains body-only against the vertical line (`target: "body"`), so
  dragging the line still uses the generic `defaultMovePoints` path.
- Regression guard: `npm run check:vertical-line` rejects the old center handle path and verifies
  the date-label/clamping contract.

## Brush continuous freehand drawing - updated 2026-07-02

`brush` is the TradingView-style freehand drawing tool. It must not use the normal two-click
trendline flow.

- **Adapter contract**: `ToolRegistry.ts` exposes `continuous?: boolean` for pointer-drag tools.
  This is separate from `freeform?: boolean`, which remains the click-to-add / double-click-finish
  flow used by polyline/path-style tools.
- **Creation**: `DrawingInteractionManager.ts` starts a continuous drawing on pointerdown, records
  new points on pointermove when the screen-space delta is at least 2px, and commits the full stroke
  on pointerup.
- **Rendering**: `BrushTool.ts` renders the saved multi-point path as a smoothed quadratic stroke.
  When selected it shows handles at the first and last point, matching TradingView's endpoint
  selection affordance.
- **Interaction**: brush hit-testing remains segment-based (`target: "body"`), so moving a brush
  stroke still translates all recorded points through the default move path.
- Regression guard: `npm run check:brush-freehand` verifies the continuous adapter flag, pointermove
  point recording, pointerup commit, and endpoint handles remain wired.

## Path / polyline freeform drawing - updated 2026-07-03

`path`, `polyline`, and `curve` use the TradingView-style click-to-add freeform flow, separate from
the `brush` pointer-drag flow.

- **Creation**: left-click adds confirmed vertices and live pointer movement previews the next
  segment. Double-click, right-click, or `Esc` finishes the drawing when the committed point count
  meets the tool's `minPoints`; the drawing remains open.
- **Path rendering**: `PathTool.ts` renders connected open segments, never `closePath()`/fill, and
  draws one terminal arrowhead at the final point.
- **Vertex interaction**: freeform plugins return explicit `anchorIndex` for every vertex hit and
  expose matching `getAnchors()` entries. `HitTestEngine` must preserve an adapter-supplied
  `anchorIndex` before falling back to target-label lookup; otherwise an N-point path's final
  `p2` hit can resolve to point index `1`, and middle vertices become body drags.
- Regression guard: `npm run check:path-tool` verifies the open path/arrowhead contract, `Esc`
  finish behavior, and explicit vertex-index hit-test flow.

## Trendline attached text — updated 2026-07-02

Plain `trendline` follows TradingView's normal Trend Line behavior: no automatic measurement chip.
Price-change / percent / angle labels belong to `infoLine` and `trendAngle`.

- **Rendering**: `TrendLineTool.ts` draws the line and handles, then calls `renderLineText()` from
  `plugins/shared.ts`. Saved `d.text` is rendered at the segment midpoint, rotated with the line and
  kept upright. When selected and empty, it renders the placeholder `+ Add text`.
- **Editing**: `DrawingLayer.tsx` projects the selected trendline midpoint/angle via
  `projectTrendLineTextTarget()`, renders an invisible `data-chart-ui` hitbox over the placeholder,
  and opens the shared inline `TextEditor`. The saved text patches the existing trendline drawing,
  so it moves and rotates with the trendline rather than becoming a standalone Text drawing.
- Regression guard: `npm run check:trendline-text` ensures the plain trendline cannot reintroduce
  measurement chips and keeps the attached-text editor path wired.

## Info Line measurement panel — updated 2026-07-02

`infoLine` is the dedicated measurement tool. It should not share the plain trendline's attached
text behavior.

- **Rendering**: `InfoLineTool.ts` draws the segment plus a TradingView-style dark panel containing
  price change / percent / tick span, bar count + elapsed time + pixel distance, and angle.
- **Panel sizing**: the panel measures its three row labels with the active canvas font, expands
  from a compact minimum width as needed, clamps to the chart viewport, and ellipsizes only if the
  viewport is too narrow. Its 66px dark surface uses a subtle border, shadow, and drawing-color
  accent instead of a large translucent gray card. Do not return to a fixed-width-only panel; long
  bars/time/distance rows overflow when the user draws from right to left.
- **Panel placement**: prefer the free side of the line and vertically center the panel on that
  endpoint. If the right endpoint is too close to the price scale, attach to the left endpoint;
  only use an above/below midpoint fallback when neither side fits. This keeps the stats visually
  connected to the drawing and avoids covering the candles beneath the entire segment.
- **Data sources**: price values come from the drawing points; bars use
  `Projector.barIntervalSeconds` supplied by the chart composition root; distance and angle come
  from projected canvas coordinates so they reflect the current chart zoom/pan. The adapter does
  not read the timeframe/chart store.
- **Culling**: the adapter `boundingBox()` includes the panel's approximate width/height so the
  spatial index does not cull an info line whose segment is visible but panel extends beyond it.
- Regression guard: executable Info Line adapter tests cover render/hit/bounds and interval-derived
  output. Source-text regexes are not correctness gates.

## Long / Short position tick-price contract - updated 2026-07-03

Full Long/Short rendering and movement details live in
`POSITION_TOOL_ARCHITECTURE.md`.

## Render culling maintenance - updated 2026-07-08

Right-side whitespace is a separate case: Lightweight Charts returns `null` for
`timeToCoordinate()` when a drawing point sits beyond loaded candles. `DrawingLayer.toX()`
therefore extrapolates from the nearest projected candle pair and caches that fallback by
`ChartContext.version` + candle count + anchor candle. This keeps long/short tools, rays, and
future-time drawings pinned while avoiding a backward candle scan for every point in a frame.

`renderer/SpatialIndex.ts` filters drawings before render/hit-test, but it must never invent
geometry from raw anchors. It asks each adapter for `boundingBox(d, toX, toY)`. Every current
persistent adapter must return finite fixture bounds; the manifest can declare
`viewportCulling: "always-render"` for projected geometry that cannot be safely bounded by the
current time scale.

During an existing-drawing drag, `CanvasRenderer` keeps the last static spatial index when the
drawings array, canvas dimensions, hidden state, and viewport projection are unchanged. It queries
that index with `queryViewportWithOverrides()` so only actively dragged drawings use live geometry.
An override is included even if its original indexed box was outside the viewport. Forced viewport
invalidations (`markDirty(true)`) and structural/store changes rebuild the index before reuse.

Pending creation geometry follows the same override path. The spatial index contains committed
drawings only; `__pending` and live transform geometry are injected by
`queryViewportWithOverrides()`. This prevents a full bounds rebuild for every pointer sample and
keeps a pending preview visible on an index-rebuild frame.

During an active creation or transform, the renderer may cache DPR-correct static canvas layers
before and after the dynamic z-index band. Only that middle band is repainted each frame. The cache
key covers projection, dimensions, DPR, selection, visibility, drawing revisions/z-order, market
context, and the partition itself. It is discarded on forced viewport invalidation or when the
viewport is following pan/zoom. Offscreen layers are capped at 16 million device pixels; when a
layer exceeds the budget or cannot be allocated, the renderer paints that range directly.

This is required because many tools render outside their anchors:

- horizontal, vertical, and cross lines;
- ray and extended line;
- fib levels;
- rectangle `Extend`;
- long/short position zones and labels.

If a plugin renders beyond its anchors, its `boundingBox()` and `hitTest()` must describe that
same visible geometry. Otherwise the renderer may cull a visible object after pan/zoom, or the
user may be unable to select the visible extended portion.

The Long / Short Position tool must use symbol metadata for tick math. Do not infer a tick from the
price magnitude.

- **Source of truth**: `src/components/chart/drawing/tools/positionMetrics.ts` owns all shared
  conversions between entry/target/stop prices and TradingView-style integer ticks.
- **Formula**: `ticks = abs(levelPrice - entryPrice) / symbol.tickSize`; `levelPrice = entryPrice
  +/- ticks * symbol.tickSize`.
- **Long direction**: target is above entry, stop is below entry.
- **Short direction**: target is below entry, stop is above entry.
- **Dialog behavior**: `PositionSettingsDialog.tsx` uses the shared helpers so editing `Ticks`
  updates `Price`, editing `Price` snaps to the symbol tick and updates `Ticks`, and editing
  `Entry price` preserves current tick distances.
- **Input behavior**: position `Entry price`, `Ticks`, and `Price` fields must not commit on every
  keystroke. They use `NumberField commitMode="blur"` plus `positionInput.ts`, so drafts like empty
  text, `-`, or a partial replacement are not committed as zero or mirrored around entry before the
  user finishes typing.
- **Renderer behavior**: `positionRenderer.ts` uses the same helpers for label price formatting and
  tick-count stats. It receives candles, precision, tick size, and point value through explicit
  projector market context. Canvas labels and the settings dialog must never drift.
- **Symbol metadata**: crypto is displayed as a TradingView-style perpetual contract in this app.
  BTCUSDT therefore uses `tickSize: 0.1`, matching the TradingView reference where
  `62061.8 - 61915.1 = 146.7` price points equals `1467` ticks.
- **Reference**: TradingView Advanced Charts symbology documents tick size as symbol price-format
  metadata (`tick size = minmov / pricescale`), so position tools must read symbol metadata rather
  than guess from the current price:
  https://www.tradingview.com/charting-library-docs/latest/connecting_data/Symbology/
- Regression guard: `npm run test:position` compiles the TypeScript tests under `tests/position/`
  and verifies the tick/price round-trip contract.

## Fixed: every new/duplicated/pasted drawing was inserted twice — 2026-07-02

Found while verifying the above feature (a fresh test rectangle showed up twice in
`localStorage`, same id). Root cause, in `DrawingLayer.tsx`'s `addDrawingWithHistory` and the
standalone Text tool's save handler: both called `addDrawing(d)` **directly**, then *also* wrapped
the same `d` in a `CreateDrawingCommand` and ran it via `execute()` — but `CommandManager.execute()`
already calls `cmd.execute()`, which itself calls `addFn(d)`. Every created drawing was inserted
twice under the identical id. Fixed by removing the redundant direct `addDrawing()` calls; `execute()`
alone both inserts and records undo.

A second instance of the same class of bug, worse: **Ctrl+D and Ctrl+V each created two independent
copies** (different ids) because `DrawingInteractionManager.ts`'s keyboard handlers called *both*
the `duplicateDrawing` store action directly *and* `executeCommand(new DuplicateDrawingCommand(...))`
— each one on its own already creates a full copy. Fixed the same way (command-only), and extended
`DuplicateDrawingCommand` with an optional `onCreated` callback so Ctrl+D can still re-select the new
copy (previously a side effect of the now-removed direct `duplicateDrawing` call).

A **third**, independent cause of the same Ctrl+D symptom: `useHotkeys.ts` (global) and
`DrawingInteractionManager.ts` (mounted with `DrawingLayer`) are two *separate* `window.keydown`
listeners that both used to handle Delete/Backspace, Ctrl+A, and Ctrl+D — so even after fixing the
command double-execution above, Ctrl+D still produced 3 copies (1 original + 1 from each listener).
Removed the redundant Delete/Ctrl+A/Ctrl+D handling from `useHotkeys.ts`; `DrawingInteractionManager`'s
versions are multi-select aware and undo-tracked, which the removed ones were not. This also fixes a
subtler bug: Delete-key removals of a single selection were racing the two listeners, and the
non-undo-tracked one in `useHotkeys.ts` usually ran first — so `Ctrl+Z` after pressing Delete did not
actually restore the drawing, because the undo-tracked deletion never got to run (its own `d` lookup
came back empty since the other listener had already removed it).

All three confirmed fixed via a scripted Playwright repro: create → exactly 1 entry; Ctrl+D →
exactly 2; Ctrl+D then Ctrl+C/Ctrl+V → exactly 3.

## Perf notes

- **Interaction-frame pipeline - updated 2026-07-17.** Pointer samples are coalesced to the
  display cadence, canvas bounds are cached for one animation frame, transient previews stay in
  mutable refs, committed spatial indexes are reused with live overrides, and static z-bands are
  composited from DPR-correct offscreen layers. Expensive tick/history snapshots are read only for
  tools whose manifest requests volume-profile data. Move/resize commits use one atomic store and
  history transaction.

- **`hitTest()` bounding-box pre-filter — fixed 2026-07-02.** Every cursor-mode pointerdown/hover
  used to call every drawing's (potentially expensive, per-tool) `adapter.hitTest()`, even ones
  nowhere near the click. `hitTest()` (`hittest/HitTestEngine.ts`) now calls the cheap
  `adapter.boundingBox()` first and skips the full test when the click can't possibly land inside
  it, padded by `HANDLE_RADIUS` (24px) as a safety margin — adapters pad their own boxes
  inconsistently (e.g. `TextTool` pads less than `TOL`), so the margin is deliberately generous to
  guarantee this can never reject a drawing a full hitTest would have hit. Purely additive (same
  results, less wasted work); verified via Playwright that miss/hit selection, body drag, and
  endpoint drag are all unaffected.
- **Dual listener overhead — accepted, not fixed.** Both the cursor-mode (permanent) and
  drawing-mode (conditional, `activeTool !== "cursor"`) document capture-phase listeners run their
  own early-return checks on every pointer event while a drawing tool is active. Looked at fixing
  this by gating listener attachment on `activeTool`, but `getState()` here is `() =>
  stateRef.current` (a ref read, not a reconstruction) — the actual cost is negligible — while
  tearing down/reattaching listeners on tool change risks stranding an in-progress drag if the tool
  changes mid-drag (a real regression for a fix with no measurable benefit). Left as-is per the
  architecture rule above: don't patch around pointer events for a cost that isn't real.


