# Fibonacci Tools Maintenance

Last updated: 2026-07-03.

## TradingView Reference

Primary reference checked:
- TradingView Help Center: `Fibonacci retracement drawing tool`
  `https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/`

Key behavior from the reference:
- Fib Retracement is anchored by two extreme points.
- Horizontal levels are computed from the vertical distance between those two anchors.
- Values between `0` and `1` are internal retracement levels.
- Values greater than `1` are external retracement levels.
- Values less than `0` are extension levels available from fib settings.
- Style controls include trend line, level lines, extend left/right, background, reverse, prices,
  level labels, custom text, and font size.
- Coordinates are the two anchor prices and bars.

The clone now exposes the main TradingView-style Fib Retracement settings surface in
`ObjectSettingsDialog`: Style, Coordinates, and Visibility tabs, per-level enable/value/color rows,
background/reverse/prices/levels/labels/text/font/log-scale controls, and price/bar coordinate
inputs.

## Current Implementation

Files:
- `src/types/drawing.ts`
- `src/components/chart/drawing/tools/plugins/FibRetracementTool.ts`
- `src/components/chart/drawing/tools/plugins/FibExtensionTool.ts`
- `src/components/chart/drawing/tools/plugins/FibTool.ts`
- `src/components/chart/ObjectSettingsDialog.tsx`
- `src/components/chart/drawing/renderer/CanvasRenderer.ts`
- `src/components/toolbar/DrawingToolbar.tsx`
- `tests/drawing/fibGeometry.test.ts`

### Fib Retracement

Tool id: `fibRetracement`.

Creation:
- Two clicks.
- Point 1 and point 2 define the source trend line.

Formula:

```ts
levelPrice = point1.price + (point2.price - point1.price) * level
```

Visible preset:
- 24 TradingView-style level rows live in `DEFAULT_FIB_LEVELS`.
- Enabled by default: `0`, `0.236`, `0.382`, `0.5`, `0.618`, `0.786`, `1`,
  `1.618`, `2.618`, `3.618`, `4.236`.
- Disabled rows are still visible in settings and can be enabled or edited: `1.272`, `1.414`,
  `2.272`, `2.414`, `2`, `3`, `3.272`, `3.414`, `4`, `4.272`, `4.414`, `4.618`, `4.764`.

Renderer contract:
- Draw the dashed source trend line between the anchors. The default trend-line color is
  TradingView-style gray (`#787b86`); only use a stronger color when the user sets one explicitly.
- Draw horizontal level lines using the level prices.
- Draw subtle background bands between adjacent enabled levels when `fibBackground !== false`.
- Draw labels with level, price, and optional custom text according to `fibShowLevels`,
  `fibShowPrices`, `fibShowText`, and `fibLevelsFormat`.
- When both level and price are enabled, labels use TradingView-style `level (price)` text, for
  example `0.618 (60,112.25)`.
- Default label placement is `Left / Middle`, matching the TradingView settings reference: the text
  is positioned outside the left edge of the fib body, not inside the colored bands. When the fib is
  close to the chart's left boundary, left labels may clip at the viewport edge rather than moving
  into the fib body.
- Labels must be measured with `CanvasRenderingContext2D.measureText()` and capped before the
  right price-scale/current-price label strip. Do not put labels at `right + padding`; that
  reintroduces the right-edge overlap bug fixed after the InfoLine panel overflow issue.
- The renderer must reserve and clip away from the right price-scale/current-price label strip.
  Keep `FIB_RIGHT_PRICE_SCALE_GUARD`, `usableFibRight()`, and the `g.rect(...); g.clip()` block in
  `FibRetracementTool`, `FibTool`, and `FibExtensionTool`; otherwise lines/background bands draw
  underneath the price axis.
- Use `canvasFont()` from `plugins/shared.ts`; do not use `var(--font-*)` directly in canvas fonts.

Interaction contract:
- Anchor handles are `p1` and `p2`.
- Body hit-test must include every horizontal level plus the source trend line.
- Bounding box must include external levels, not only the original anchor price range.

### Trend-Based Fib Extension

Tool id: `fibExtension`.

Creation:
- Three clicks for new drawings.
- `minPoints: 2` is intentionally kept so the user sees a live preview after the first anchor.
- `maxPoints: 3` commits after the third click.

Points:
- A = point 1, impulse start.
- B = point 2, impulse end.
- C = point 3, projection origin after pullback.

Formula:

```ts
levelPrice = C.price + (B.price - A.price) * level
```

Existing two-point extension drawings remain supported by treating B as C:

```ts
const c = points[2] ?? points[1]
```

Renderer contract:
- Draw A-B as the impulse guide.
- Draw B-C as the projection-origin guide when C exists.
- Draw extension level rays from C toward the right side of the chart.
- Draw subtle background bands and right-side level/price labels.

Interaction contract:
- The third point must be a real draggable anchor.
- `getAnchors()` must map targets as `p1`, `p2`, `p3`; otherwise the hit-test engine cannot resolve
  anchor index 2 and C will drag as body.

### Legacy `fib`

Tool id: `fib`.

This tool remains in the toolbar and in saved drawings for backward compatibility. It mirrors the
modern retracement renderer/hit-test/settings behavior and uses `DEFAULT_FIB_LEVELS`. Do not delete
it unless a migration removes or remaps saved `tool: "fib"` drawings.

## Settings Dialog

Fib tools use `ObjectSettingsDialog`:
- Double-clicking any drawing opens settings; this includes fib objects.
- Fib Retracement title: `Fib retracement`.
- Tabs: `Style`, `Coordinates`, `Visibility`.
- Style tab mirrors TradingView's layout: trend line, levels line, extend, 24 per-level rows, use
  one color, background opacity, reverse, prices, levels value/percent mode, labels align, text
  align, font size, and log-scale toggle.
- Coordinates tab uses `#1 (price, bar)`, `#2 (price, bar)` rows. Bar is the nearest loaded candle
  index and edits snap to the selected candle's time.
- Fib setting fields are included in `CanvasRenderer.drawingsHash()` and `TEMPLATE_STYLE_KEYS`, so
  live edits repaint immediately and templates preserve fib styling.

## Regression Guard

Run:

```bash
npm run check:fibonacci-tools
```

The focused executable suite verifies:

- external fib levels are still present;
- legacy `fib` and modern retracement use the same projected-level formula;
- linear/log retracement and point-C extension formulas remain explicit;
- retracement adapters execute price-scale clipping, background, level/guide
  strokes, labels, per-level hit-testing, and external-level bounds;
- extension remains a three-click tool whose `p3` handle is independently
  movable and whose point-C-projected levels are selectable; and
- canvas fonts remain concrete CSS font strings.

The shared drawing settings, overlay, all-adapter, persistence, and browser
gesture suites cover the dialog schema, repaint/selection integration,
round-trip compatibility, and double-click settings flow. This replaces the
former source-text regex guard with executable behavior contracts.

Run this together with the normal checks before commit:

```bash
npm run typecheck
npm run lint
npm run build
```

## Known Gaps

- Negative fib levels are not in the default settings list yet, though level values are editable.
- Full TradingView per-timeframe visibility checkboxes are not implemented; Visibility currently
  keeps the app-level shown/hidden control.
- Fixed-price alerts for enabled retracement/extension levels are implemented;
  time-indexed dynamic alerts are currently limited to Fib Channel levels and
  use the contract in `DYNAMIC_DRAWING_ALERTS_PLAN.md`.
