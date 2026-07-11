# Chart Visual Profile

_Last updated: 2026-07-11_

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
| Auto-fit policy | `src/components/chart/chartAutoFitPolicy.ts` | Guards the initial viewport against realtime/history races |
| Palette and time formatting | `src/components/chart/chartTheme.ts` | Theme colors, bar spacing by timeframe, crosshair time formatter |
| Main chart | `src/components/chart/PriceChart.tsx` | Creates the candlestick chart and applies the shared profile |
| Candle countdown | `src/hooks/useCountdown.ts`, `src/components/chart/countdownPresentation.ts` | Computes the next wall-clock bar boundary and formats the visible timer |
| Candle continuity | `src/services/market-data/candleSeries.ts` | Normalizes, merges, upserts, and detects short gaps in candle data before it reaches the chart |
| Active feed bridge | `src/hooks/useMarketData.ts` | Mirrors active market candles into `chartStore` and backfills short realtime gaps |
| Market data store | `src/store/marketDataStore.ts` | Runtime source of truth for quote/candle ingress |
| Indicator panes | `src/components/chart/PriceChart.tsx` | Creates native LWC 5 panes that share the main time scale and crosshair |
| Indicator legend | `src/components/chart/IndicatorLegend.tsx` | Lightweight TradingView-style status-line controls |
| Guard tests | `tests/chart/chartVisualProfile.test.ts` | Locks critical margin/right-offset defaults |

## 4. Shared Profile Contract

All baseline chart options belong in `chartVisualProfile.ts`.

Do not duplicate these outside `chartVisualProfile.ts`:

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

If a future visual bug affects both the main chart and native panes, fix the
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
- Do not mark the initial viewport fit as complete from a tiny realtime-only
  series. `chartAutoFitPolicy.ts` allows temporary fitting for one or a few
  forming candles, then forces a second `fitContent()` when REST history expands
  the data window. This prevents the chart from staying zoomed into one giant
  candle if WebSocket data arrives before history or if the socket later fails.

## 6. Current Price Marker

The current price marker is a compact DOM overlay because the app shows both
symbol, price, and candle-close countdown. Its layout follows TradingView's
asymmetric two-level marker:

```text
┌────────┬───────────┐
│ SYMBOL │     PRICE │  <- centered on the series price coordinate
└────────┤ COUNTDOWN │
         └───────────┘
```

- The symbol occupies only the left side of the top row.
- Price and countdown form one right-hand column so the countdown background
  never extends below the symbol.
- The countdown row uses the same bull/bear marker color with a 20% dark inset.
- The triangle pointer and price line align to the vertical center of the top
  19px price row. Adding the 15px countdown row must not shift that alignment.
- Clamp the marker's price coordinate to leave 25px below it near the bottom of
  the chart; otherwise the countdown is clipped by the chart container.
- Keep the built-in series price line color synchronized with the marker's last
  movement direction.

`useCountdown` updates independently of quote arrival every 250ms and targets
the next boundary from `TF_SECONDS[timeframe]`. `formatCountdown` floors the
remaining seconds and renders:

- `M:SS` below one hour, for example `2:47` or `13:15`;
- `H:MM:SS` at one hour or above, for example `4:05:06`;
- `0:00` for an unavailable/non-positive value.

The timer is presentation-only. It does not create candles, advance Replay
time, or replace server/provider timestamps. Keep the value in visible DOM text
and retain the `title="Next bar: ..."` metadata for accessibility/inspection.

## 7. Indicator Legend

The indicator legend should read like TradingView's status line:

- transparent by default,
- dark hover background only while interacting,
- controls hidden until hover/focus,
- no heavy border box around every indicator row.

This keeps the chart header and first candles readable.

Separate indicators use Lightweight Charts 5 native panes. Because candle and
indicator series live in one chart, they share the same time scale even when an
indicator returns sparse data. Do not restore transparent anchor series or a
second chart instance to solve pane alignment.

Indicator reference guides such as Pine `hline()` and `fill()` are viewport
artifacts. They are projected by `indicatorSeriesProjection.ts` onto the current
logical viewport, including the right-offset whitespace after the latest candle.
Do not solve pane gaps by adding fake market candles, changing the main chart
right offset, or stretching dynamic plots; only series marked
`extendToVisibleRange` should receive this projection.

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
- current price marker has a one-row symbol plus a two-row price/countdown
  column, with the price row centered on the live price line,
- countdown visibly changes once per second and is not clipped near the bottom
  chart boundary,
- indicator legend does not obscure the symbol/OHLC header,
- separate RSI/MACD panes visually match the main chart baseline.

Data-continuity checks:

- after WebSocket reconnect or tab sleep, short missing-candle gaps should self-repair without F5,
- delayed realtime candles should insert by timestamp instead of being dropped,
- a history backfill should not overwrite a newer live forming bar,
- a one-candle realtime window followed by REST history should refit to the full history window,
- large closed-market gaps should not trigger repeated backfills.
