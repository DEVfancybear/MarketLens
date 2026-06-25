# MILESTONE 2 — Chart/Drawing Interaction Separation

_Date: 2026-06-26_

## Architecture diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        DrawingLayer                              │
│  (thin React component: canvas + keyboard + JSX)                 │
│                                                                  │
│  ┌─ useChartInteractionManager ──────────────────────────────┐   │
│  │  Passive observer. Ensures chart never blocked.            │   │
│  │  Returns: chartRef, isActive()                            │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ useDrawingInteractionManager ────────────────────────────┐   │
│  │  State machine: Idle/Drawing/MovingDrawing/ResizingHandle │   │
│  │  Document capture-phase listeners (pointerdown/move/up)   │   │
│  │  Pointer capture management (claim/release)               │   │
│  │  isPointerClaimed() signal                                │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ createRenderLoop ────────────────────────────────────────┐   │
│  │  rAF canvas rendering + dirty tracking                    │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Keyboard shortcuts ──────────────────────────────────────┐   │
│  │  Delete/Escape/Ctrl+D                                     │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Interaction flow

```
Pointer Event arrives on document (capture phase)

  ↓
  DrawingInteractionManager.handleDown()
    │
    ├── isOverCanvas? ─── No ──→ chart handles normally
    │
    ├── Drawing mode ──→ stopPropagation + setPointerCapture
    │     │
    │     ├── 1-click tool → addDrawing() → Idle
    │     ├── 2-click tool 1st → Drawing state
    │     └── 2-click tool 2nd → addDrawing() → Idle
    │
    └── Cursor mode
          │
          ├── hitTest( drawings, pointer ) → hit?
          │     │
          │     ├── Yes → stopPropagation + setPointerCapture
          │     │          + transition(MovingDrawing/ResizingHandle)
          │     │          → pointerClaimedRef = true
          │     │
          │     └── No → do nothing → event propagates to chart
          │
          └── No hit → chart handles normally (pan/zoom/crosshair)
```

## Pointer ownership

```
Idle state:
  DrawingInteractionManager.isPointerClaimed() = false
  Chart receives all events → zoom/pan/pinch work

Drawing state:
  DrawingInteractionManager.isPointerClaimed() = true
  Pointer captured on canvas → drawing creation in progress
  Chart events blocked during creation gesture

MovingDrawing / ResizingHandle state:
  DrawingInteractionManager.isPointerClaimed() = true
  Pointer captured on canvas → drag in progress
  On pointerup → commit to store → release → isPointerClaimed = false
  Chart events resume immediately

After pointerup:
  isPointerClaimed() → false
  Chart interaction restored immediately
```

## Chart interaction guarantees

| Chart feature | How it works | Blocked by drawings? |
|---|---|---|
| Wheel zoom | LWC chart div receives wheel naturally (canvas pointerEvents:none) | Never |
| Drag pan | Pointerdown on empty space → no hitTest match → event passes through to chart | Never |
| Pinch zoom | LWC chart handles natively | Never |
| Crosshair | LWC chart handles natively | Never |
| Resize | ResizeObserver on canvas parent → markDirty() | Never |

## Files changed

| File | Change |
|---|---|
| `chart/interaction/ChartInteractionManager.ts` | NEW — passive chart interaction handle |
| `drawing/interaction/DrawingInteractionManager.ts` | NEW — drawing-specific interaction (was InteractionManager) |
| `drawing/interaction/InteractionManager.ts` | DELETED — replaced by DrawingInteractionManager |
| `drawing/engine/DrawingEngine.ts` | MODIFIED — re-exports DrawingInteractionManager |
| `drawing/renderer/CanvasRenderer.ts` | MODIFIED — imports Machine from DrawingInteractionManager |
| `chart/DrawingLayer.tsx` | MODIFIED — uses useDrawingInteractionManager |

## Separation guarantees

1. DrawingInteractionManager never calls chart APIs directly (no zoom, no pan, no crosshair manipulation)
2. ChartInteractionManager never calls drawing APIs (no hitTest, no setActiveTool, no addDrawing)
3. DrawingLayer owns only: canvas JSX, keyboard shortcuts, store subscriptions
4. All pointer event handling lives in DrawingInteractionManager
5. Chart interaction works through the LWC chart div natively — never blocked
6. `isPointerClaimed()` provides a clear signal for when drawings own the pointer
