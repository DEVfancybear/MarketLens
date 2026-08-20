# Zoom And Viewport Sync Architecture

_Last updated: 2026-08-10_

This document is the maintenance guide for TradingView-style zoom/pan behavior
and overlay synchronization. Read this before changing `PriceChart`,
`DrawingLayer`, SMC overlays, custom indicator DOM labels, replay viewport
behavior, or any code that projects `(time, price)` into pixels.

## 1. Problem

Lightweight Charts 5.2 renders candles, axes, overlay indicators, and separate
indicator panes inside one chart instance. Drawings, SMC objects, alert
overlays, Pine object labels, and dashboards are still rendered outside that
internal renderer as React DOM or separate canvas layers.

That means every overlay must manually stay synchronized with the chart's
current projection:

```
(time, price) -> (x, y)
```

If an overlay misses any zoom/pan/resize/scale event, it will lag behind the
candles or snap into place only after a later repaint.

## 2. External Behavior To Match

TradingView-like chart interaction includes:

- mouse-wheel horizontal zoom,
- trackpad/pinch zoom,
- drag-to-pan,
- price-axis drag scaling,
- time-axis drag scaling,
- double-click axis reset,
- right-offset/real-time scrolling,
- chart resize and pane resize,
- data-window replacement during replay jumps.

The chart and overlays must move as one visual unit. A user should never see
candles/grid move first and drawings/labels follow later.

## 3. Key Files

| Area | File | Responsibility |
|---|---|---|
| Main chart setup | `src/components/chart/PriceChart.tsx` | Creates Lightweight Chart, owns `ChartContext.version`, projects Pine labels/dashboards |
| Price-axis interaction | `src/components/chart/chartPriceScalePan.ts` | Owns plot-pan activation and resilient price-axis scaling through public LWC APIs |
| Viewport controller | `src/components/chart/chartViewportController.ts` | Single programmatic viewport writer with cause/revision attribution |
| Shared viewport events | `src/components/chart/chartViewportEvents.ts` | Single invalidation contract for chart zoom/pan/scale/resize input |
| Crosshair normalization | `src/components/chart/crosshairSynchronization.ts` | Converts LWC time values to UTC timestamps before store publication |
| Pane width metrics | `src/components/chart/chartPaneMetrics.ts` | Measures native pane plot widths after autoscale/resize |
| Drawing overlay | `src/components/chart/DrawingLayer.tsx` | Projects drawings and starts drawing render loop |
| Drawing renderer | `src/components/chart/drawing/renderer/CanvasRenderer.ts` | Dirty-driven rAF loop, viewport follow-window, memo guard |
| Coordinate cache | `src/components/chart/drawing/renderer/CoordinateCache.ts` | Frame-local `(time,price) -> pixel` cache |
| Chart context | `src/components/chart/ChartContext.tsx` | Exposes `chart`, `candleSeries`, visible candles, and `version` |
| Time navigation | `src/components/chart/ChartTimeToolbar.tsx`, `src/components/chart/chartTimeNavigation.ts` | Applies shortcut/date/range navigation through the chart time scale |
| SMC overlay | `src/components/smc/SmcLayer.tsx` | Repaints from `ChartContext.version` |
| Indicator panes | `src/components/chart/PriceChart.tsx` | Owns native LWC panes and their series |
| Replay viewport | `src/components/chart/replayViewport.ts`, `src/components/chart/PriceChart.tsx` | Presentation-only realignment after server reset/upsert windows |
| Browser guard | `tests/browser/chartViewportSync.spec.ts` | Crosshair, zoom, timeframe transition, indicator-pane width, resize, and prepend interactions |

## 4. Source Of Truth

The source of truth for projection is the live Lightweight Charts instance:

```ts
chart.timeScale().timeToCoordinate(time)
candleSeries.priceToCoordinate(price)
```

Do not persist pixels in drawing/indicator/SMC state. Persist only domain
coordinates:

```ts
{ time, price }
```

Every render must re-project domain coordinates into pixels with the current
chart state.

## 5. Shared Viewport Event Contract

All overlay invalidation should use:

```ts
subscribeChartViewportEvents(chart, callback)
```

File:

```txt
src/components/chart/chartViewportEvents.ts
```

This helper reports `range`, `size`, or `input` and listens to:

- `timeScale().subscribeVisibleLogicalRangeChange`
- `timeScale().subscribeSizeChange`
- chart-root `wheel`
- chart-root `dblclick`
- chart-root touch events for pinch/trackpad-like interaction
- chart-root pointer events while buttons are down

It also returns a cleanup function that unsubscribes everything.

Why both LWC subscriptions and DOM input events are needed:

- Logical range changes catch normal horizontal pan/zoom.
- Time-scale size changes catch axis/pane layout changes.
- DOM input events catch interaction paths where LWC's internal canvas updates
  before the logical-range callback or where price-scale projection changes
  without horizontal range movement.
- Only `input` may call `viewportController.beginUserInteraction()`. A delayed
  LWC range callback after a programmatic write must not steal viewport
  ownership by being mislabeled as user input.

## 6. PriceChart Contract

`PriceChart` creates the chart and owns `ChartContext.version`.

The version must bump on every viewport-relevant change:

```ts
const unsubscribeViewportEvents = subscribeChartViewportEvents(chart, bump);
```

`ChartContext.version` is consumed by overlays that are not part of Lightweight
Charts' native renderer. Any overlay that derives pixels from chart APIs must
repaint or recompute when `version` changes.

Do not add one-off wheel/pointer subscriptions inside individual overlays if
the interaction changes chart projection. Add it to `chartViewportEvents.ts`.

Programmatic viewport behavior:

- Install one `ChartViewportController` when the main chart is created.
- Shortcut, Go-to date, auto-fit, history restore, replay recovery, reset, and
  benchmark writes must call controller methods instead of `ITimeScaleApi`
  mutation methods directly.
- The first non-empty live window after a symbol or timeframe change uses the
  controller's `market-change` reset. This restores default spacing, scrolls to
  real time, and re-enables price auto-scale so a new market opens around its
  current price instead of inheriting an offscreen/manual viewport.
- A market identity change first cancels any active price gesture with
  `endPriceScalePan()`, without enabling autoscale against the outgoing market.
  Candle and native indicator series then reconcile in layout effects before
  the controller performs the one deferred `market-change` transaction.
- Runtime theme, grid, locale, and time-format updates may apply only
  `timeScaleRuntimeOptions()`. They must not contain `barSpacing`, `rightOffset`,
  or `minBarSpacing`; those values are viewport state, not presentation state.
- A latest MT5 history page may reach the browser as an explicitly stale or
  `refreshPending` cache while the native timeframe is warming. Never publish
  that page to `marketDataStore`, even as a temporary first paint. It can omit
  the current bar, causing Lightweight Charts to shift one bar and recalculate
  price autoscale when the authoritative page replaces it. Keep the exact cold
  key loading and publish only `canPublishMt5HistoryPage(page) === true`; this
  rule applies to the active chart and inactive layout-pane previews.
- If a pending MT5 cache completes without becoming publishable, clear the
  pending-poll mode and escalate the next attempt to an explicit full refresh.
  Do not display or poll an unverified cache indefinitely.
- The controller records `revision`, `programmaticWrites`, `cause`, and the
  current logical range. Equal targets are acknowledged without incrementing
  the write count.
- Programmatic writes retain their cause during LWC settling callbacks. A real
  wheel/pointer/touch input immediately cancels that settling ownership.
- Keep all range/date math in `chartTimeNavigation.ts`; the toolbar is only an
  adapter from UI events to the controller.

Horizontal deep-zoom behavior:

- `chartZoomLimits.ts` owns one responsive policy for desktop, split layouts,
  browser zoom, and mobile. Do not add viewport-specific zoom branches.
- The maximum spacing is derived from the live pane width minus the rendered
  price-scale width. Match TradingView's native extreme of two visible bar
  slots, so `maxBarSpacing` is one half of the current plot width.
- Apply the policy immediately after chart creation and again after every
  `ResizeObserver` chart resize. Lightweight Charts clamps an already-deep
  viewport when the responsive maximum changes.
- Keep the explicit responsive maximum rather than relying on `0`; it documents
  the TradingView parity contract and makes resize behavior directly testable.
- Use the shared 16-pixel initial spacing for every timeframe. A fresh
  live-market window resets to that latest-bar viewport instead of calling
  `fitContent()` and shrinking all downloaded history into tiny candles.
- Candle bodies, borders, and wicks remain rendered by the native
  Lightweight Charts candlestick series. At equivalent spacing its body width
  is approximately 78% of the slot, matching the measured TradingView geometry.

Desktop pan behavior:

- `handleScroll.pressedMouseMove` must stay enabled so users can drag the chart
  horizontally with the mouse.
- `handleScale.axisPressedMouseMove.time` follows the chart's interactive mode,
  but `handleScale.axisPressedMouseMove.price` must stay `false`.
  `chartPriceScalePan.ts` owns price-axis scaling so an interrupted release
  cannot strand Lightweight Charts' private `startScale()` snapshot and reject
  later drags.
- A primary pointer gesture is classified from the native pane rectangle and
  right price-scale width. Price-axis movement starts from
  `getVisibleRange()`, follows the Lightweight Charts scaling curve, and writes
  through `setVisibleRange()`. Do not call or emulate private
  `startScale()`/`endScale()` state.
- Lightweight Charts does not vertically pan a pane while its price scale is
  in auto-scale mode. `chartPriceScalePan.ts` arms a possible gesture on primary
  `pointerdown`, then calls `setAutoScale(false)` for that pane on the first
  real capture-phase `pointermove`. A click without movement must leave
  auto-scale enabled.
- Pointer movement is observed on `window` during an active gesture so scaling
  continues when the cursor leaves the pane. Pointer up/cancel,
  `lostpointercapture`, window blur, a hidden document, chart teardown, and a
  later move with no primary button all clear ownership. Every cleanup path is
  idempotent.
- Keep native axis double-click reset enabled. It restores auto-scale after a
  manual price-axis range, while `resetPriceScalePan()` remains the
  application-driven reset for all panes.
- The chart Reset action calls `resetPriceScalePan()` to restore auto-scale on
  every pane. Symbol/timeframe changes must only cancel an unfinished gesture
  at their boundary; their later controller-owned `market-change` reset restores
  auto-scale after the new candle and indicator series have reconciled.
- Secondary mouse buttons and non-primary pointers must not change price-scale
  mode. Overlay interactions outside the native pane must also remain ignored.
- `kineticScroll.mouse` must stay disabled. TradingView-style desktop pan stops
  when the mouse is released; mouse inertia makes the chart coast too far and
  feels like the chart is "trôi tuột".
- `kineticScroll.touch` can stay enabled for mobile/tablet gestures, where
  kinetic scrolling is expected.
- Do not re-apply default `barSpacing` / `rightOffset` from live chart option
  refreshes, including the render that observes a new timeframe. Apply defaults
  on chart creation, then only through `ChartViewportController.reset()` for a
  market change. A direct `timeScale.applyOptions()` write can emit an
  unattributed logical-range callback and create a second visible scale step.

## 7. Drawing Render Loop

Drawings are painted by `createRenderLoop()` in `CanvasRenderer.ts`.

The loop is dirty-driven:

```ts
markDirty(force?, followViewport?)
```

Meanings:

- `markDirty()` schedules one rAF render and lets the memo guard decide whether
  pixels changed.
- `markDirty(true)` bypasses the memo guard for one frame.
- `markDirty(true, true)` starts a short viewport follow-window and keeps
  forcing rAF renders while Lightweight Charts settles zoom/autoscale.

Viewport changes must use:

```ts
markDirty(true, true)
```

Regular drawing data edits can use:

```ts
markDirty()
```

## 8. Viewport Follow-Window

Wheel zoom, pinch, axis drag scaling, and autoscale can settle across multiple
browser frames. If the drawing canvas repaints once, it can sample an
intermediate projection and appear one step behind candles.

`CanvasRenderer` solves this with:

```ts
VIEWPORT_FOLLOW_MS
viewportFollowUntil
```

During that short window, frames force `forceNext = true` and schedule another
rAF. This is intentionally in the renderer layer because every drawing tool
shares the same projection.

Do not implement per-tool zoom fixes.

## 9. Memo Guard

The drawing renderer avoids unnecessary repaints by hashing render-relevant
state:

- drawing ids,
- point `(time, price)` values,
- text/style/fib settings,
- selected drawing,
- hidden state,
- active tool,
- live drag points,
- machine state,
- hovered drawing id,
- full multi-selection set,
- canvas size,
- `forceNext`.

Viewport movement changes pixels without changing drawing data. That is why
viewport changes must set `forceNext`.

## 10. Coordinate Cache

`CoordinateCache` is valid only within a single render frame.

It must be cleared at the start of every draw:

```ts
coordCache.nextFrame()
```

The cache key is only `time` or `price`, not viewport. Reusing it across frames
will freeze drawings at old pixel coordinates.

`drawingTimeToCoordinate()` owns the shared whitespace projection used by the
interactive `DrawingLayer` and inactive multi-chart preview layers. It exists
because `timeScale().timeToCoordinate()` returns `null` for drawing points
placed beyond loaded candles, while TradingView still keeps position boxes,
rays, and extended objects visually attached in right-side whitespace. Do not
replace this with raw pixel persistence or fork another preview-only projector.

## 10.1 Drawing Culling

`SpatialIndex` must index each tool by its adapter `boundingBox()`, not by raw
anchor points. Many TradingView-style tools render outside their anchors:

- horizontal lines,
- vertical/cross lines,
- rays and extended lines,
- rectangle `Extend`,
- fib levels,
- long/short position labels and zones.

If a plugin's rendered geometry extends beyond its anchors, update that
plugin's `boundingBox()` and `hitTest()` together. Otherwise pan/zoom can cull a
visible drawing or make the extended portion impossible to select.

## 11. Native Indicator Panes

Separate indicators use Lightweight Charts 5 native panes inside the main
chart. `PriceChart` creates preserved panes with `chart.addPane(true)` and adds
each indicator series with its pane index:

```ts
chart.addSeries(LineSeries, options, paneIndex)
```

All panes therefore share one time scale, crosshair lifecycle, resize
transaction, logical range, and right-side whitespace projection. Do not
reintroduce a second chart instance or copy ranges with
`setVisibleLogicalRange()`.

Pane ownership rules:

- pane `0` contains candles and overlay indicators;
- separate indicators occupy stable panes `1..n` in store order;
- empty panes are preserved while an indicator is hidden so toggling visibility
  does not reorder the remaining panes;
- changing pane membership rebuilds indicator series before panes are removed,
  preventing stale series handles;
- every separate pane applies the shared price-scale visual profile and fixed
  initial height, while the LWC separator remains user-resizable.

Indicator viewport hysteresis rules:

- `extendToVisibleRange` reference guides can place synthetic future timestamps
  in right-offset whitespace. Those timestamps participate in Lightweight
  Charts' shared logical timeline, so their projection must never recursively
  rebuild itself from the range change that the same endpoint produced.
- `resolveCandleViewport()` owns the overscan hysteresis. When overscan is
  clamped to candle index `0` or the latest candle index, that dataset edge is a
  valid safe boundary; do not require a one-bar inset outside the available
  data. Doing so makes every live-tail notification create a new revision and
  can oscillate the native range by exactly one bar indefinitely.
- A viewport revision changes only after the visible candle window leaves the
  retained overscan safety area. Small logical-range settling or synthetic
  guide jitter at a clamped live edge must retain the existing revision.

The old separate-chart `IndicatorPane` and transparent time-anchor bridge were
deleted after the native-pane browser regression suite passed. Do not restore
them as a fallback.

Crosshair events are normalized to UTC seconds before updating
`crosshairAtom`. Moving across panes at the same x coordinate must publish the
same timestamp; indicator price values remain pane-local.

`measureChartPaneMetrics()` reads each pane element's rendered plot width. The
width drift must remain at most one CSS pixel after price autoscale, window
resize, or pane resize. A larger drift increments the
`pane.width.mismatches` performance counter and fails the browser guard.

## 12. Replay Data-Window Replacement

Replay changes viewport in two ways:

1. Normal playback appends one visible candle.
2. Date jump/scrubber/restart/re-select replaces the visible data window.

For replay replacement, `PriceChart` realigns the viewport only when replay is
active and the visible logical range no longer intersects the replay data:

```ts
keepLatestBarInView(chart, dataLength)
```

This preserves current zoom width and moves the right edge to the newest candle
in the replacement slice. It prevents looking at empty future whitespace.

Do not use this path for ordinary realtime/history refreshes. If the user pans
or zooms into right-side whitespace, a later MT5 refresh or gap backfill must
leave that logical range alone; otherwise the chart snaps back to its previous
position after a delay.

Do not call `fitContent()` from individual replay controls.

## 13. Maintenance Rules

- Store domain coordinates, never pixels.
- Route every application-driven main-chart viewport mutation through
  `ChartViewportController`.
- Route projection-changing events through `chartViewportEvents.ts`.
- Use `ChartContext.version` for DOM/canvas overlay recomputation.
- Use `markDirty(true, true)` for chart viewport changes.
- Use `markDirty()` for drawing data changes.
- Keep coordinate caches frame-local.
- Keep whitespace projection caches viewport-versioned.
- Keep drawing viewport culling adapter-owned via `boundingBox()`.
- Do not add per-tool zoom patches.
- Always unsubscribe LWC and DOM event handlers on teardown.

## 14. Manual Smoke Test

1. Open `http://localhost:3000`.
2. Draw a trendline across two candle highs/lows.
3. Draw a rectangle around several candles.
4. Draw a fib retracement.
5. Mouse-wheel zoom in/out quickly over the chart body.
6. Keep zooming in until the limit is reached, then resize between compact and
   wide layouts. The extreme slot must remain half the actual plot width.
7. Drag the chart horizontally.
8. Drag the price axis vertically to scale price.
9. Repeat the price-axis drag at least 20 times, alternating up and down.
10. During one price-axis drag, move outside the pane or switch window focus,
   then return and start another drag.
11. Drag the time axis horizontally to scale time.
12. Double-click axes to reset scale.
13. Start replay and jump to a date in the past.
14. Add one overlay and one separate-pane indicator, then repeatedly switch
    `5m -> 15m -> 30m -> 15m` on the same symbol.

Expected:

- candles, grid, drawings, SMC overlays, and custom labels remain visually pinned;
- no drawing waits for a later repaint before snapping into place;
- a fresh market opens at the shared TradingView-like candle density;
- deepest horizontal zoom reaches TradingView's two-slot extreme on both
  mobile and desktop without a fixed screenshot or viewport dimension;
- every price-axis drag changes the visible range without requiring a refresh;
- an interrupted drag never blocks the next drag, and double-click restores auto-scale;
- replay jump does not show an empty chart;
- timeframe transitions perform one latest-market reset without a transient
  candle/indicator scale pulse;
- drawing selection handles remain aligned after zoom/pan.

## 15. Required Checks

Run these before committing viewport or drawing renderer changes:

```txt
npm run check:drawing-viewport
npm run check:fibonacci-tools
npm run check:position-hit
npm run test:chart
npm run test:chart-browser
npm run typecheck
npm run lint
npm run build
```

For replay-related viewport changes, also run:

```txt
npm run check:replay-logic
```

## 16. Lightweight Charts 5 Migration Contract

The application is pinned to Lightweight Charts `5.2.0`.

Required v5 API forms:

- create built-in series with `chart.addSeries(SeriesDefinition, options,
  paneIndex?)`;
- render trade execution markers through `createSeriesMarkers()` and detach the
  plugin on chart-context teardown;
- create separate indicator areas with native pane APIs;
- keep policy-only modules free of runtime LWC imports because v5 is ESM-only
  and the pure regression suite currently emits CommonJS.

Do not restore v4 calls such as `addLineSeries`, `addCandlestickSeries`, or
`series.setMarkers`.

## 17. Synchronization Policy

Use the representation that matches the relationship being synchronized:

| Relationship | Synchronization key |
|---|---|
| Candles and native indicator panes | Shared chart time scale; no bridge |
| Main-chart canvas/DOM overlays | Live chart projection plus viewport version |
| Same-timeline auxiliary views | Logical range |
| Different symbol or timeframe charts | Absolute UTC time range |
| Cross-chart crosshair | UTC timestamp, snapped locally to the nearest bar |
| Price axes | Independent unless an explicit ratio-lock feature is enabled |

Logical indices must not be copied between charts with different candle
calendars. Index `100` is only meaningful inside the timeline that created it.

## 18. External References

- Lightweight Charts 5 time scale:
  <https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ITimeScaleApi>
- Lightweight Charts scale options:
  <https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScaleOptions>
- Lightweight Charts 5.2 price-scale lifecycle source:
  <https://github.com/tradingview/lightweight-charts/blob/v5.2.0/src/model/price-scale.ts>
- Lightweight Charts native panes:
  <https://tradingview.github.io/lightweight-charts/tutorials/how_to/panes>
- Lightweight Charts v4 to v5 migration:
  <https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5>
- Lightweight Charts v5 integration skill (time, range, panes, markers, and
  public coordinate-conversion APIs):
  <https://github.com/tradingview/lightweight-charts/blob/master/.github/skills/lightweight-charts/SKILL.md>
- TradingView multi-chart synchronization:
  <https://www.tradingview.com/support/solutions/43000629992-how-to-sync-the-charts-of-my-layout/>
- TradingView date-range synchronization:
  <https://www.tradingview.com/support/solutions/43000670346-how-to-synchronize-the-date-range-on-multichart/>
- Highcharts Stock `afterSetExtremes` reference:
  <https://api.highcharts.com/highstock/navigator.xAxis.events.setExtremes>
