# DRAWING STATE MACHINE — Phase 4.2.1

_Date: 2026-06-25._

## States

| State | Description | User sees |
|---|---|---|
| **Idle** | Cursor tool active, no pending drawing | Default cursor, click to select drawings |
| **ToolSelected** | Drawing tool active, awaiting first click | Crosshair cursor, toolbar icon highlighted |
| **DrawingPreview** | First point placed, preview rendering | Preview line/shape follows cursor, crosshair cursor |
| **DrawingCompleted** | Drawing committed to store | Drawing appears on chart, tool stays or resets |
| **Cancelled** | Esc or right-click during preview | Preview disappears, tool may reset to cursor |

## Transitions

```
Idle
  │ click drawing tool in toolbar
  ▼
ToolSelected
  │ click on chart (1-click tool)
  ▼
DrawingCompleted ──→ ToolSelected (tool stays active)
  
  │ click on chart (2-click tool, point 1)
  ▼
DrawingPreview
  │ click on chart (2-click tool, point 2)
  ▼
DrawingCompleted ──→ Idle (tool resets to cursor)

DrawingPreview
  │ Esc / right-click
  ▼
Cancelled ──→ Idle
```

## Implementation

| Concern | File | Mechanism |
|---|---|---|
| Active tool state | `chartStore.activeTool` | Zustand state, set by toolbar `setActiveTool()` |
| Pending points | `DrawingLayer.pending` | `useState<Point[] | null>`, set to `[p1]` on first click, `null` on completion/cancel |
| Preview rendering | `DrawingLayer.draw()` | Virtual `Drawing` with `id: '__pending'` prepended to render list |
| Commit | `DrawingLayer.onPointerDown()` | Calls `addDrawing()` in the store |
| Cancel | `DrawingLayer` keyboard/context handler | `setPending(null)` + optionally `setActiveTool('cursor')` |
| Stay active | `chartStore.addDrawing()` | Single-click tools skip the `activeTool: 'cursor'` setter |
