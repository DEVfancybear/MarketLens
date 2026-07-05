# SELECTION ENGINE

_Date: 2026-06-25. Updated 2026-06-27 — multi-selection (shift-click, Ctrl+A, move-multiple)
is implemented; hit-test moved to `hittest/HitTestEngine.ts`._

## Architecture

Selection supports both **single** (`chartStore.selectedDrawingId`) and **multi**
(`chartStore.selectedDrawingIds: Set<string>`) selection. The DrawingLayer/CanvasRenderer use
these to decide which drawings render with handles and thicker lines. Interaction is handled
by `interaction/DrawingInteractionManager.ts`.

## Current state

| Feature | Status |
|---|---|
| Single selection (click) | ✅ `selectDrawing()` action + `selectedDrawingId` in chartStore |
| Hit-test | ✅ `hittest/HitTestEngine.ts` → adapter `hitTest()` per tool (anchor > body priority) |
| Selection rendering | ✅ `drawingRenderer.ts` / `CanvasRenderer` render handles + thicker line when selected |
| Deselect (click empty) | ✅ `selectDrawing(null)` on miss |
| Deselect (Esc) | ✅ Keyboard handler in DrawingInteractionManager |
| Delete selected | ✅ `Delete`/`Backspace` key (multi-aware, via history commands) |
| Drag-to-move selected | ✅ Document-level capture-phase pointer handling (no `setPointerCapture`) |
| Locked drawing protection | ✅ Drag blocked via `drawingsLocked` check; Delete blocked store-side |
| Multi-selection (Shift+click) | ✅ `toggleSelectDrawing()` → `selectedDrawingIds` |
| Select all (Ctrl+A) | ✅ `selectAll()` keyboard handler |
| Move multiple selected | ✅ `multiDragOrig` snapshot translated by drag delta |
| Selection box (drag-to-select marquee) | ❌ Not yet implemented |

## Multi-selection (implemented)

`chartStore` exposes `selectedDrawingIds: Set<string>`, `toggleSelectDrawing(id)`,
`selectAll()`, plus the single `selectDrawing(id)`. In `DrawingInteractionManager`:

- **Shift+click** on a drawing → `toggleSelectDrawing()` (add/remove from the set).
- **Plain click** → `selectDrawing()` replaces the selection.
- **Ctrl/Cmd+A** → `selectAll()`.
- **Dragging** any member of a multi-selection moves the whole set: a `multiDragOrig`
  snapshot of every selected drawing's points is translated by the pointer delta and
  committed on pointerup (each with its own history command).

> Note: multi-add uses **Shift**, not Ctrl (Ctrl/Cmd is reserved for A/C/V/Z/D shortcuts).

## Selection box design (not yet implemented)

- Pointer-down on empty chart area + drag → render selection rectangle
- On pointer-up: compute all drawings whose bounding box intersects the selection rect
- Select all intersecting drawings

## Locked drawing semantics

- `locked` drawings: cannot be selected via hit-test (hitTest skips them)
- Cannot be deleted (store's removeDrawing checks locked? — not yet)
- Cannot be moved (DrawingLayer's drag handler checks `!drawingsLocked`)
- Render dimmed in the canvas (drawingRenderer renders locked drawings at lower opacity)

## Hover state (implemented)

Implemented as transient interaction state (not in the store, to avoid re-renders):
- `hoveredIdRef` in `DrawingInteractionManager`.
- On pointer-move with the cursor tool → `hitTest` → set `hoveredIdRef`.
- `CanvasRenderer` draws the hovered drawing with a translucent thicker highlight pass.
