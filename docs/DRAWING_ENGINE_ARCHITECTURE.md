# DRAWING ENGINE ARCHITECTURE

_Date: 2026-06-25 · Phase 4.1 wired. Updated 2026-06-27 with the render loop & repaint contract.
Updated 2026-07-02: merged in the standing architecture rule, the canonical drag-target contract,
and the outstanding perf notes from the DeepSeek investigation log (`DEEPSEEK.md`)._

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

The Drawing Engine is a canvas-based overlay system that renders user drawings (trendlines, horizontal/vertical lines, rectangles, fib retracements, text, channels, brush, positions) on top of the Lightweight Charts price chart. All geometry is stored in `(time, price)` data space and projected to pixel coordinates each frame, so drawings remain pinned to data through zoom, pan, and resize.

## Architecture layers

> The engine is **plugin/adapter based** — there is no giant `switch` and no
> `drawingHitTest.ts`. Every tool is a self-registering plugin under
> `drawing/tools/plugins/`, and the renderer / hit-tester / interaction manager delegate
> to it polymorphically via `ToolRegistry.getTool(tool)`.

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
│  Persistence: localStorage `drawings:<symbol>`                     │
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
│                                  adapter.hitTest() (anchor > body)   │
│  tools/ToolRegistry.ts        ← DrawingAdapter interface + registry │
│  tools/plugins/*Tool.ts       ← one plugin per tool (render +       │
│                                  hitTest + move/anchor + bbox)      │
│  tools/adapters.ts            ← side-effect imports = registration  │
│  geometry/helpers.ts          ← HANDLE_RADIUS, TOL, distances       │
│  Projector: (time,price) → (x,y) pixels                            │
└────────────────────────────────────────────────────────────────────┘
```

## Data flow

```
1. User clicks canvas with 'trendline' tool active
   → DrawingInteractionManager (Drawing-mode pointerdown) → machine = Drawing, anchors=[p1]

2. User moves the pointer (before the 2nd click)
   → pointermove → machine.anchors = [p1, cursor] → scheduleRedraw (markDirty)
   → CanvasRenderer paints a live "rubber-band" preview (a __pending drawing)

3. User clicks second point
   → pointerdown → addDrawing({ tool:'trendline', points:[p1,p2] }) + history CreateCommand
   → chartStore.addDrawing() → appends to drawings[], persists to localStorage
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
- **Persistence** is co-located with state mutations in chartStore
- Transient interaction state (in-progress anchors, live drag points) lives in the
  **interaction machine / refs**, NOT the store — it is committed to the store only on
  pointerup (via `updateDrawing` + a history command)

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
| `drawingsHidden` | store | hide-all toggle |
| `machineState` | interaction machine | Idle/Drawing/Moving/Resizing |
| `machineAnchorsSig` | machine anchors **incl. positions** | live rubber-band preview |
| `activeTool`, `drawColor` | store | pending preview styling |
| `liveHash` | live drag points `(time,price)` | drag-in-progress preview |
| `cw`, `ch` | canvas pixel size | resize |
| `forceNext` | viewport subscription | **see below** |

> ⚠️ The guard tracks **values, not just counts/lengths**. Tracking a length is a trap:
> two of the 2026-06-27 bugs came from keys that ignored position —
> `machineAnchorsSig` originally tracked only anchor *count*, so the live preview froze
> after the first move (count stayed 2 while the point moved). Any new key that can change
> position without changing count/id MUST hash the positions.

**`forceNext` (the viewport escape hatch).** On pan/zoom the drawing data is identical —
`drawHash`, sizes, etc. are all unchanged — but every `(time,price)→pixel` mapping has
shifted, so the guard would wrongly skip the repaint. `markDirty(true)` sets `forceNext`,
which bypasses the guard for exactly one frame. This is what keeps drawings **pinned to
candles** through pan/zoom (fixed 2026-06-27).

### Coordinate projection & the frame-local cache

Projection is `(time,price) → pixel` via `timeScale().timeToCoordinate()` /
`series.priceToCoordinate()`, wrapped by `renderer/CoordinateCache.ts`. The cache exists
only to dedupe repeated conversions **within a single frame** (the spatial-index rebuild +
the draw pass both convert the same points).

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

New tools are **plugins**, not `switch` cases. Adding one touches 2–3 files and nothing
in the render loop, store, interaction machine, or persistence:

| File | Change |
|---|---|
| `tools/plugins/MyNewTool.ts` | Implement the plugin: `tool`, `minPoints`, `render()`, `hitTest()`, `movePoints()`, `boundingBox()` (and optional `move`/`moveAnchor`/`getAnchors`); call `registerTool(plugin)`. Reuse `geometry/helpers.ts` (`HANDLE_RADIUS`, `TOL`, `distToSegment`, …) and `plugins/shared.ts` (`line`, `handle`). |
| `tools/adapters.ts` | Add `import "./plugins/MyNewTool";` (side-effect registration). |
| `types/drawing.ts` | Add the tool id to the `DrawingTool` union + `DRAWING_TOOLS` (only if it's a new id, so the toolbar/types know it). |

`registerTool` auto-wraps a simple plugin with default `move` / `moveAnchor` / `getAnchors`
(translate-all / move-one-anchor / point-anchors), so most tools only implement the four
core methods. `getTool(tool)` returns the registered adapter; renderer, hit-tester, and
interaction manager all go through it — no tool-specific branching anywhere else.

> When adding a tool, make sure its `hitTest()` returns anchor candidates (`p1`/`p2`/…)
> as well as a `body` candidate — `HitTestEngine` prioritises anchors over body so endpoint
> grabs work (see the `fromEvent` note in the render contract for the coordinate pitfall).

## Canonical drag-target contract

```ts
// HitResult.target (hittest/HitTestEngine.ts)
type HitTarget = "body" | "p0" | "p1" | "p2" | "p3";
// DrawingAdapter.movePoints()'s dragTarget (ToolRegistry.ts) — the *generic*
// 2-anchor fallback path only, see below.
type DragTarget = "body" | "p1" | "p2";
```

No OTHER targets are allowed — `"segment"` and `"label"` were deprecated and removed (all 25 tools
migrated 2026-06-26; `HitTestEngine`'s type + `TARGET_PRIORITY` no longer accept them). Two
resolution paths exist depending on how many anchors a tool has:

- **2-anchor tools** (most of them) resolve drags through the generic string-based
  `movePoints(origPoints, pointer, dragTarget, dragStart)`, `dragTarget` restricted to
  `"p1"|"p2"|"body"`, with no silent fallback remapping:
  ```
  hitTest → "p1" | "p2" | "body"  →  InteractionManager (pass-through)  →  defaultMovePoints(...)
      "p1"   → next[0] = pointer (resize endpoint A)
      "p2"   → next[1] = pointer (resize endpoint B)
      "body" → both += delta (move entire drawing)
  ```
- **3+-anchor tools** (RotatedRect, Triangle, Position tools) instead resolve drags through the
  **index-based** `moveAnchor(origPoints, anchorIndex: number, pointer)` — `HitTestEngine` resolves
  `hit.target` (`"p0"`/`"p1"`/`"p2"`/`"p3"`) to a numeric `anchorIndex` via the adapter's
  `getAnchors()`, and `DrawingInteractionManager` drags by index, not by the `dragTarget` string.
  This is how `"p0"`/`"p3"` exist at all despite `movePoints`'s narrower type — they never flow
  through that string-based path.

All 25 registered tools return only canonical `HitTarget` values: TrendLine/Ray/ExtendedLine/
InfoLine/Channel/Polyline/Triangle/Rectangle/RotatedRect/Circle/Ellipse/Fib(legacy+Retracement+
Extension)/Curve/Path have resizable anchors (`p0`-`p3` per tool, see each plugin's `getAnchors()`);
Brush/Text/Emoji/Horizontal/HorizRay/Vertical/CrossLine/LongPosition/ShortPosition are `body`-only
(no resizable endpoints).

## Shape inner text ("+ Add text") — added 2026-07-02

TradingView-style: selecting a fillable shape (Rectangle/RotatedRect/Circle/Ellipse/Triangle —
`SHAPE_TOOLS` in `types/drawing.ts`) shows a "+ Add text" affordance centered inside it; clicking
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
  from the TradingView-like minimum width as needed, clamps to the chart viewport, and ellipsizes
  only if the viewport is too narrow. Do not return to a fixed-width-only panel; long
  bars/time/distance rows overflow when the user draws from right to left.
- **Data sources**: price values come from the drawing points; bars use the active `timeframeAtom`
  with `TF_SECONDS`; distance and angle come from projected canvas coordinates so they reflect the
  current chart zoom/pan.
- **Culling**: the adapter `boundingBox()` includes the panel's approximate width/height so the
  spatial index does not cull an info line whose segment is visible but panel extends beyond it.
- Regression guard: `npm run check:infoline-panel` rejects the old one-line generic chip path and
  checks the measured-width / text-fit panel path stays in place.

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
