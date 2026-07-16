# RECTANGLE TOOL GUIDE — Phase 4.3

_Date: 2026-06-25. Updated 2026-07-17 for shared two-point creation semantics._

## Creation

Rectangle supports two equivalent workflows after selecting it from the left toolbar:

1. Click the first corner, move the pointer, then click the opposite corner.
2. Press at the first corner, drag at least 4 CSS pixels, then release at the opposite corner.

A completed Rectangle releases its active pointer immediately. With Keep Drawing enabled,
Rectangle remains selected but waits for a new `pointerdown`; moving or hovering after release does
not create another Rectangle.

## Editing

| Action | How |
|---|---|
| Move entire rectangle | Select with cursor, drag anywhere inside |
| Resize | Drag corner handles (visible when selected) |
| Delete | Select, press Delete key |
| Duplicate | Select, press Ctrl+D |
| Change color | Select, use color picker before creation (future: edit dialog for existing) |
| Change fill | Use `fillColor` on drawing object (set via future settings dialog) |
| Lock | Right-click → Lock |

## Supply / demand zone workflow

1. Select Rectangle tool
2. Choose a fill color (green for demand, red for supply)
3. Draw rectangle over the zone
4. The zone renders with semi-transparent fill + solid border
5. Persists across page reloads and symbol switches

## Persistence

- Authenticated drawings sync through the backend; anonymous/offline fallback uses
  `localStorage` key `drawings:<symbol>`
- All properties preserved: `color`, `fillColor`, `opacity`, `lineStyle`, `points`, `locked`, `visible`, `zIndex`

## Context menu

Right-click a rectangle → Clone, Lock/Unlock, Show/Hide, Z-order, Delete
