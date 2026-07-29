# TOOL GROUP ARCHITECTURE — Phase 4.2.2

_Date: 2026-06-26. Updated 2026-07-28 for current TradingView group parity._

## TradingView pattern

TradingView groups related drawing tools behind a single sidebar icon:

```
Sidebar:           Flyout (on click):
┌──────────┐       ┌─────────────────────┐
│  Cursor  │       │                     │
│  ─────── │       │                     │
│  Lines   │  →    │  Trend line         │
│  Shapes  │       │  Ray                │
│  Text    │       │  Extended line      │
│  ─────── │       │  Horizontal line    │
│  Color   │       │  Horizontal ray     │
│  Clear   │       │  Vertical line      │
└──────────┘       │  Cross line         │
                   │  Info line          │
                   └─────────────────────┘
```

## Groups implemented

| Group | Default Tool | Tools |
|---|---|---|
| Cursor | crosshair | crosshair, dotCursor, cursor, demonstrationCursor, magicCursor, eraser |
| Lines | trendline | trendline, ray, infoLine, extendedLine, trendAngle, horizontal, horizRay, vertical, crossLine |
| Geometry | rectangle | brush, highlighter, arrow, arrowMarker, arrowMarkUp, arrowMarkDown, rectangle, rotatedRect, path, circle, ellipse, polyline, triangle, arc, curve, doubleCurve |
| Fibonacci/Gann | fibRetracement | fibRetracement, fibExtension, fibChannel, fibTimeZone, fibSpeedFan, trendFibTime, fibCircles, fibSpiral, fibSpeedArcs, fibWedge, pitchfan, gannFan, gannSquare, gannBox |
| Annotations | text | text, note, priceNote, pin, table, callout, comment, priceLabel, signpost, flag, image, socialEmbed |
| Icons | emoji | emoji |

## Geometry flyout parity update

Updated 2026-07-04 after checking TradingView's Highlighter and Arrow Marker
references plus comparable TradingView-like chart tool menus:

- TradingView presents this as one combined geometry flyout, not as separate
  Brush and Shapes flyouts. The UI section order is `BRUSHES`, `ARROWS`, then
  `SHAPES`.
- `Brush` and `Highlighter` share the same pointer-drag freehand interaction.
  Highlighter renders with a wider semi-transparent stroke by default.
- `Arrow marker` and `Arrow` are two-point tools. The first click sets the tail;
  the second click sets the arrow tip and direction.
- `Arrow mark up/down` are the current one-point marker tools anchored to a
  single `(time, price)` location with fixed screen-space size. Historical
  left/right IDs remain loadable but are hidden from new-creation menus.
- `SHAPES` follows the observed TradingView order: Rectangle, Rotated
  rectangle, Path, Circle, Ellipse, Polyline, Triangle, Arc, Curve, Double
  curve.
- Toolbar entries are not enough. Each persistent tool must also exist in
  `DrawingTool`, `DRAWING_TOOLS`, and a self-registering plugin under
  `src/components/chart/drawing/tools/plugins/`.

## Lines flyout parity update

Updated 2026-07-04 after checking the TradingView Lines flyout screenshot and
TradingView Advanced Charts line-tool override names:

- The parity flyout contains 9 tools in this order: `Trendline`, `Ray`,
  `Info line`, `Extended line`, `Trend angle`, `Horizontal line`,
  `Horizontal ray`, `Vertical line`, `Crossline`.
- `Channel` remains a registered plugin for existing saved drawings but is not
  exposed in this flyout because it is not present in the TradingView reference
  screenshot.
- Line plugin behavior is centralized in `lineGeometry.ts`. Ray and Extended
  Line hit-tests follow their rendered extensions, Horizontal Ray only selects
  to the right of its start anchor, and Horizontal/Vertical Line movement is
  axis-constrained.

## Last-used tool per group

When the user selects "Ray" from the Lines flyout, the sidebar icon changes to the Ray icon. Future clicks on the Lines group button open the flyout while showing the Ray icon. This matches TradingView's behavior where "the last selected tool becomes the visible icon."

Implemented via `useLastUsed()` hook that tracks `lastUsed[groupId]` state.

## Flyout behavior

- Click group button → open flyout (positioned at `left-full`, z-50)
- Click a tool in flyout → activate tool, close flyout
- Click group button again → toggle flyout closed
- Click anywhere outside (backdrop) → close flyout
- Only ONE flyout open at a time

## Favorites floating toolbar

Updated 2026-07-05 after rechecking the user-provided TradingView reference and
TradingView chart behavior:

- Favorites render as a separate floating toolbar on top of the chart, not as a
  quick-access strip inserted into the main left drawing toolbar.
- The floating toolbar reads the same favorite set as the flyout star controls.
  Authenticated mode loads/saves it through `GET/PUT /api/v1/drawing-tool-favorites`;
  `tv:favTools` remains the anonymous/cache fallback.
- One click activates a favorite tool. Right-click removes it from favorites.
- The toolbar has a grip handle and uses the shared draggable-dialog hook so it
  can be moved without duplicating drag/clamp math.
- It must keep `data-chart-ui` and `data-drawing-toolbar`; otherwise clicks on
  favorite buttons can start chart drawing or clear selection.

## Backdrop

A `fixed inset-0 z-40` transparent div closes the flyout on outside click. Placed between the flyout (z-50) and the canvas (z-5), ensuring clicks outside the flyout don't reach the chart during flyout interaction.

## Visual parity

- 18px icons on sidebar, 14px icons in flyout
- TradingView-dark flyout background (`bg-terminal-panel-2`)
- 1px border (`border-terminal-border`)
- 11px text, 12px padding, 6px border-radius
- Active tool highlighted in blue (`text-brand`)
- Hover: `bg-terminal-hover`
