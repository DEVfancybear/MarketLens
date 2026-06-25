# SHAPE TOOLS ARCHITECTURE — Phase 4.3

_Date: 2026-06-25 · All 8 shape tools implemented._

## Tools implemented

| # | Tool | Type ID | Points | Creation | Fill Support |
|---|---|---|---|---|---|
| 1 | Rectangle | `rectangle` | 2 | Two-click | ✅ `fillColor` + `opacity` |
| 2 | Rotated Rectangle | `rotatedRect` | 3–4 | Multi-click | ✅ |
| 3 | Circle | `circle` | 2 | Center + radius click | ✅ |
| 4 | Ellipse | `ellipse` | 3 | Center + rx + ry | ✅ |
| 5 | Triangle | `triangle` | 3 | Three-click | ✅ |
| 6 | Polyline | `polyline` | N | Multi-click (open) | — |
| 7 | Curve | `curve` | N | Multi-click (bezier) | — |
| 8 | Path | `path` | N | Multi-click (closed) | ✅ |

## Fill system

```ts
interface Drawing {
  fillColor?: string;  // fill color (default: uses stroke color at 12% opacity)
  opacity?: number;     // fill opacity 0–1 (default: 0.15)
}
```

- `fillColor` set → use that color at `opacity`
- `fillColor` unset → use `color` at 12% opacity (legacy behavior preserved)
- Selection handles always render solid

## Architecture (zero core engine changes)

```
types/drawing.ts        ← 8 new tool types + fillColor/opacity fields
drawingRenderer.ts      ← 8 new render cases + shape helper functions
drawingHitTest.ts       ← 8 new hit-test cases
DrawingLayer.tsx        ← NO CHANGES (generalized creation flow from 4.2 handles it)
DrawingContextMenu.tsx   ← NO CHANGES
DrawingToolbar.tsx       ← 8 new shape tools, 4th category (ANNOTATIONS)
```

The `minPoints()` dispatcher in DrawingLayer already supports 2-point creation for the new tools (rectangle, circle, ellipse, rotatedRect) and the pending-preview system shows live previews. Triangle, polyline, curve, and path use the existing multi-point flow.

## Rectangle — supply/demand zone workflow

The `rectangle` tool is the most important shape tool. It supports:
- **Stroke** (`color`) — zone border
- **Fill** (`fillColor`) — zone body at partial opacity
- **Opacity** — adjustable transparency for zone marking
- **Line style** (`lineStyle`) — solid/dashed/dotted borders

This directly supports SMC supply/demand zone marking.

## Files changed

| File | Type | Change |
|---|---|---|
| `types/drawing.ts` | Modified | 8 new tools, `fillColor`, `opacity` fields |
| `drawingRenderer.ts` | Modified | 8 new render cases, shape helper functions |
| `drawingHitTest.ts` | Modified | 8 new hit-test cases |
| `DrawingToolbar.tsx` | Modified | 8 new tools, 4th category (ANNOTATIONS) |
| `DrawingLayer.tsx` | Unchanged | No changes — creation flow is generalized |
| `DrawingContextMenu.tsx` | Unchanged | No changes — context menu is tool-agnostic |
