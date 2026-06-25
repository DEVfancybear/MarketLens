# TOOL INTERACTION GUIDE — Phase 4.2

_Date: 2026-06-25._

## Cursor mode

| Action | Result |
|---|---|
| Click drawing | Select it (single selection) |
| Click empty space | Deselect all |
| Drag selected drawing | Move all its points by the same delta |
| Right-click drawing | Open DrawingContextMenu |
| Ctrl+D with drawing selected | Duplicate it |

## Drawing creation

| Tool | Creation |
|---|---|
| Horizontal / Vertical / HorizRay / CrossLine | Single click places |
| Trendline / Ray / ExtendedLine / InfoLine | Click 1 → click 2 |
| Text | Click 1 → type text in prompt → placed |
| Rectangle / Fib / Channel | Click 1 → click 2 |

All two-click tools show a live **preview** of the pending point (drawn as a virtual drawing with `id: '__pending'`) while the user moves the cursor.

## Keyboard shortcuts

| Key | Context | Action |
|---|---|---|
| Delete / Backspace | Drawing selected | Delete drawing |
| Escape | Any drawing tool active | Cancel pending creation, switch to cursor |
| Escape | Context menu open | Close menu |
| Ctrl+D | Drawing selected | Duplicate drawing |

## Context menu

Right-click a drawing → menu appears at cursor:
- **Clone** — duplicate the drawing
- **Lock / Unlock** — toggle lock (locked drawings cannot be selected/moved/deleted)
- **Show / Hide** — toggle visibility
- **Bring to Front** — move to highest zIndex
- **Send to Back** — move to lowest zIndex
- **Delete** — remove

## Drag behavior

- Whole-object drag: all points translate by (Δtime, Δprice)
- Dragged update is applied per-pointer-move for lag-free feel
- On pointer-up, the final position is persisted to localStorage
- Locked drawings are not selectable and cannot be dragged

## Persistence

- All drawings persist to `localStorage` key `drawings:<symbol>`
- Written on every `addDrawing`, `updateDrawing`, `removeDrawing`, `clearDrawings`
- Loaded on symbol change via `chartStore.setSymbol()`
- Symbol-scoped: switching from BTCUSDT to ETHUSDT loads ETHUSDT's drawings
