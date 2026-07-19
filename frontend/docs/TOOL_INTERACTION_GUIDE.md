# TOOL INTERACTION GUIDE — Phase 4.2

_Date: 2026-06-25. Updated 2026-07-17 for shared two-point gestures and atomic transforms,
and 2026-07-19 for exact-precision drag rendering._

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
| Trendline / Ray / ExtendedLine / InfoLine | Click first and second anchors, or press-drag-release |
| Text | Click 1 → type text in prompt → placed |
| Rectangle / Fib / Channel | Click first and second anchors, or press-drag-release |

All two-point tools show a live **preview** of the pending point (drawn as a virtual drawing with
`id: '__pending'`) while the user moves the cursor. Press-drag-release commits after a shared 4 CSS
pixel threshold; a normal first click still starts the click-click workflow.

## Keep Drawing

With Keep Drawing off, a completed two-point drawing returns to cursor mode. With Keep Drawing on,
the tool remains selected, but another drawing requires a fresh `pointerdown`. The release and
hover events from the completed gesture cannot create or arm another object.

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
- Pointer samples are coalesced to the display cadence; live geometry stays in transient refs
  instead of being persisted on every `pointermove`
- Each distinct point value retains an exact render signature. Cache keys must never round to UI
  display precision; otherwise sub-pip moves on five-decimal Forex symbols are skipped and handles
  visibly stick or jump
- Pointer-up flushes the exact final coordinate before commit
- Single- and multi-drawing transforms commit through one atomic store write and one undo entry
- Locked drawings are not selectable and cannot be dragged

## Persistence

- Authenticated drawings persist through the backend `/drawings` API and debounced batch sync
- Anonymous/offline fallback uses the symbol-scoped `localStorage` key `drawings:<symbol>`
- A completed multi-drawing transform writes the local collection once and queues each final value
  once; no intermediate preview geometry is persisted
