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
type DragTarget = "body" | "p1" | "p2";
```

No other drag targets are allowed — `"segment"` and `"label"` were deprecated and removed (all 25
tools migrated 2026-06-26; `HitTestEngine`'s type + `TARGET_PRIORITY` no longer accept them, and
`DrawingInteractionManager` maps `hit.target` through with no silent fallback remapping).

```
hitTest → returns "p1" | "p2" | "body"  (no silent remapping)
    ↓
InteractionManager → dragTarget = "p1" | "p2" | "body"  (pass-through)
    ↓
defaultMovePoints(origPoints, pointer, dragTarget, dragStart)
    "p1"   → next[0] = pointer (resize endpoint A)
    "p2"   → next[1] = pointer (resize endpoint B)
    "body" → both += delta (move entire drawing)
    ↓
updateDrawing(id, { points: next })
```

All 25 registered tools return only canonical targets: TrendLine/Ray/ExtendedLine/InfoLine/
Channel/Polyline/Triangle/Rectangle/RotatedRect/Circle/Ellipse/Fib(legacy+Retracement+Extension)/
Curve/Path use `p1`/`p2`/`body`; Brush/Text/Emoji/Horizontal/HorizRay/Vertical/CrossLine/Long-
Position/ShortPosition are `body`-only (no resizable endpoints).

## Known unresolved perf notes (minor, not user-visible bugs)

- **Dual listener overhead.** Both the cursor-mode (permanent) and drawing-mode (conditional,
  `activeTool !== "cursor"`) document capture-phase listeners run their own `isOverCanvas()` +
  `getState()` + `fromEvent()` on every pointer event while a drawing tool is active — the cursor
  handler then early-returns. Wasted work, not a correctness bug.
- **`hitTest()` runs on every idle pointerdown** in cursor mode, even clicks that hit nothing.
  Cheap per-call but adds up with many drawings on screen.

Neither has a reported user-visible symptom; revisit only if drag/click latency becomes a
complaint with a large drawing count.
