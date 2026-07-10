# Chart Time Navigation Architecture

_Last updated: 2026-07-05_

This document explains the TradingView-style bottom time toolbar and the `Go to`
date/range dialog. Read this before changing chart range shortcut behavior,
date navigation, replay viewport interaction, or the bottom chart chrome.

## 1. Behavior To Match

The desktop reference is TradingView's lower chart time strip:

- range shortcuts: `1D`, `5D`, `1M`, `3M`, `6M`, `YTD`, `1Y`, `5Y`, `All`,
- a small `Go to` calendar button next to the shortcuts,
- a current clock with UTC offset on the right; clicking it opens a
  TradingView-style timezone selector,
- a `Go to` dialog with `Date` and `Custom range` tabs,
- Date mode jumps to the requested date/time and zooms into a readable
  TradingView-like candle window,
- Custom range mode applies an explicit start/end visible range.

Similar charting products use the same split: quick range buttons for common
windows and date inputs for precise navigation. Highcharts Stock documents this
as a range selector with preconfigured buttons plus min/max date inputs.

## 2. Research Sources

- User-provided TradingView screenshots in the 2026-07-04 task thread.
- TradingView Lightweight Charts `ITimeScaleApi` docs:
  `setVisibleRange`, `setVisibleLogicalRange`, `fitContent`,
  `getVisibleLogicalRange`, `timeToCoordinate`, and related time-scale methods.
- TradingView Advanced Charts `time_frames` option: bottom toolbar items are
  configured with both visible text and a target `resolution`. The user-supplied
  TradingView screenshots for this app's parity target show the exact tooltip
  policy listed below.
- TradingView Lightweight Charts time-scale guide for time-axis behavior.
- TradingView Lightweight Charts time-zone docs: Lightweight Charts processes
  time values in UTC and leaves timezone conversion to the app.
- Highcharts Stock `rangeSelector` docs for the common market-chart pattern:
  preconfigured buttons plus editable min/max date inputs.
- Highcharts `time.timezone` docs for the comparable charting-product pattern:
  named browser-supported timezones affect time display and tick placement.

## 3. Key Files

| Area | File | Responsibility |
|---|---|---|
| Toolbar UI | `src/components/chart/ChartTimeToolbar.tsx` | Renders shortcut strip, current clock, and `Go to` dialog |
| Top interval UI | `src/components/toolbar/TimeframeSelector.tsx` | Renders favorite intervals on the top bar and the scrollable interval popup |
| Interval selector model | `src/components/toolbar/timeframeSelectorModel.ts` | Pure catalog/favorite normalization logic for the top interval popup |
| Pure navigation logic | `src/components/chart/chartTimeNavigation.ts` | Calculates shortcut ranges, timezone conversion, date parsing, calendar grid, nearest candle, logical centering, and dialog placement |
| Chart placement | `src/components/chart/ChartArea.tsx` | Mounts the toolbar below all chart panes and above the bottom dock |
| Tests | `tests/chart/chartTimeNavigation.test.ts`, `tests/ui/timeframeSelectorModel.test.ts` | Locks range shortcuts, nearest-candle jump, parser, calendar behavior, and top interval favorite behavior |
| Test script | `package.json` | `npm run test:chart`, `npm run test:ui` |

## 4. Source Of Truth

The chart's current visible state lives in Lightweight Charts:

```ts
const timeScale = chart.timeScale();
```

Do not persist a second viewport model for time navigation. The toolbar should
only translate user intent into one of the public time-scale operations:

```ts
timeScale.setVisibleRange({ from, to });
timeScale.setVisibleLogicalRange({ from, to });
timeScale.fitContent();
```

This keeps drawing overlays, replay state, indicator panes, and price markers on
the same projection path documented in `ZOOM_VIEWPORT_SYNC_ARCHITECTURE.md`.

After any toolbar navigation, clear both the native Lightweight Charts crosshair
and the app crosshair state. Lightweight Charts keeps the last crosshair pixel
until it is cleared; if the chart is panned by `Go to`, that old pixel can show
a stale floating time label over the newly visible candles.

## 5. Shortcut Contract

`shortcutRange(shortcut, candles)`,
`shortcutLogicalRange(shortcut, candles, rightOffsetBars)`, and
`shortcutTargetTimeframe(shortcut)` are intentionally pure and tested.

- The anchor is the latest available candle, not wall-clock time.
- Every shortcut owns a target chart timeframe, matching TradingView's
  `time_frames` model where a toolbar item includes both range text and
  resolution.
- Target timeframe policy:

  | Shortcut | Target timeframe |
  |---|---|
  | `1D` | `1m` |
  | `5D` | `5m` |
  | `1M` | `30m` |
  | `3M` | `1H` |
  | `6M` | `2H` |
  | `YTD`, `1Y` | `1D` |
  | `5Y` | `1W` |
  | `All` | `1M` |

- Tooltip policy:

  | Shortcut | Tooltip |
  |---|---|
  | `1D` | `1 day in 1 minute intervals` |
  | `5D` | `5 days in 5 minutes intervals` |
  | `1M` | `1 month in 30 minutes intervals` |
  | `3M` | `3 months in 1 hour intervals` |
  | `6M` | `6 months in 2 hours intervals` |
  | `YTD` | `Year to day in 1 day intervals` |
  | `1Y` | `1 year in 1 day intervals` |
  | `5Y` | `5 years in 1 week intervals` |
  | `All` | `All data in 1 month intervals` |

- `1D` and `5D` subtract exact day durations.
- `1M`, `3M`, `6M`, `1Y`, and `5Y` use local calendar month/year arithmetic.
- `YTD` starts at local January 1 of the latest candle's year.
- `All` returns the sentinel `"all"` and the UI calls `fitContent()`.
- Non-`All` shortcuts resolve the requested start time to the first loaded
  candle at or after that time, then apply `{ from: startIndex, to:
  lastIndex + RIGHT_OFFSET_BARS }` via `setVisibleLogicalRange`.
- `ChartTimeToolbar` stores the active shortcut locally so `All`, `5Y`, `1Y`,
  etc. visibly highlight like TradingView after the user clicks them.
- If the shortcut's target timeframe differs from the current chart timeframe,
  `ChartTimeToolbar` sets a pending shortcut, calls `setTimeframeAtom`, waits
  for the target candles to load, and then applies the viewport on the next
  animation frame. Do not apply `5Y` or `All` against a still-loaded `15m`
  dataset; that is the root cause of the chart showing only a few days.
- `useMarketData()` must load enough history for these target intervals. In
  particular, `3M` on `1H` and `6M` on `2H` need more than the old fixed 1500
  bars; keep `historyBarsForTimeframe()` in sync if shortcut intervals change.

Using logical range for shortcuts avoids timestamp-clamping edge cases and keeps
the normal right-side whitespace stable. The official Lightweight Charts API
notes that `setVisibleRange()` is clamped to existing time data, while
`setVisibleLogicalRange()` is the correct primitive when the app can approximate
indexes directly.

## 6. Top Interval Selector Contract

The top toolbar must not render every supported `TIMEFRAMES` value directly.
TradingView keeps only favorited intervals on the bar and exposes the full list
through a scrollable interval popup.

Implementation rules:

- `TimeframeSelector` renders visible top buttons from
  `visibleToolbarTimeframes(favorites, activeTimeframe)`.
- Default favorites are `1m`, `5m`, and `15m`.
- Favorite state is cached under `tv:favoriteTimeframes`. With an authenticated
  backend session, `TimeframeSelector` loads and replaces it through
  `GET`/`PUT /api/v1/settings/chart/favorite-timeframes`; local storage remains
  the offline/cache fallback.
- If the active timeframe is not favorited, it is appended to the visible top
  buttons so the current chart resolution is always visible.
- The popup groups intervals into `TICKS`, `SECONDS`, `MINUTES`, `HOURS`, and
  `DAYS`, matching the TradingView menu structure.
- Unsupported catalog rows are visible but disabled. Do not wire them to
  `setTimeframeAtom` until the market-data providers and aggregation pipeline
  support that resolution.
- Star clicks toggle only top-toolbar visibility. Row clicks change the active
  timeframe and close the popup.
- `Add custom interval...` opens a modal with `Type` and `Interval` inputs. The
  Add button resolves through `customIntervalToTimeframe()` and is enabled only
  for supported provider-backed intervals; it must add the interval to
  favorites without toggling an existing favorite off.

Keep the catalog and favorite normalization in `timeframeSelectorModel.ts` so
future interval additions can be tested without rendering React.

## 7. Go To Date Contract

Date mode should behave like a TradingView `Go to` jump: land on the requested
bar and show a readable local candle window.

1. Parse the local `yyyy-mm-dd` and `hh:mm` draft.
2. Find the first loaded candle whose time is at or after the requested local
   timestamp with `firstCandleIndexAtOrAfter`.
3. Read the current logical range from `getVisibleLogicalRange`.
4. Build a bounded logical range with `goToDateLogicalRange`.
5. Apply it through `setVisibleLogicalRange`.
6. Show a temporary vertical marker and date chip at the resolved candle time.

Using logical range here matters. If the chart is zoomed very far out, Date mode
must zoom into `GO_TO_DATE_MAX_SPAN_BARS` around the target. If the user is
already zoomed closer than that, keep that tighter span instead of zooming out.

Do not use nearest-candle search for Date mode. TradingView-style `Go to` date
navigation should land on the first bar of the requested date/time window. For
example, `2026-07-01 00:00` should resolve to the first loaded candle on or
after local midnight on July 1, 2026.

The jump marker is only a short-lived navigation affordance. It should clear on
its timeout, on `Escape`, or as soon as the user interacts with the chart again
through pointer, wheel, or touch input. Attach that dismissal listener to the
chart wrapper in capture phase rather than only to the Lightweight Charts
element, because drawing canvases and app overlays can sit above the native
chart element while still being part of the chart interaction surface.

## 8. Custom Range Contract

Custom range mode is an explicit visible time window.

1. Parse both local date/time pairs.
2. Sort them so `from <= to`.
3. Apply the window through `setVisibleRange`.

Do not preserve the previous zoom in this mode; the user has supplied the target
window directly.

## 9. Calendar Contract

The calendar grid is generated in `calendarCells`:

- Monday-first headers: `Mo Tu We Th Fr Sa Su`,
- six fixed weeks, 42 cells,
- out-of-month cells stay visible but muted,
- the active tab/field owns the selected date.

The fixed 42-cell grid prevents footer/layout jumps when switching months.

## 10. Dialog Placement Contract

The `Go to` popup must be anchored to the toolbar calendar button, not to a
global right edge. Desktop layouts can include a right watchlist/details panel;
anchoring to `right: 0` opens the popup over that panel instead of over the
chart time strip.

`goToDialogPosition` is the pure placement helper:

- prefer opening above the toolbar button,
- align the left edge close to the button,
- clamp left/top to the viewport,
- fall back below the button only when there is not enough room above.

## 11. Replay And Data Replacement

Replay can replace the visible candle slice. Time navigation must tolerate that:

- disable shortcut and `Go to` actions when no candles are loaded,
- calculate defaults from the current candle array every time the dialog opens,
- clamp date jumps to the nearest loaded replay candle.

Do not jump to hidden future candles during replay. If a future date is typed,
`nearestCandleIndex` resolves to the last currently loaded candle.

## 12. Timezone Selector Contract

The bottom-right clock opens a TradingView-style timezone menu. The selector is
persisted in `localStorage` under `chartTimeZone`.

Supported behavior:

- `Exchange` means the browser/default chart timezone. This preserves the
  existing local-time behavior until symbol-level exchange timezones are added.
- `UTC` and named IANA zones such as `America/New_York` use browser `Intl`.
- The toolbar clock, UTC offset text, `Go to` dialog defaults, Date/Custom Range
  parsing, and temporary Go-to marker label all use the selected timezone.
- Candle timestamps remain unchanged. Lightweight Charts itself receives UTC
  timestamps; the app converts user-entered wall time to UTC seconds before
  calling `setVisibleRange` / `setVisibleLogicalRange`.

Do not shift or rewrite the candle dataset for timezone selection in this app.
That would also move drawings, replay boundaries, indicators, and trade levels.
Timezone selection is a presentation/input contract until a future dedicated
time-axis transformation layer is added.

## 13. Maintenance Rules

- Keep date/range math in `chartTimeNavigation.ts`; the React component should
  remain a thin adapter around chart APIs.
- Add TypeScript tests for every new shortcut, parser behavior, or popup
  placement rule.
- Do not add drawing-overlay invalidation here. Viewport repaint remains owned
  by `chartViewportEvents.ts` and the drawing renderer.
- If the app later adds symbol-level exchange timezones, update the
  `Exchange` resolver first, then the toolbar. Do not add per-component
  timezone conversion.

## 14. Verification

Run:

```bash
npm run test:chart
npm run typecheck
npm run lint
npm run build
```

Manual checks:

- click each shortcut and confirm the chart range changes,
- open `Go to`, pick a single date, and confirm the chart zooms into a readable
  candle window around the target,
- enter a date such as `2026-07-01` / `00:00` and confirm the chart centers the
  first loaded candle at or after that timestamp,
- confirm the temporary vertical marker and two-line date chip appear after the
  jump,
- click, drag, wheel, or touch the chart and confirm the temporary marker/chip
  disappears immediately,
- switch to `Custom range`, enter start/end values, and confirm range applies,
- verify current clock displays the local time and UTC offset,
- click the clock, choose `UTC` and `America/New_York`, then confirm the clock,
  offset, Go-to defaults, and marker chip follow the selected timezone,
- test with Replay loaded so date jumps clamp to replay-visible candles.
