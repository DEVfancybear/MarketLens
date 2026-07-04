# Zoom And Viewport Sync Architecture

_Last updated: 2026-07-03_

This document is the maintenance guide for TradingView-style zoom/pan behavior
and overlay synchronization. Read this before changing `PriceChart`,
`DrawingLayer`, SMC overlays, custom indicator DOM labels, replay viewport
behavior, or any code that projects `(time, price)` into pixels.

## 1. Problem

Lightweight Charts renders candles, axes, and native series internally. Our
drawings, SMC objects, alert overlays, Pine object labels, and dashboards are
rendered outside that internal renderer as React DOM or separate canvas layers.

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
| Shared viewport events | `src/components/chart/chartViewportEvents.ts` | Single invalidation contract for chart zoom/pan/scale/resize input |
| Drawing overlay | `src/components/chart/DrawingLayer.tsx` | Projects drawings and starts drawing render loop |
| Drawing renderer | `src/components/chart/drawing/renderer/CanvasRenderer.ts` | Dirty-driven rAF loop, viewport follow-window, memo guard |
| Coordinate cache | `src/components/chart/drawing/renderer/CoordinateCache.ts` | Frame-local `(time,price) -> pixel` cache |
| Chart context | `src/components/chart/ChartContext.tsx` | Exposes `chart`, `candleSeries`, visible candles, and `version` |
| SMC overlay | `src/components/smc/SmcLayer.tsx` | Repaints from `ChartContext.version` |
| Indicator panes | `src/components/chart/IndicatorPane.tsx` | Mirrors main chart logical range |
| Replay viewport | `src/services/replayEngine.ts`, `src/components/chart/PriceChart.tsx` | Handles cursor/date jumps and data-window replacement |
| Guard | `scripts/check-drawing-viewport-repaint.mjs` | Static regression guard for the viewport repaint contract |

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

This helper listens to:

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

Desktop pan behavior:

- `handleScroll.pressedMouseMove` must stay enabled so users can drag the chart
  horizontally with the mouse.
- `kineticScroll.mouse` must stay disabled. TradingView-style desktop pan stops
  when the mouse is released; mouse inertia makes the chart coast too far and
  feels like the chart is "trôi tuột".
- `kineticScroll.touch` can stay enabled for mobile/tablet gestures, where
  kinetic scrolling is expected.
- Do not re-apply default `barSpacing` / `rightOffset` during theme/grid-only
  option updates. Apply those defaults on chart creation and timeframe changes,
  otherwise the viewport can shift while the user is interacting.

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

## 11. Indicator Panes

Separate indicator panes mirror the main chart's logical range:

```ts
mainChart.timeScale().subscribeVisibleLogicalRangeChange(handler)
target.setVisibleLogicalRange(range)
```

This is correct for pane time-axis sync because the pane chart is itself a
Lightweight Chart. It does not replace `chartViewportEvents.ts` for custom
canvas/DOM overlays on the main chart.

## 12. Replay Data-Window Replacement

Replay changes viewport in two ways:

1. Normal playback appends one visible candle.
2. Date jump/scrubber/restart/re-select replaces the visible data window.

For replacement, `PriceChart` realigns the viewport:

```ts
keepLatestBarInView(chart, dataLength)
```

This preserves current zoom width and moves the right edge to the newest candle
in the replacement slice. It prevents looking at empty future whitespace.

Do not call `fitContent()` from individual replay controls.

## 13. Maintenance Rules

- Store domain coordinates, never pixels.
- Route projection-changing events through `chartViewportEvents.ts`.
- Use `ChartContext.version` for DOM/canvas overlay recomputation.
- Use `markDirty(true, true)` for chart viewport changes.
- Use `markDirty()` for drawing data changes.
- Keep coordinate caches frame-local.
- Do not add per-tool zoom patches.
- Always unsubscribe LWC and DOM event handlers on teardown.

## 14. Manual Smoke Test

1. Open `http://localhost:3000`.
2. Draw a trendline across two candle highs/lows.
3. Draw a rectangle around several candles.
4. Draw a fib retracement.
5. Mouse-wheel zoom in/out quickly over the chart body.
6. Drag the chart horizontally.
7. Drag the price axis vertically to scale price.
8. Drag the time axis horizontally to scale time.
9. Double-click axes to reset scale.
10. Start replay and jump to a date in the past.

Expected:

- candles, grid, drawings, SMC overlays, and custom labels remain visually pinned;
- no drawing waits for a later repaint before snapping into place;
- replay jump does not show an empty chart;
- drawing selection handles remain aligned after zoom/pan.

## 15. Required Checks

Run these before committing viewport or drawing renderer changes:

```txt
npm run check:drawing-viewport
npm run check:fibonacci-tools
npm run check:position-hit
npm run typecheck
npm run lint
npm run build
```

For replay-related viewport changes, also run:

```txt
npm run check:replay-logic
```

## 16. Sources Used For The Current Contract

- Lightweight Charts 4.2 `HandleScaleOptions`: mouse wheel, pinch, axis drag
  scaling, and axis double-click reset.
- Lightweight Charts 4.2 `ITimeScaleApi`: visible logical range, time-scale
  size subscriptions, coordinate conversion, and cleanup methods.
- Lightweight Charts 4.2 `TimeScaleOptions`: right offset, bar spacing,
  min bar spacing, edge behavior, right-bar behavior, and new-bar shifting.
