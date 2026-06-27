# DRAWING ENGINE ARCHITECTURE

_Date: 2026-06-25 · Phase 4.1 wired. Updated 2026-06-27 with the render loop & repaint contract._

## Overview

The Drawing Engine is a canvas-based overlay system that renders user drawings (trendlines, horizontal/vertical lines, rectangles, fib retracements, text, channels, brush, positions) on top of the Lightweight Charts price chart. All geometry is stored in `(time, price)` data space and projected to pixel coordinates each frame, so drawings remain pinned to data through zoom, pan, and resize.

## Architecture layers

```
┌────────────────────────────────────────────────────────────────┐
│                     Interaction Layer                          │
│  DrawingLayer.tsx   ← pointer events, drag, creation flows    │
│  DrawingToolbar.tsx ← tool selection, color picker             │
│  DrawingContextMenu ← right-click actions (Phase 4.3)          │
└───────────────────────────┬────────────────────────────────────┘
                            │ reads/writes
┌───────────────────────────▼────────────────────────────────────┐
│                     State Layer                                │
│  chartStore.ts        ← single source of truth                 │
│  drawings[], selectedDrawingId, activeTool, drawColor          │
│  Persistence: localStorage `drawings:<symbol>`                 │
└───────────────────────────┬────────────────────────────────────┘
                            │ delegates to
┌───────────────────────────▼────────────────────────────────────┐
│                     Rendering Layer                            │
│  drawingRenderer.ts   ← pure canvas renderer (17 tools)        │
│  drawingHitTest.ts    ← pure hit-test (17 tools)               │
│  Projector: (time,price) → (x,y) pixels                        │
└────────────────────────────────────────────────────────────────┘
```

## Data flow

```
1. User clicks canvas with 'trendline' tool active
   → DrawingLayer.onPointerDown → setPending([point])

2. User clicks second point
   → DrawingLayer.onPointerDown → addDrawing({ tool: 'trendline', points: [p1, p2] })
   → chartStore.addDrawing() → appends to drawings[], persists to localStorage

3. Chart pan/zoom (ctx.version bumps)
   → DrawingLayer.draw() re-renders all drawings via drawingRenderer.ts
   → each drawing's (time,price) points are projected via Projector to pixel coords
   → canvas draws lines, handles, labels

4. User clicks 'cursor' tool + clicks near a drawing
   → DrawingLayer.onPointerDown → hitTest(drawings, point, toX, toY)
   → selectDrawing(hit.id)
   → canvas re-renders with that drawing in "selected" state (thicker line, visible handles)
```

## Single source of truth

- **chartStore.drawings[]** is the SSOT for all drawing objects
- **chartStore.selectedDrawingId** drives selection rendering
- **chartStore.activeTool** determines the current creation mode
- **drawingRenderer.ts** and **drawingHitTest.ts** are pure functions — they read the Drawing model but never modify state
- **Persistence** is co-located with state mutations in chartStore

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

New tools require changes in exactly 3 files:

| File | Change |
|---|---|
| `types/drawing.ts` | Add tool to `DrawingTool` union + `DRAWING_TOOLS` array |
| `drawingRenderer.ts` | Add a `case` in the render switch |
| `drawingHitTest.ts` | Add a `case` in the `isHit` function |

Everything else (store, canvas, interaction, persistence, context menu) is tool-agnostic.
