# Chart Time Navigation Architecture

_Last updated: 2026-07-04_

This document explains the TradingView-style bottom time toolbar and the `Go to`
date/range dialog. Read this before changing chart range shortcut behavior,
date navigation, replay viewport interaction, or the bottom chart chrome.

## 1. Behavior To Match

The desktop reference is TradingView's lower chart time strip:

- range shortcuts: `1D`, `5D`, `1M`, `3M`, `6M`, `YTD`, `1Y`, `5Y`, `All`,
- a small `Go to` calendar button next to the shortcuts,
- a current local clock with UTC offset on the right,
- a `Go to` dialog with `Date` and `Custom range` tabs,
- Date mode jumps to the requested date/time without changing the user's zoom,
- Custom range mode applies an explicit start/end visible range.

Similar charting products use the same split: quick range buttons for common
windows and date inputs for precise navigation. Highcharts Stock documents this
as a range selector with preconfigured buttons plus min/max date inputs.

## 2. Research Sources

- User-provided TradingView screenshots in the 2026-07-04 task thread.
- TradingView Lightweight Charts `ITimeScaleApi` docs:
  `setVisibleRange`, `setVisibleLogicalRange`, `fitContent`,
  `getVisibleLogicalRange`, `timeToCoordinate`, and related time-scale methods.
- TradingView Lightweight Charts time-scale guide for time-axis behavior.
- Highcharts Stock `rangeSelector` docs for the common market-chart pattern:
  preconfigured buttons plus editable min/max date inputs.

## 3. Key Files

| Area | File | Responsibility |
|---|---|---|
| Toolbar UI | `src/components/chart/ChartTimeToolbar.tsx` | Renders shortcut strip, current clock, and `Go to` dialog |
| Pure navigation logic | `src/components/chart/chartTimeNavigation.ts` | Calculates shortcut ranges, date parsing, calendar grid, nearest candle, logical centering, and dialog placement |
| Chart placement | `src/components/chart/ChartArea.tsx` | Mounts the toolbar below all chart panes and above the bottom dock |
| Tests | `tests/chart/chartTimeNavigation.test.ts` | Locks range shortcuts, nearest-candle jump, parser, and calendar behavior |
| Test script | `package.json` | `npm run test:chart` |

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

`shortcutRange(shortcut, candles)` is intentionally pure and tested.

- The anchor is the latest available candle, not wall-clock time.
- `1D` and `5D` subtract exact day durations.
- `1M`, `3M`, `6M`, `1Y`, and `5Y` use local calendar month/year arithmetic.
- `YTD` starts at local January 1 of the latest candle's year.
- `All` returns the sentinel `"all"` and the UI calls `fitContent()`.

For explicit ranges, use `setVisibleRange`. Lightweight Charts clamps the range
to available data when the requested dates extend beyond loaded history.

## 6. Go To Date Contract

Date mode should behave like a chart pan, not a zoom reset.

1. Parse the local `yyyy-mm-dd` and `hh:mm` draft.
2. Find the nearest loaded candle with `nearestCandleIndex`.
3. Read the current logical range from `getVisibleLogicalRange`.
4. Center a logical range around that candle with the same span.
5. Apply it through `setVisibleLogicalRange`.

Using logical range here matters. If the user is zoomed into 60 bars and jumps
to another date, the chart should still show about 60 bars, centered on the
target candle.

## 7. Custom Range Contract

Custom range mode is an explicit visible time window.

1. Parse both local date/time pairs.
2. Sort them so `from <= to`.
3. Apply the window through `setVisibleRange`.

Do not preserve the previous zoom in this mode; the user has supplied the target
window directly.

## 8. Calendar Contract

The calendar grid is generated in `calendarCells`:

- Monday-first headers: `Mo Tu We Th Fr Sa Su`,
- six fixed weeks, 42 cells,
- out-of-month cells stay visible but muted,
- the active tab/field owns the selected date.

The fixed 42-cell grid prevents footer/layout jumps when switching months.

## 9. Dialog Placement Contract

The `Go to` popup must be anchored to the toolbar calendar button, not to a
global right edge. Desktop layouts can include a right watchlist/details panel;
anchoring to `right: 0` opens the popup over that panel instead of over the
chart time strip.

`goToDialogPosition` is the pure placement helper:

- prefer opening above the toolbar button,
- align the left edge close to the button,
- clamp left/top to the viewport,
- fall back below the button only when there is not enough room above.

## 10. Replay And Data Replacement

Replay can replace the visible candle slice. Time navigation must tolerate that:

- disable shortcut and `Go to` actions when no candles are loaded,
- calculate defaults from the current candle array every time the dialog opens,
- clamp date jumps to the nearest loaded replay candle.

Do not jump to hidden future candles during replay. If a future date is typed,
`nearestCandleIndex` resolves to the last currently loaded candle.

## 11. Maintenance Rules

- Keep date/range math in `chartTimeNavigation.ts`; the React component should
  remain a thin adapter around chart APIs.
- Add TypeScript tests for every new shortcut, parser behavior, or popup
  placement rule.
- Do not add drawing-overlay invalidation here. Viewport repaint remains owned
  by `chartViewportEvents.ts` and the drawing renderer.
- If the app later adds timezone selection, add it to the pure parser/formatter
  helpers first, then update the dialog.

## 12. Verification

Run:

```bash
npm run test:chart
npm run typecheck
npm run lint
npm run build
```

Manual checks:

- click each shortcut and confirm the chart range changes,
- open `Go to`, pick a single date, and confirm zoom span is preserved,
- switch to `Custom range`, enter start/end values, and confirm range applies,
- verify current clock displays the local time and UTC offset,
- test with Replay loaded so date jumps clamp to replay-visible candles.
