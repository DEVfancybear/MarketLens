# DRAWING ENGINE ARCHITECTURE

_Date: 2026-06-25 · Phase 4.1 wired._

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

## Extensibility

New tools require changes in exactly 3 files:

| File | Change |
|---|---|
| `types/drawing.ts` | Add tool to `DrawingTool` union + `DRAWING_TOOLS` array |
| `drawingRenderer.ts` | Add a `case` in the render switch |
| `drawingHitTest.ts` | Add a `case` in the `isHit` function |

Everything else (store, canvas, interaction, persistence, context menu) is tool-agnostic.
