# LINE TOOLS ARCHITECTURE

_Date: 2026-07-04._

## Research sources

- User-provided TradingView Lines flyout screenshot, showing this order:
  `Trendline`, `Ray`, `Info line`, `Extended line`, `Trend angle`,
  `Horizontal line`, `Horizontal ray`, `Vertical line`, `Crossline`.
- TradingView Advanced Charts API reference lists official line-tool override
  interfaces for the same tool family, including `TrendlineLineToolOverrides`,
  `RayLineToolOverrides`, `InfolineLineToolOverrides`,
  `ExtendedLineToolOverrides`, `TrendangleLineToolOverrides`,
  `HorzlineLineToolOverrides`, `HorzrayLineToolOverrides`,
  `VertlineLineToolOverrides`, and `CrosslineLineToolOverrides`:
  https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.IChartWidgetApi/

## Toolbar contract

The Lines flyout intentionally contains only the 9 tools visible in the
TradingView reference screenshot:

| Order | Tool | Type ID | Geometry |
|---|---|---|---|
| 1 | Trendline | `trendline` | finite two-point segment |
| 2 | Ray | `ray` | one-way extension from point 1 through point 2 |
| 3 | Info line | `infoLine` | finite two-point segment + stats panel |
| 4 | Extended line | `extendedLine` | infinite line through two points |
| 5 | Trend angle | `trendAngle` | finite segment + angle annotation |
| 6 | Horizontal line | `horizontal` | full-width price line |
| 7 | Horizontal ray | `horizRay` | horizontal ray from anchor to the right |
| 8 | Vertical line | `vertical` | full-height time line |
| 9 | Crossline | `crossLine` | one anchor with horizontal + vertical lines |

`Channel` remains a registered drawing plugin for existing saved drawings, but
it is not shown in the TradingView-parity Lines flyout because it is not present
in the supplied TradingView reference menu.

## Shared geometry contract

`src/components/chart/drawing/tools/plugins/lineGeometry.ts` owns the behavior
shared by line-like tools:

- Projection from `(time, price)` anchors to screen-space points.
- Endpoint hit-testing with explicit `anchorIndex` values.
- Finite segment body hit-testing.
- Ray and Extended Line body hit-testing against the rendered extension, not
  only the short anchor-to-anchor segment.
- Horizontal Ray body hit-testing only to the right of its start point.
- Full-viewport bounds for infinite/cross tools so viewport culling does not
  hide visible extended drawings.
- Axis-constrained movement for Horizontal Line and Vertical Line.

Plugins should import these helpers instead of implementing local math unless a
tool has genuinely unique behavior.

## Drag behavior

- Two-point finite tools: body drag moves both anchors; endpoint drag moves only
  that endpoint.
- Ray and Extended Line: same anchor behavior as Trendline, but body hit-test
  follows the extended rendered line.
- Horizontal Line: dragging changes price only; stored time is preserved.
- Vertical Line: dragging changes time only; stored price is preserved.
- Horizontal Ray and Crossline: body drag moves the full one-point anchor.

## Tests

The shared contract is covered by `tests/drawing/lineGeometry.test.ts`.

Run:

```bash
npm run test:drawing
```
