# SHAPE TOOLS ARCHITECTURE

_Date: 2026-06-25. Updated 2026-07-04 for TradingView behavior parity._

## Tools implemented

| # | Tool | Type ID | Points | Creation | Fill Support |
|---|---|---|---|---|---|
| 1 | Rectangle | `rectangle` | 2 | Two-click opposite corners | Yes: `fillColor` + `opacity` |
| 2 | Rotated Rectangle | `rotatedRect` | 3 | Base edge + perpendicular width | Yes |
| 3 | Circle | `circle` | 2 | Center + radius click | Yes |
| 4 | Ellipse | `ellipse` | 2 | Opposite bounding corners | Yes |
| 5 | Triangle | `triangle` | 3 | Three-click | Yes |
| 6 | Polyline | `polyline` | N | Multi-click (open) | No |
| 7 | Arc | `arc` | 3 | Start + end + peak | No |
| 8 | Curve | `curve` | N | Multi-click (quadratic) | No |
| 9 | Double Curve | `doubleCurve` | 4 | Start + 2 controls + end | No |
| 10 | Path | `path` | N | Multi-click (open + terminal arrowhead) | No |

## TradingView parity update (2026-07-04)

Research sources:

- TradingView rectangle shortcut/list update, confirming Rectangle is a drawing
  tool in the shapes set and keeps the `Alt+Shift+R` shortcut:
  https://www.tradingview.com/blog/en/new-shortcuts-rectangle-shortcuts-list-42318/
- TradingView Arrow Marker and Highlighter blog references used for the adjacent
  geometry flyout behavior:
  https://www.tradingview.com/blog/en/arrow-marker-drawing-tool-18467/
  https://www.tradingview.com/blog/en/brand-new-drawing-tool-highlighter-21947/

The shape tools now share `src/components/chart/drawing/tools/plugins/shapeGeometry.ts`.
That helper owns projection, anchor hits, segment/body hits, polygon inside
checks, ellipse body checks, sampled quadratic/cubic curves, and sampled curve
bounding boxes. This keeps selection and dragging behavior consistent across
plugins instead of each shape carrying a slightly different hit-test
implementation.

Behavior fixed in this pass:

- Ellipse body hit-testing now follows the actual ellipse, not the rectangle
  bounding box.
- Triangle hit-testing includes all three edges and the filled interior.
- Polyline and Path share the same vertex/body hit behavior and bounds.
- Curve can now be selected/dragged from the curve body, not only from control
  points.
- Arc and Double Curve bounding boxes are based on sampled curve geometry, so
  viewport culling does not drop strongly curved drawings.

Verification added in this pass:

- `tests/drawing/shapeGeometry.test.ts` covers explicit anchor indices, ellipse
  body hit-testing, polygon interior/edge hit-testing, and sampled quadratic
  curve hit-testing/bounds.
- Run with `npm run test:drawing`.

## Fill system

```ts
interface Drawing {
  fillColor?: string;  // fill color (default: uses stroke color at 12% opacity)
  opacity?: number;     // fill opacity 0-1 (default: 0.15)
}
```

- `fillColor` set -> use that color at `opacity`
- `fillColor` unset -> use `color` at 12% opacity (legacy behavior preserved)
- Selection handles always render solid

## Architecture (zero core engine changes)

```
types/drawing.ts         <- 8 new tool types + fillColor/opacity fields
drawingRenderer.ts       <- 8 new render cases + shape helper functions
drawingHitTest.ts        <- 8 new hit-test cases
DrawingLayer.tsx         <- NO CHANGES (generalized creation flow from 4.2 handles it)
DrawingContextMenu.tsx   <- NO CHANGES
DrawingToolbar.tsx       <- 8 new shape tools, 4th category (ANNOTATIONS)
```

The `minPoints()` dispatcher in DrawingLayer already supports 2-point creation for the new tools (rectangle, circle, ellipse, rotatedRect) and the pending-preview system shows live previews. Triangle, polyline, curve, and path use the existing multi-point flow. Path is intentionally open with one terminal arrowhead, not a closed filled polygon.

## Rectangle - supply/demand zone workflow

The `rectangle` tool is the most important shape tool. It supports:
- **Stroke** (`color`) - zone border
- **Fill** (`fillColor`) - zone body at partial opacity
- **Opacity** - adjustable transparency for zone marking
- **Line style** (`lineStyle`) - solid/dashed/dotted borders

This directly supports SMC supply/demand zone marking.

## Files changed

| File | Type | Change |
|---|---|---|
| `types/drawing.ts` | Modified | 8 new tools, `fillColor`, `opacity` fields |
| `drawingRenderer.ts` | Modified | 8 new render cases, shape helper functions |
| `drawingHitTest.ts` | Modified | 8 new hit-test cases |
| `DrawingToolbar.tsx` | Modified | 8 new tools, 4th category (ANNOTATIONS) |
| `DrawingLayer.tsx` | Unchanged | No changes: creation flow is generalized |
| `DrawingContextMenu.tsx` | Unchanged | No changes: context menu is tool-agnostic |
