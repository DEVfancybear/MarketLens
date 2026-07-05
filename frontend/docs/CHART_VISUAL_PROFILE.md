# Chart Visual Profile

_Last updated: 2026-07-05_

This document is the maintenance guide for the TradingView-like chart visual
baseline. Read this before changing chart colors, grid density, price scale
width, current price marker, indicator pane styling, or optional volume studies.

## 1. Goal

The app should feel like a professional TradingView-style trading chart, not a
generic terminal canvas. The visual baseline is intentionally quiet:

- dark neutral chart background,
- faint grid lines,
- compact right price scale,
- compact current price marker,
- lightweight indicator legend,
- matching style between the main chart and separate indicator panes.

## 2. Research Sources

- User-provided TradingView comparison screenshots from 2026-07-05.
- TradingView Lightweight Charts `ChartOptionsBase`: the chart baseline is
  controlled by layout, price scales, time scale, grid, crosshair, scroll/scale,
  and kinetic scroll options.
- TradingView Lightweight Charts `CandlestickStyleOptions`: candlestick color,
  wick, border, and price-line options are series options, not DOM overlays.
- TradingView Lightweight Charts `PriceScaleOptions`: price scale margins,
  border, text color, `minimumWidth`, and `entireTextOnly` control the right
  axis and visible candle area.
- TradingView Lightweight Charts `Price and volume on a single chart`
  (https://tradingview.github.io/lightweight-charts/tutorials/how_to/price-and-volume):
  volume is a study added as a separate histogram series. It is not part of the
  candlestick series itself, so this app should not render volume by default on
  every chart.

## 3. Key Files

| Area | File | Responsibility |
|---|---|---|
| Shared visual profile | `src/components/chart/chartVisualProfile.ts` | Common constants and option builders for chart, scales, grid, crosshair, and candles |
| Palette and time formatting | `src/components/chart/chartTheme.ts` | Theme colors, bar spacing by timeframe, crosshair time formatter |
| Main chart | `src/components/chart/PriceChart.tsx` | Creates the candlestick chart and applies the shared profile |
| Indicator panes | `src/components/chart/IndicatorPane.tsx` | Uses the same profile for pane grid/axis/crosshair styling |
| Indicator legend | `src/components/chart/IndicatorLegend.tsx` | Lightweight TradingView-style status-line controls |
| Guard tests | `tests/chart/chartVisualProfile.test.ts` | Locks critical margin/right-offset defaults |

## 4. Shared Profile Contract

All baseline chart options belong in `chartVisualProfile.ts`.

Do not duplicate these in `PriceChart` or `IndicatorPane`:

- `RIGHT_OFFSET_BARS`,
- `MIN_BAR_SPACING`,
- `PRICE_SCALE_MIN_WIDTH`,
- `MAIN_PRICE_SCALE_MARGINS`,
- `INDICATOR_PANE_HEIGHT`,
- `timeScaleDefaults`,
- `mainPriceScaleOptions`,
- `panePriceScaleOptions`,
- `timeScaleOptions`,
- `gridOptions`,
- `layoutOptions`,
- `transparentLayoutOptions`,
- `crosshairOptions`,
- `candlestickOptions`.

If a future visual bug affects both the main chart and pane charts, fix the
profile first.

## 5. Main Chart Rules

- Use `layoutOptions(theme)` for background/text.
- Use `gridOptions(theme, gridVisible)` for grid changes.
- Use `mainPriceScaleOptions(theme)` for right price scale width/margins.
- Use `timeScaleOptions(theme, timeframe)` on creation and when timeframe
  changes.
- Use `candlestickOptions(theme, precision)` for candle colors, wick style, and
  current price-line behavior.
- Do not create a default volume histogram in `PriceChart`. Volume is an
  explicit study/indicator. Scripts such as VSA Volume should render through the
  indicator pipeline, not through the chart baseline.

## 6. Current Price Marker

The current price marker is a compact DOM overlay because the app shows both
symbol and price in one chip. It should remain a single-line chip on the right
edge. Avoid stacking symbol, price, and countdown vertically; that covers too
much chart area compared with TradingView.

The countdown can remain as metadata/title or move to a dedicated status area,
but it should not increase the price chip height.

## 7. Indicator Legend

The indicator legend should read like TradingView's status line:

- transparent by default,
- dark hover background only while interacting,
- controls hidden until hover/focus,
- no heavy border box around every indicator row.

This keeps the chart header and first candles readable.

## 8. Verification

Run:

```bash
npm run test:chart
npm run typecheck
npm run lint
npm run build
```

Manual checks:

- chart background reads neutral black, not blue terminal,
- grid is visible but low contrast,
- right price axis is stable and wide enough for BTC/forex labels,
- no volume bars are visible on a clean default chart,
- adding a Volume/VSA indicator still renders volume through the indicator path,
- current price marker is one compact line,
- indicator legend does not obscure the symbol/OHLC header,
- separate RSI/MACD panes visually match the main chart baseline.
