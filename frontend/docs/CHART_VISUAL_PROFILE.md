# Chart Visual Profile

_Last updated: 2026-07-30_

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
- MetaTrader 5 Python `copy_rates_from`:
  https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrom_py documents
  returned candle times as UTC bar-open timestamps.
- MetaTrader 5 `ENUM_TIMEFRAMES`:
  https://www.mql5.com/en/docs/constants/chartconstants/enum_timeframes defines
  W1 as one week and MN1 as one calendar month.
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
| Candle countdown | `src/components/chart/countdownModel.ts`, `src/hooks/useCountdown.ts`, `src/components/chart/countdownPresentation.ts` | Resolves broker-aligned and calendar-month bar boundaries, updates the timer, and formats the visible value |
| Candle continuity | `src/services/market-data/candleSeries.ts` | Normalizes, merges, upserts, and detects short gaps in candle data before it reaches the chart |
| Active feed bridge | `src/hooks/useMarketData.ts` | Mirrors active market candles into `chartStore` and backfills short realtime gaps |
| Market data store | `src/store/marketDataStore.ts` | Runtime source of truth for quote/candle ingress |
| Indicator panes | `src/components/chart/PriceChart.tsx` | Creates native LWC 5 panes that share the main time scale and crosshair |
| Indicator legend | `src/components/chart/IndicatorLegend.tsx` | Lightweight TradingView-style status-line controls |
| Pane legend geometry | `src/components/chart/paneLegendLayout.ts` | Converts native pane rectangles into stable chart-local legend offsets |
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

The current price marker is a compact DOM overlay shared by desktop and mobile.
The price/countdown column is constrained to the live right price scale, while
the symbol chip extends left from the scale into the plot. The chart HUD also
retains the symbol and OHLC values.

```text
plot                    right price scale
[ SYMBOL ]              [ PRICE     ]  <- centered on the series price
                        [ COUNTDOWN ]
```

- Read `chart.priceScale("right").width()` from Lightweight Charts and use that
  exact live width for the DOM marker. Do not duplicate a guessed CSS width.
- If the scale width is unavailable or non-positive, do not render the marker.
- Price and countdown form one right-aligned column contained by the chart root.
- Symbol, price, countdown, pointer, and the built-in series price line use one
  bull/bear tone. Resolve it from the live marker price relative to the active
  candle open. Do not derive it from the previous tick: a downtick above the
  candle open remains bullish, and an uptick below the open remains bearish.
- Publish the tone once through `--current-price-marker-color`; every visible
  marker segment consumes that shared CSS custom property. Do not write separate
  dynamic colors to the child segments because mobile Safari may display a
  split-color frame while the quote is repainting.
- The countdown row uses the shared marker tone with a 20% dark inset.
- The price line aligns to the vertical center of the 19px price row. Adding the
  15px countdown row must not shift that alignment.
- Clamp the marker's price coordinate to leave 25px below it near the bottom of
  the chart; otherwise the countdown is clipped by the chart container.
- Keep `price-chart-root` overflow-contained so chart overlays cannot bleed into
  the market sidebar. This is a containment guard, not a replacement for portal
  positioning of interactive menus.

`PriceChart` passes the latest candle's UTC open timestamp into `useCountdown`.
For MT5 symbols it also passes the latest authoritative broker-session status.
The hook updates independently of quote arrival every 250ms, while
`countdownModel` owns boundary calculation:

- MT5 prefers the broker observation clock when it is available. Missing,
  unknown, closed, or expired session status falls back to the browser clock,
  so a temporary session-feed outage cannot remove timers from every chart.
  `countdownModel` still anchors the timer to the latest concrete candle and
  rejects that timer as soon as the candle's own close has elapsed, so a stale
  candle cannot invent countdowns while its market is closed.

- `1m` through `1W` advance by their fixed duration from the source candle
  anchor. This preserves the broker's actual daily and weekly session alignment
  instead of anchoring W1 to Unix epoch Thursday.
- `1M` advances from the source candle with UTC calendar arithmetic. Do not use
  the approximate `TF_SECONDS["1M"]` value for countdowns because months contain
  28, 29, 30, or 31 days.
- A real source candle identifies one specific forming bar. Once its boundary
  has elapsed, the model returns no countdown instead of rolling that candle
  through empty weekend or closed-session intervals. When no usable candle
  anchor exists, the normal epoch/week/calendar fallback locates the current
  bucket. The timer never mutates candle data.

`formatCountdown` formats the remaining whole-second value and renders:

- `M:SS` below one hour, for example `2:47` or `13:15`;
- `H:MM:SS` at one hour or above, for example `4:05:06`;
- `Dd HH:MM:SS` when at least one day remains, for example `3d 17:10:00`;
- `0:00` for an unavailable/non-positive value.

Day-bearing labels use a compact, non-wrapping countdown row so they stay
inside the live price-scale width.

The timer is presentation-only. It does not create candles, advance Replay
time, or replace server/provider timestamps. Keep price and countdown in visible
DOM text. Preserve the symbol, formatted price and next-bar countdown in the
marker's `aria-label` and `title` for accessibility and inspection.

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

Native pane geometry is owned by Lightweight Charts, not React. `PriceChart`
must not call `getBoundingClientRect()` while rendering a pane legend. It
observes the chart container and every indicator pane with one
`ResizeObserver`, coalesces measurements through `requestAnimationFrame`, and
stores offsets keyed by the current ordered indicator signature. A legend
remains hidden until its pane has a non-zero measured height. This common path
applies to every separate-pane indicator and keeps legends aligned after
add/remove/reorder, chart resize, and pane-height changes.

Indicator reference guides such as Pine `hline()` and `fill()` are viewport
artifacts. They are projected by `indicatorSeriesProjection.ts` onto the current
logical viewport, including the right-offset whitespace after the latest candle.
Do not solve pane gaps by adding fake market candles, changing the main chart
right offset, or stretching dynamic plots; only series marked
`extendToVisibleRange` should receive this projection.

Indicator runtime payloads cross a JSON boundary. Pine warm-up values may
therefore arrive as `null` even though `LinePoint.value` is statically typed as a
number. `finiteIndicatorSeriesData()` is the common native-chart boundary: it
drops points with non-finite time/value before Line, Histogram, or Baseline
writes. Keep this guard ahead of viewport and Replay-cutoff projection so rapid
symbol changes cannot feed a transient null into Lightweight Charts. The helper
must preserve the original array reference when every point is valid and reuse
one filtered projection per immutable runtime snapshot. Re-scanning or
re-allocating the same malformed series on every live/Replay render can cause
visible chart jitter.

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
- every separate-pane indicator legend starts inside its owning pane and stays
  aligned after resizing the chart or changing pane heights,
- current price marker keeps symbol, price, countdown, pointer, and horizontal
  line on one candle-direction tone on both desktop and mobile,
- marker price/countdown matches the live right price-scale width and never
  overlaps the market sidebar,
- countdown visibly changes once per second and is not clipped near the bottom
  chart boundary,
- W1 follows the latest broker candle open and retains the remaining day count,
- MN1 closes at the next UTC calendar-month boundary, including leap February,
- indicator legend does not obscure the symbol/OHLC header,
- separate RSI/MACD panes visually match the main chart baseline.

Data-continuity checks:

- after WebSocket reconnect or tab sleep, short missing-candle gaps should self-repair without F5,
- delayed realtime candles should insert by timestamp instead of being dropped,
- a history backfill should not overwrite a newer live forming bar,
- a one-candle realtime window followed by REST history should refit to the full history window,
- large closed-market gaps should not trigger repeated backfills.

Rendered geometry is locked by
`tests/browser/desktopOverlayRegression.spec.ts`. The test compares the marker
rectangle with Lightweight Charts' live plot and price-scale cells at 1366px,
asserts that all visible marker segments resolve the same background color, then
repeats the geometry assertion after resizing to 1100px.
