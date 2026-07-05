# RECTANGLE TOOL GUIDE — Phase 4.3

_Date: 2026-06-25._

## Creation

1. Select **Rectangle** tool from the left toolbar (SHAPES section)
2. Click first corner on the chart
3. Drag to second corner — live preview shows while dragging
4. Click to place

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

- Stored in `localStorage` key `drawings:<symbol>`
- All properties preserved: `color`, `fillColor`, `opacity`, `lineStyle`, `points`, `locked`, `visible`, `zIndex`

## Context menu

Right-click a rectangle → Clone, Lock/Unlock, Show/Hide, Z-order, Delete
