# TOOL ACTIVATION SYSTEM — Phase 4.2.1

_Date: 2026-06-25._

## State machine

```
        click tool in toolbar
IDLE ──────────────────────────→ TOOL SELECTED
  ↑                                    │
  │ Esc / right-click                  │ click on chart
  │                                    ↓
CANCELLED ←─────────────────── DRAWING PREVIEW
                                     │
                                     │ click again (2-click tools)
                                     ↓
                              DRAWING COMPLETED
                                     │
                                     │ single-click tool: stays active
                                     │ two-click tool: returns to IDLE
                                     ↓
                              TOOL SELECTED / IDLE
```

## What was fixed

| Issue | Before | After |
|---|---|---|
| Tool doesn't stay active after single-click placement | `addDrawing` always reset to `cursor` | Single-click tools stay active; two-click tools reset to cursor |
| Canvas doesn't accept first click with no prior drawings | `pointerEvents: auto` only when `interactive \|\| drawings.length` | Always `auto` when any non-cursor tool is active |
| No live preview while drawing | Preview was inline in the render loop but not shown as a visual state | Preview virtual drawing (`id: '__pending'`) renders with current tool color |
| Right-click doesn't cancel pending drawing | Right-click only opened context menu | Right-click cancels pending creation first; right-click on existing drawing opens context menu |
| Cursor doesn't change to move while dragging | Cursor was `crosshair` during drag | Cursor becomes `move` when `dragRef` is active |
| Escape key behavior | Esc set tool to cursor but didn't clear pending | Esc clears pending AND sets tool to cursor |

## Cursor system

| State | Cursor |
|---|---|
| Cursor mode (idle) | `default` |
| Any drawing tool selected | `crosshair` |
| Dragging a drawing | `move` |

## Toolbar feedback

- `IconButton` with `active` prop — renders blue background when `activeTool === tool`
- Only one tool active at a time (single selection)
- Color picker shows current color in the palette icon

## Live preview

- Pending point array pushed to renderer as a virtual `Drawing` with `id: '__pending'`
- Rendered with the current tool's color and lineWidth
- Updates on every `pointerMove` event
- For two-click tools, shows the line/rectangle/circle preview between point 1 and the cursor

## Escape key

- Cancels any pending creation (`setPending(null)`)
- Resets tool to cursor (`setActiveTool('cursor')`)

## Right-click during drawing

- If `pending` is not null → cancel drawing (set pending to null, prevent default)
- If `pending` is null → hit-test for existing drawing → open context menu

## Files changed

| File | Change |
|---|---|
| `store/chartStore.ts` | `addDrawing` keeps tool active for single-click tools |
| `components/chart/DrawingLayer.tsx` | Cursor system, pointer-events fix, right-click cancel, drag cursor |
