# TREND LINE SUITE — Phase 4.2

_Date: 2026-06-25 · All 8 tools implemented._

## Tools implemented

| # | Tool | Type ID | Points | Creation | Rendering |
|---|---|---|---|---|---|
| 1 | Trend Line | `trendline` | 2 | Two-click | Line through both points |
| 2 | Ray | `ray` | 2 | Two-click | Line from point 1 through point 2, infinite to right |
| 3 | Extended Line | `extendedLine` | 2 | Two-click | Infinite line through both points, full chart width |
| 4 | Horizontal Line | `horizontal` | 1 | Single-click | Horizontal line at price, full-chart width |
| 5 | Horizontal Ray | `horizRay` | 1 | Single-click | Horizontal line from click point to right edge |
| 6 | Vertical Line | `vertical` | 1 | Single-click | Vertical line at time, full-chart height |
| 7 | Cross Line | `crossLine` | 1 | Single-click | Full-chart crosshair (vertical + horizontal) at anchor |
| 8 | Info Line | `infoLine` | 2 | Two-click | Line + measurement box (price delta, %, bar count) |

## Shared capabilities

All tools support:
- ✅ Create (click on chart)
- ✅ Select (cursor + click)
- ✅ Move (drag selected)
- ✅ Delete (Delete key)
- ✅ Duplicate (Ctrl+D)
- ✅ Context menu (right-click → Clone, Lock/Unlock, Show/Hide, Z-order, Delete)
- ✅ Persist (localStorage per symbol)
- ✅ Reload (loaded on symbol change)
- ✅ Zoom/pan stability (geometry in data space)
- ✅ Line styles: solid, dashed, dotted (`lineStyle` field)

## Architecture

```
types/drawing.ts        ← 5 new tools + LineStyle type
drawingRenderer.ts      ← 5 new render cases + ray/extended line math
drawingHitTest.ts       ← 5 new hit-test cases
DrawingLayer.tsx        ← generalized creation flow (minPoints), context menu, Ctrl+D
DrawingContextMenu.tsx   ← NEW: right-click with Clone/Lock/Show/Z-order/Delete
DrawingToolbar.tsx       ← 8 new tools, visual category groups
```

## Files changed

| File | Type | Change |
|---|---|---|
| `types/drawing.ts` | Modified | 5 new tools, `LineStyle` type, extended `DRAWING_TOOLS` |
| `drawingRenderer.ts` | Modified | 5 new render cases + ray/extended line math + `applyStyle()` |
| `drawingHitTest.ts` | Modified | 5 new hit-test cases |
| `DrawingLayer.tsx` | Modified | Generalized creation (minPoints), context menu, Ctrl+D |
| `DrawingContextMenu.tsx` | **New** | Right-click context menu |
| `DrawingToolbar.tsx` | Modified | 12 tools with 3 visual category groups |

## Line style system

```ts
type LineStyle = 'solid' | 'dashed' | 'dotted';

// Rendering:
applyStyle(g, d.lineStyle);
// solid  → setLineDash([])
// dashed → setLineDash([6, 3])
// dotted → setLineDash([2, 3])

// Handles always use solid (no dash).
// Style persists through localStorage.
```

## Perspective on scope

8 requested tools implemented. The architecture now supports:
- 5 new line-type tools (ray, extendedLine, horizRay, crossLine, infoLine)
- Context menu on all drawings
- Ctrl+D duplicate
- Line style system (solid/dashed/dotted)
- Generalized creation flow (any tool with 1 or 2 points works without code changes)
- Visual category groups in toolbar
