# SELECTION ENGINE

_Date: 2026-06-25._

## Architecture

Selection is currently **single-selection** via `chartStore.selectedDrawingId`. The DrawingLayer uses this to determine which drawing renders with handles and thicker lines.

## Current state

| Feature | Status |
|---|---|
| Single selection (click) | ✅ Dedicated `selectDrawing()` action + `selectedDrawingId` in chartStore |
| Hit-test | ✅ `drawingHitTest.ts` (all 17 tools) |
| Selection rendering | ✅ `drawingRenderer.ts` renders handles + thicker line for selected drawing |
| Deselect (click empty) | ✅ `selectDrawing(null)` on miss |
| Deselect (Esc) | ✅ Keyboard handler in DrawingLayer |
| Delete selected | ✅ `Delete`/`Backspace` key |
| Drag-to-move selected | ✅ `dragged` ref with pointer capture |
| Locked drawing protection | ✅ Drag blocked via `drawingsLocked` check; Delete blocked by locked check (store-side) |
| Multi-selection (Ctrl+click) | ❌ Not yet implemented |
| Selection box (drag-to-select) | ❌ Not yet implemented |
| Select all (Ctrl+A) | ❌ Not yet implemented |
| Move multiple selected | ❌ Depends on multi-select |

## Multi-selection design (planned)

```ts
// chartStore additions
selectedDrawingIds: Set<string>;  // multi-selection set
selectDrawing: (id: string | null, additive?: boolean) => void;
deselectAll: () => void;
selectAll: () => void;
deleteSelected: () => void;
lockSelected: () => void;
hideSelected: () => void;
```

When `multi` is true (Ctrl held), the click adds/removes from the set rather than replacing. When `multi` is false, it replaces.

## Selection box design

- Pointer-down on empty chart area + drag → render selection rectangle
- On pointer-up: compute all drawings whose bounding box intersects the selection rect
- Select all intersecting drawings

## Locked drawing semantics

- `locked` drawings: cannot be selected via hit-test (hitTest skips them)
- Cannot be deleted (store's removeDrawing checks locked? — not yet)
- Cannot be moved (DrawingLayer's drag handler checks `!drawingsLocked`)
- Render dimmed in the canvas (drawingRenderer renders locked drawings at lower opacity)

## Hover state

Currently not implemented. Planned for Phase 4.x:
- `hoveredDrawingId` in chartStore
- On pointer-move with cursor tool → hitTest → set hoveredDrawingId
- Render a subtle hover highlight (slightly brighter color, or dotted border)
