# CURRENT PROGRESS

_Last updated: 2026-07-05 (Replay past-jump blank viewport)_

## Completed this session (2026-07-05)

### Replay past-jump blank viewport
- Researched the official TradingView Lightweight Charts time-scale API:
  visible time ranges are clamped to existing data, while logical ranges are
  the correct primitive when the app owns bar indexes during replay.
- Added `src/components/chart/replayViewport.ts` as the common replay viewport
  guard for blank future/past whitespace.
- `PriceChart` now realigns replay viewports when the current logical range no
  longer intersects the replay-visible slice, not only when the update looks
  like a structural data-window replacement.
- The realignment uses deterministic `setVisibleLogicalRange()` instead of
  animated `scrollToRealTime()`, preserving the user's zoom width and keeping
  the latest replay candle in view.
- Added `tests/chart/replayViewport.test.ts` and updated
  `scripts/check-replay-logic.mjs` plus `docs/REPLAY_ARCHITECTURE.md`.

### Default chart volume visibility
- Researched TradingView/Lightweight Charts behavior: the official
  Lightweight Charts example describes volume as a separate histogram study
  added explicitly, not as a built-in part of candlesticks.
- Removed the default `PriceChart` volume histogram so a clean chart no longer
  shows volume bars by default.
- Tightened main price-scale bottom margin because the chart no longer reserves
  a lower volume overlay band.
- Crosshair candle payloads still include volume by reading the current candle
  data, so indicators and data consumers keep OHLCV context.
- Updated `docs/CHART_VISUAL_PROFILE.md` and chart visual profile tests to lock
  the no-default-volume baseline.

### Drawing favorites floating toolbar
- Rechecked the user screenshot and TradingView chart behavior: starring a
  drawing tool should not inject that tool into the left rail as another main
  toolbar button.
- Replaced the old left-toolbar favorite quick-access bar with a separate
  floating Favorites toolbar on the chart.
- The popup reads the same persisted `tv:favTools` set as the flyout star
  controls, supports drag-to-move, activates a favorite with one click, and
  removes a favorite with right-click.
- Marked the floating toolbar as `data-chart-ui` / `data-drawing-toolbar` so
  chart drawing/drag listeners ignore its clicks.
- Fixed the first-favorite crash: the popup's `initialPosition` callback is now
  stable, preventing `useDraggableDialog` from remeasuring and setting state on
  every render after `tv:favTools` becomes non-empty.

### Trade ticket formatted price metrics
- Fixed Trade ticket numeric parsing so prefilled values like `62,751.61` are
  accepted by Limit/Stop Entry, Stop loss, Take profit, Risk, and Lot math.
- Limit/Stop tabs no longer render `Size: NaN` when populated from a
  Long/Short Position drawing.
- Reward and R:R now calculate from the same parsed Entry/SL/TP values used for
  Size, matching the Long/Short risk/reward workflow.
- Hardened simulator risk math so invalid numeric drafts return finite fallback
  metrics instead of propagating `NaN` into the UI.
- Added `tests/trade/` and `npm run test:trade` for formatted-price ticket
  parsing and finite risk metric coverage.

### Dialog close icon reliability
- Fixed the shared draggable-dialog no-drag detector so it recognizes nested
  SVG/icon targets inside buttons, not only HTML elements.
- This prevents close/settings/icon buttons from being interpreted as drag
  starts and swallowing the final click.
- Added `npm run test:ui` coverage for SVG icon targets inside dialog buttons.

### Long/Short price label and scale-panel parity
- Rechecked the user-provided TradingView Long/Short screenshots: absolute
  TP/Entry/SL prices are shown on the right price scale, while the in-box
  Target/Stop chips show metrics and the right price-scale strip keeps the
  TP/SL color context.
- Added canvas-rendered right-edge price badges for target, entry, and stop
  prices so the drawing exposes the actual SL/TP levels on chart.
- Added right price-scale strip tinting for the profit and risk bands using the
  shared chart price-scale width, so the colored TP/SL panel follows the same
  renderer path as the on-chart long/short zones.
- Restored Target/Stop chips to TradingView-style metrics: distance, percent,
  ticks, amount, and hit status.
- Long/Short labels now fall back to the shared full stats set and the
  TradingView-style `1000` account / `25%` risk defaults when loading older
  drawings that do not have those fields persisted.
- Expanded the drawing canvas memo signature for Long/Short account, risk,
  color, and stats fields so settings changes repaint immediately.

### Chart timezone selector
- Researched TradingView timezone behavior from the user screenshot plus
  official Lightweight Charts and Highcharts timezone docs.
- Added a bottom-right clock timezone selector with `UTC`, `Exchange`, and
  common city/IANA zones. The option labels show the current UTC offset.
- Persisted the selected timezone in `localStorage` as `chartTimeZone`.
- Routed timezone through the common chart time-navigation helpers so the clock,
  `Go to` dialog defaults, Date/Custom Range parsing, and temporary marker chip
  all use the selected timezone.
- Added `npm run test:chart` coverage for UTC/New York parsing, formatting,
  offset labels, and marker chips.

### Long/Short lot sizing prefill
- Added `src/services/positionLotSizing.ts` so risk-to-lot math is shared by
  Long/Short drawing prefill and the Trade ticket instead of being duplicated
  in UI code.
- Long/Short Position prefill now computes `quantity` from the drawing's
  account size, risk value/unit, `abs(SL - entry)` tick distance, symbol tick
  value, and broker lot step/min/max.
- `OrderTicket` now fills the `Lot` input from position-drawing `quantity` and
  uses the same shared helper for MT5 risk/reward metrics.
- Added `tests/position/positionLotSizing.test.ts` plus prefill quantity
  coverage in `positionTradePrefill.test.ts`.

### Go to date parity fix
- Tuned the `Go to` popup width, input grid, weekday strip, selected/today
  styling, and footer spacing closer to the TradingView reference.
- Replaced nearest-candle Date mode with first-candle-at-or-after lookup so
  `2026-07-01 00:00` lands on the first loaded candle from July 1, 2026 instead
  of an arbitrary nearest candle.
- Added bounded Date-mode zoom so a Go-to jump from a wide chart opens a
  readable TradingView-like candle window instead of keeping the chart zoomed
  too far out.
- Added a temporary vertical marker and date chip after Date mode jumps.
- Matched TradingView marker dismissal: the temporary `Go to` chip now clears
  immediately when the user clicks, drags, wheels, touches the chart, or presses
  `Escape`, instead of waiting only for the timeout.
- Expanded `npm run test:chart` coverage for date lookup, marker label
  formatting, bounded zoom, and updated dialog placement.

### Chart visual profile parity
- Researched the user-provided TradingView comparison screenshots plus
  Lightweight Charts chart, candlestick, price scale, and histogram option
  docs.
- Added `chartVisualProfile.ts` so the TradingView-like chart baseline lives in
  one shared profile instead of being duplicated inside `PriceChart` and
  `IndicatorPane`.
- Tuned the main chart toward the TradingView reference: neutral dark
  background, subtler grid, stable right axis width, smaller volume overlay,
  dotted current-price line, compact one-line price marker, and a lighter
  indicator legend.
- Updated separate indicator panes to use the same layout/grid/price-scale and
  crosshair profile as the main chart, with theme re-application.
- Added `docs/CHART_VISUAL_PROFILE.md` and
  `tests/chart/chartVisualProfile.test.ts`.

## Completed previous session (2026-07-04)

### Shared draggable dialogs
- Added `useDraggableDialog` as the common drag/viewport-clamp helper for
  TradingView-style movable modal dialogs.
- Applied header/title/tab-strip dragging to indicator settings, drawing object
  settings, Long/Short Position settings, indicator library, delete-script
  confirm, chart `Go to`, save drawing template, alert edit, and live-order
  confirm dialogs.
- The helper ignores pointer starts inside buttons, inputs, textareas, selects,
  links, role-button controls, and `[data-dialog-no-drag]` zones, so form
  controls remain usable while the dialog shell is movable.
- Added `docs/DRAGGABLE_DIALOG_ARCHITECTURE.md`, `tests/ui/`, and
  `npm run test:ui` coverage for viewport clamping behavior.

### Chart time navigation toolbar
- Researched TradingView's lower time strip reference from the user screenshots
  plus Lightweight Charts time-scale APIs and Highcharts Stock range selector
  behavior.
- Added `ChartTimeToolbar` below the chart panes with TradingView-style range
  shortcuts: `1D`, `5D`, `1M`, `3M`, `6M`, `YTD`, `1Y`, `5Y`, and `All`.
- Added a right-side local clock with UTC offset.
- Added a `Go to` dialog with `Date` and `Custom range` tabs. Date mode centers
  the nearest loaded candle without changing the current zoom span; Custom range
  applies an explicit start/end time window.
- Added `chartTimeNavigation.ts` as the common pure helper layer for shortcut
  math, local date/time parsing, nearest-candle lookup, logical centering, UTC
  offset formatting, and fixed Monday-first calendar cells.
- Added `tests/chart/chartTimeNavigation.test.ts` and `npm run test:chart`.
- Added `docs/CHART_TIME_NAVIGATION_ARCHITECTURE.md` for future maintenance.

### Chart drag inertia fix
- Referenced official Lightweight Charts interaction docs: desktop pan is
  controlled by `handleScroll.pressedMouseMove`, while kinetic scrolling is a
  separate option.
- Disabled `kineticScroll.mouse` for the main chart so dragging with a mouse no
  longer coasts after release. `kineticScroll.touch` remains enabled for
  touch/mobile behavior.
- Split default viewport application so `barSpacing` and `rightOffset` are not
  re-applied during theme/grid updates; they are only refreshed when timeframe
  changes.

### Line tools parity
- Updated the Lines flyout to match the TradingView reference screenshot:
  Trendline, Ray, Info line, Extended line, Trend angle, Horizontal line,
  Horizontal ray, Vertical line, and Crossline. `Channel` remains registered for
  saved drawings but is no longer exposed in that flyout.
- Added `lineGeometry.ts` as common infrastructure for line plugins: projection,
  endpoint anchors, finite segment hits, Ray/Extended Line extension hits,
  Horizontal Ray right-side-only hits, large bounds for infinite tools, and
  axis-constrained Horizontal/Vertical movement.
- Refactored Trendline, Ray, Extended line, Trend angle, Info line, Horizontal
  line, Horizontal ray, Vertical line, and Crossline to use the shared contract.
- Added `tests/drawing/lineGeometry.test.ts`; `npm run test:drawing` now covers
  both line and shape shared geometry.

### Shape tool behavior parity
- Added `shapeGeometry.ts` as common geometry infrastructure for shape plugins:
  projection, anchor hits, segment/body hits, polygon interiors, ellipse body
  hits, curve sampling, and sampled bounds.
- Updated Path, Polyline, Triangle, Ellipse, Curve, Arc, and Double Curve to use
  shared geometry behavior instead of duplicated per-plugin math.
- Fixed practical TradingView-parity gaps: Ellipse no longer selects from the
  rectangular bounding box, Triangle includes its closed edge/interior, Curve can
  be grabbed from the curve body, and Arc/Double Curve use sampled bounds for
  viewport culling.
- Added `tests/drawing/shapeGeometry.test.ts` and `npm run test:drawing` to
  lock the common shape hit-test contract in a cloneable TypeScript test suite.

### Combined geometry flyout parity
- Updated `DrawingToolbar` so Brush, Highlighter, Arrow tools, and Shapes live
  in one TradingView-style geometry flyout with `BRUSHES`, `ARROWS`, and
  `SHAPES` sections.
- Removed the separate Brushes group presentation. The underlying tools and
  plugins remain first-class drawing engine adapters.
- Added viewport-aware max height/scrolling for long drawing flyouts so the
  combined menu does not overflow the screen.

### Brush and arrow drawing tools
- Researched TradingView's Highlighter and Arrow Marker behavior plus similar
  chart tool menus: Highlighter follows the Brush drag workflow with
  transparency, while Arrow Marker is a two-point pointer whose second point
  determines direction.
- Added `highlighter`, `arrowMarker`, `arrow`, `arrowMarkUp`,
  `arrowMarkDown`, `arrowMarkLeft`, and `arrowMarkRight` as first-class
  `DrawingTool` values.
- Registered common drawing plugins for the new tools so they render, hit-test,
  select, move, and persist through the existing adapter-based drawing engine.
- Updated the Brushes flyout to include a TradingView-style `BRUSHES` section
  and `ARROWS` section.

### Fib settings viewport fix
- Fixed `ObjectSettingsDialog` shell sizing so Fib retracement settings no
  longer overflow the browser viewport: overlay uses balanced viewport padding,
  dialog width is clamped to available viewport width, and the content body can
  shrink/scroll while the footer remains visible.

### Responsive architecture plan
- Added `docs/RESPONSIVE_ARCHITECTURE.md` after researching TradingView mobile,
  TradingView tablet/iPad references, Binance mobile chart settings, and the
  current desktop-first layout.
- The plan defines phone/tablet/desktop breakpoints, a shared viewport policy,
  responsive panel/dialog/tool surfaces, chart gesture requirements, and a
  Playwright viewport test matrix for implementation.

### Settings popup color sync
- Synced `ObjectSettingsDialog`, `PositionSettingsDialog`, and
  `IndicatorSettingsDialog` to the Text settings reference palette: `#1f1f1f`
  surface, `#3a3a3a` shell border, `#50535a` control borders, white active tab
  underline, white `Ok`, and outlined `Cancel`.
- Rectangle, line, shape, fib, position, indicator, and text settings now use
  one neutral TradingView-style color system instead of mixing terminal-blue and
  Text-popup themes.

### Text tool settings parity
- Standalone Text drawing settings now use the TradingView-style `Text /
  Visibility` tab order with the same header/footer shell as other drawing
  settings popups.
- The Text tab owns color, font size, bold, italic, text content, background,
  border, and text-wrap controls.
- Selected Text drawings now render a blue bounding box around the measured text
  content so reselecting text has the same visible affordance as TradingView.

### Bottom panel collapse control
- Added a divider-centered collapse button for the bottom Replay/Trade/Pine
  panel and a small chart-overlay restore button when the panel is hidden.
- Double-clicking the bottom divider also collapses the panel.
- The collapsed state reuses existing `bottomOpenAtom` / `setBottomOpenAtom`,
  so tab switching can still reopen the panel through `setBottomTabAtom`.

### Position drawing to Trade ticket prefill
- New Long/Short Position drawings now switch the bottom panel to `Trade` and
  fill the order ticket from the drawing: entry, stop loss, take profit, risk
  percent, planned side, and inferred limit/stop type.
- Added `positionTradePrefill.ts` so drawing-to-order mapping is a shared helper
  instead of UI-specific logic.
- Added versioned `orderPrefillAtom` / `setOrderPrefillAtom`; this makes prefill
  persistent across panel mounting, unlike the previous transient event-bus path.
- Context-menu order prefill now uses the same atom path.
- Multiple Long/Short Positions are scoped by source `drawingId`: selecting a
  position refreshes the ticket, and dragging/editing entry, TP, SL, or risk
  refreshes only that active/source position.
- Added typed coverage in `tests/position/positionTradePrefill.test.ts`.

### Long/Short position TradingView parity pass (2026-07-04)
- Researched TradingView position projection behavior and similar walkthroughs: Long/Short is a
  visual planning tool with one-click entry placement, default target/stop, double-click settings,
  risk/reward, quantity, projected amount, and opposite direction rules for Short.
- Added `positionGeometry.ts` so the position tool has a shared interaction contract for six virtual
  handles, left/right edge resize, target/entry/stop role updates, tick snapping, body drag, and
  long/short level clamping.
- Fixed the previous UI/function mismatch where six handles were drawn but only three were
  interactive.
- Updated labels toward TradingView's risk/reward style: target/stop show distance, percent, ticks,
  and projected amount; entry shows Open P&L, Qty, and R/R.
- New Long/Short drawings default to symmetric 1:1 risk/reward and full stats.
- Added `docs/POSITION_TOOL_ARCHITECTURE.md` and expanded `npm run test:position` with movement
  coverage.

### Long/Short position tick-price parity
- Replaced the position tool's price-magnitude tick heuristic with shared
  `positionMetrics.ts` helpers backed by symbol `tickSize` metadata.
- `PositionSettingsDialog` now keeps `Ticks` and `Price` synchronized like TradingView: editing
  ticks recalculates price, editing price snaps to the symbol tick and recalculates ticks, and
  editing entry preserves the current tick distances.
- Fixed the follow-up editing bug where these fields committed each keystroke. Entry/Ticks/Price
  now commit on blur or Enter, allowing the user to replace a number without intermediate drafts
  being mirrored around entry or snapped as final prices.
- `PositionTool` now uses the same helper for canvas price labels and tick-count stats, so labels
  and settings cannot drift.
- BTCUSDT is treated as the app's displayed TradingView-style perpetual contract with `tickSize:
  0.1`, matching the reference where `61915.1 -> 62061.8` equals `1467` ticks.
- Added typed tests under `tests/position/` plus `npm run test:position`, including parser coverage
  for incomplete numeric drafts.
- Docs: updated `docs/DRAWING_ENGINE_ARCHITECTURE.md` and added `tests/position/README.md`.

### Drawing viewport repaint fix
- User repro: after zooming the chart out, drawings stayed visually offset and snapped into the
  correct candle positions roughly a second later.
- Root cause: drawing data did not change during zoom, so the renderer relied on viewport invalidation.
  A single forced repaint could still sample an intermediate Lightweight Charts mapping while wheel
  zoom/autoscale was settling.
- Fix: `CanvasRenderer` now keeps a short viewport follow-window after zoom/pan/resize invalidation,
  forcing a few rAF repaints that bypass the memo guard. `chartViewportEvents.ts` centralizes the
  invalidation sources for TradingView-like interactions: visible logical range, time-scale size,
  wheel zoom, pinch/touch, active pointer drags on chart axes/pane, and double-click scale reset.
  `PriceChart` uses the same helper for `ChartContext.version`, so DOM/canvas overlays share one
  viewport contract.
- Docs: added `docs/ZOOM_VIEWPORT_SYNC_ARCHITECTURE.md` for future maintenance of zoom/pan,
  projection invalidation, drawing repaint, indicator pane sync, and replay data-window viewport
  replacement.
- Guard: added `npm run check:drawing-viewport`.

### Replay jump viewport fix
- User repro: jumping Replay Mode to a day in the past could leave the chart visually blank.
- Root cause: `useVisibleCandles()` correctly replaced the plotted slice with candles up to the
  replay cursor, but `PriceChart` kept the old logical viewport looking at now-empty future
  whitespace.
- Fix: `PriceChart` now detects non-incremental candle-window replacements, preserves the current
  zoom span, and moves the right edge to the replacement slice's latest candle. Normal realtime
  ticks and one-candle replay playback still use the incremental update path.
- Fix: replay date selection now clamps cleanly before/after loaded history. `indexAtOrBefore()`
  returns `-1` before the first bar for no-look-ahead MTF logic, while `indexNearestByTime()` maps
  out-of-range UI jumps to the closest real candle.
- Guard: extended `npm run check:replay-logic`.
- Docs: added `docs/REPLAY_ARCHITECTURE.md` covering replay state, transitions, visibility,
  viewport behavior, MTF no-look-ahead rules, performance constraints, and manual smoke tests.

### Common Pine object runtime
- User repro: saving and adding `ADR 50 SR Pro` reported success, but nothing rendered because the
  script uses object APIs (`request.security`, `line.new`, `box.new`, labels, `table.new`) and has
  no `plot()` calls.
- UI parity: indicators now use a shared TradingView-style legend component for chart overlays and
  separate panes, with show/hide, settings placeholder, Pine source opener, and direct remove
  controls.
- Fix: `pineScript.ts` now runs this through a shared Pine object runtime instead of an
  ADR-specific branch. The runtime evaluates supported `request.security`, `time("D")`, inputs,
  one-line helper functions, labels, boxes, lines, and table cells into chart overlay metadata.
- Research update: the runtime now follows more of Pine's common execution surface:
  higher-timeframe aggregation for `request.security`/`timeframe.change`, `barstate.*`
  identifiers, multi-argument one-line helper functions, compound assignment syntax, and
  object drawing coordinates from `x1/y1/x2/y2` plus `xloc`/`extend`.
- UI fix: object labels now project from shared label metadata with a fallback background and
  `label.style_label_left` labels on the active segment move to the right edge of the emitted
  object line, preventing the line from cutting through label text.
- Fix: `PriceChart` renders custom indicator overlay labels/dashboard as DOM overlays projected
  from chart price/time coordinates, so the ADR script appears on the price chart.
- Follow-up UI fix: ADR labels whose endpoint is off-screen to the left are clipped instead of
  being clamped to the left edge, preventing historical labels from stacking over the chart.

### TradingView-style indicator browser
- Replaced the small `IndicatorMenu` dropdown with a modal browser matching TradingView's
  `Indicators, metrics, and strategies` layout: search bar, Favorites/My scripts sidebar,
  built-in indicator section, author/boost columns, favorite stars, active checkmarks, and
  settings routing.
- Refined `My scripts` to match TradingView's script list: `SCRIPT NAME` header, favorite star,
  source-code `{}` action, trash icon, and confirm-before-delete modal.
- Pine script storage remains in the bottom Pine Editor; the modal lists saved scripts and can add
  them to the chart without moving the editor back into a popup.

### Pine Better RSI v3 rendering fix
- User repro: `Better RSI` compiled to a nearly flat single 50 line instead of TradingView's RSI
  pane with hlines, purple background fill, white RSI, red overbought/oversold segments, and
  cycler colors.
- Fix: `pineScript.ts` now handles the script's Pine v3 subset: bare `integer`/`source` enums,
  legacy `rsi(...)` and `color(base, transp)`, `hline`, `fill`, `linebr`, line widths/styles,
  comparison operators inside plot expressions, and indentation-based `if ... else` expressions.
- Fix: custom indicator renderers now support `baselineFill`, hline-style flat line series, and
  per-bar colors on line series so the cycler can change between lime/red/white.
- Performance fix: `IndicatorPane` now reuses existing Lightweight Charts series between candle
  updates, and Pine hlines/fills emit only first/last points instead of full-history arrays. This
  prevents Better RSI from freezing the browser during live candle updates.
- UI parity fix: Pine hline/fill series add a small right-side flat extension so Better RSI levels
  and the purple fill cover the chart whitespace after the last candle, matching TradingView.
- Compiler performance fix: self-referential assignments such as `cycler[1]` now evaluate
  point-by-point with scalar context. Benchmark for `rsi.txt` on 1000 candles dropped from roughly
  1139ms to roughly 28ms.
- Verification: direct compile of `C:/Users/duong/Downloads/rsi.txt` returned `errors: []` and
  produced fill, hline, RSI, oversold/overbought segment, and cycler series.

### Pine VSA/Wyckoff volume rendering fix
- User repro: the same VSA Wyckoff Volume script renders as colored volume columns in TradingView,
  but rendered as a single blue line in this app.
- Root cause: custom Pine plots only produced line series with a static fallback color. The compiler
  did not yet understand `plot.style_columns`, ternary color palettes, comparisons/logical ops,
  history references such as `volumeMA[1]`, typed declarations, or Pine enum identifiers such as
  `input.integer`.
- Fix: `IndicatorResult` supports histogram series and per-bar colors; `IndicatorPane` and
  `PriceChart` render histogram data with each point's color.
- Fix: `pineScript.ts` now supports the VSA subset, including the Wilder-style recursive volume MA
  pattern used by `volumeMA := nz(volumeMA[1]) + (volume - nz(volumeMA[1])) / lengthVolumeMA`.
- Follow-up fix: function-call parsing now preserves named arguments, so Pine v4 inputs like
  `input(defval=20, type=input.integer)` reliably feed the VSA ratio values. Pine color constants
  for the VSA palette now use TradingView-style purple/red/orange/green/blue/silver values.
- Follow-up fix: separate-pane histogram rendering now preserves `p.color` before applying the
  bullish/bearish fallback; this fixes VSA bars displaying as one teal color in the lower pane.
- Guard: extended `npm run check:pine-indicator`.

### Pine Editor + source-code indicators
- Added a TradingView-style Pine Editor as a bottom-panel tab, with an embedded "My scripts"
  sidebar for search, favorite, load/edit, add-to-chart, and delete. There is no separate popup
  for script storage.
- Added `CUSTOM` indicators backed by saved Pine-like source code. Scripts persist separately in
  `pineScripts`, while active chart indicator instances remain in `indicators`.
- Added a safe mini Pine compiler in `src/services/pineScript.ts`; it parses a whitelisted subset
  (`indicator()/study()`, assignments, arithmetic, common `ta.*` functions, `math.*`, `nz`,
  `input.*`, and `plot()` metadata) and never executes user source as JavaScript.
- Wired custom indicators into the existing chart renderer: `overlay=true` scripts render on the
  main price chart, while separate-pane scripts render through `IndicatorPane`.
- CUSTOM indicator settings gears now open the shared TradingView-style settings dialog generated
  from Pine `input.*()` declarations. The `{}` control opens the saved script in the bottom Pine
  Editor.
- The shared Style tab now renders from common style schemas. Pine source indicators extract rows
  from `plot`, `hline`, `fill`, `line.new`, `box.new`, and `label.new`; built-ins consume
  `styleValues` through shared primary/secondary keys.
- The Style tab also includes TradingView-style common output/status controls: precision, labels on
  price scale, values in status line, and inputs in status line.
- Docs: added `docs/SETTTING_ARCHITECTURE.md` as the maintenance guide for common indicator
  settings, `IndicatorConfig.inputValues`, `IndicatorConfig.styleValues`, Pine schema extraction,
  and runtime overrides.
- Docs: added `docs/INDICATOR_ARCHITECTURE.md`.
- Guard: added `npm run check:pine-indicator`.
- Verification: `npm run check:pine-indicator`, `npm run typecheck`, `npm run lint`, and
  `npm run build` pass. Manual browser end-to-end verification remains a follow-up.

### Path/freeform drawing TradingView parity
- Reference checked: TradingView Help Center `Polyline drawing tool` documents multi-point
  straight-line drawing and says double-click, right-click, or `Esc` can finish the drawing while
  keeping it open.
- Fix: `DrawingInteractionManager` now commits an in-progress freeform drawing on `Esc` when the
  committed points meet the tool's `minPoints`. This covers `path`, `polyline`, and `curve`; an
  incomplete freeform draw still cancels.
- Fix: `PathTool`, `PolylineTool`, and `CurveTool` now return explicit `anchorIndex` values for
  every vertex hit and expose matching `getAnchors()` output. `HitTestEngine` preserves adapter
  supplied `anchorIndex`, so dragging the last or middle vertex moves the actual vertex rather than
  resolving through the reused `p1`/`p2` target labels.
- Guard: added `npm run check:path-tool`.

### Fibonacci tools TradingView parity pass
- User repro: current fib tools did not feel/function like TradingView. Retracement only rendered
  the basic `0..1` levels, extension was a 2-point projection, and legacy `fib` still used the old
  minimal renderer.
- Reference checked: TradingView Help Center `Fibonacci retracement drawing tool`. Important
  contract: retracement is anchored by two extremes; levels between `0` and `1` are internal,
  levels greater than `1` are external retracements, and the style surface includes trend line,
  level lines, extend left/right, background, prices, levels, labels, text, and font size.
- Fix: `DEFAULT_FIB_LEVELS` now includes 24 TradingView-style level rows; `FibRetracementTool`
  renders a dashed source trend line, horizontal levels, subtle background bands, and level+price
  labels with concrete canvas fonts.
- Fix: `ObjectSettingsDialog` now has a fib-specific TradingView-style settings surface with
  Style / Coordinates / Visibility tabs, 24 per-level rows, background/reverse/prices/levels/
  labels/text/font/log-scale controls, and `#1/#2 (price, bar)` coordinate rows.
- Fix: Fib labels now measure their text width and clamp inside the chart viewport. Labels are no
  longer placed at `right + padding`, which caused left-to-right fib drawings to overlap the
  right edge/price-scale area. Default label placement is `Left / Middle`.
- Fix: Fib renderers now reserve and clip away from the right price-scale/current-price label strip.
  Level lines, background bands, and extension rays stop before the price axis instead of drawing
  underneath it.
- Fix: Fib labels now use the TradingView-style `level (price)` format and default left labels sit
  outside the fib body instead of starting inside the colored bands. The source trend line defaults
  to gray dashed when no custom trend-line color is set.
- Fix: `FibExtensionTool` is now trend-based with three-click creation. A-B defines the impulse,
  C defines the projection origin, and levels are computed as `C + ratio * (B - A)`. Two-point
  saved extension drawings still render by treating B as C.
- Fix: double-clicking any drawing opens the settings dialog, so fib settings can be opened from
  the chart, not only from the floating toolbar.
- Fix: `FibExtensionTool.getAnchors()` maps `p3` explicitly so the third point is draggable as a
  real anchor instead of being resolved as body.
- Fix: legacy `fib` mirrors the modern retracement preset/renderer enough for saved drawings and
  old toolbar paths.
- Docs: added `docs/FIBONACCI_TOOLS_MAINTENANCE.md`.
- Guard: added `npm run check:fibonacci-tools`.

## Completed this session (2026-07-02)

### SMC overlay live visibility and readability
- User repro: all SMC toggles were enabled, but the live chart showed no SMC overlay; exported
  screenshots did show the overlay, and when visible it was far too dense.
- Root cause: the SMC canvas had no explicit stacking order, while screenshot export composites
  overlay canvases separately. This can make a hidden live overlay appear in the exported image.
- Fix: `SmcLayer.tsx` now renders above the chart canvas with `z-[2]`, below drawings/replay.
- Rendering now caps each noisy feature family: structures, swings, FVGs, order blocks, liquidity,
  displacement, sessions, and kill zones. Active/fresh objects and nearby untaken liquidity are
  prioritized; swept liquidity no longer spams right-axis price tags.
- Cleaned SMC menu checkmarks and canvas labels to avoid mojibake/unsupported glyphs.
- Docs: added `docs/SMC_OVERLAY_MAINTENANCE.md`.
- Guard: added `npm run check:smc-overlay`.

### Brush tool continuous freehand parity
- User repro: `brush` behaved like a straight two-click trendline instead of TradingView's
  freehand brush where the user drags to draw circles, curves, and arbitrary strokes.
- Root cause: `BrushTool.ts` could render multi-point paths, but it did not opt into a continuous
  creation mode, so `DrawingInteractionManager.ts` treated it as a normal two-point tool.
- Fix: added a generic `continuous` adapter flag, wired drawing mode to collect points on
  `pointermove` and commit on `pointerup`, and enabled it for `brush`.
- Brush selection now renders endpoint handles, while body hit-test/drag remains segment-based.
- Guard: added `npm run check:brush-freehand`.

### Vertical line TradingView date label parity
- User repro: selected `VerticalTool` showed a white circular handle in the middle of the chart,
  while TradingView shows a vertical blue line with a blue date/time chip on the bottom time axis.
- Fix: `VerticalTool.ts` now renders the selected state with a bottom-pinned date chip and no
  center handle. The line body hit-test/drag path remains unchanged.
- Date label format is `Thu 02 Jul 26 19:30` using UTC chart time, and the chip clamps inside the
  chart viewport so edge placements do not clip the label.
- Guard: added `npm run check:vertical-line`.

### Info Line measurement panel parity
- User repro: `InfoLineTool` showed a single blue chip with only price/% while TradingView shows a
  dark measurement panel.
- Fix: `InfoLineTool.ts` now renders a three-row panel with price change / percent / tick span,
  bars + elapsed time + pixel distance, and angle. The panel is positioned near the measured segment
  and clamped inside the chart viewport.
- Follow-up fix: panel width is now measured from its row text before render and clamped to the
  viewport; if the viewport cannot fit the full row, the text is ellipsized instead of overflowing
  beyond the grey panel when dragging the info line right-to-left.
- Follow-up fix: panel placement now reserves a right price-scale/current-price label strip and
  clips drawing to the plot-pane side of that boundary. Near the right edge, the panel opens to the
  left of the measured segment instead of covering the price axis.
- Bar count comes from the active `timeframeAtom` and `TF_SECONDS`; distance/angle come from canvas
  geometry so the values update correctly while the chart is zoomed/panned.
- Guard: added `npm run check:infoline-panel`.

### Trendline text parity fixed
- User repro: plain trendline displayed a blue measurement chip (`price change / % / angle`) while
  TradingView's normal Trend Line shows `+ Add text` on the selected line instead.
- Fix: `TrendLineTool.ts` no longer renders the measurement chip; `infoLine` and `trendAngle`
  remain the dedicated measurement tools.
- Added `renderLineText()` in `plugins/shared.ts` and a trendline text hitbox/editor path in
  `DrawingLayer.tsx`, so selected empty trendlines show `+ Add text`, saved text is stored on the
  trendline drawing, and the label moves/rotates with the line.
- Guard: added `npm run check:trendline-text`.

### Replay floating toolbar click regression fixed
- User repro: the floating Bar Replay toolbar was visible but clicking controls looked like it did
  nothing.
- Root cause: the toolbar/dropdown was not marked as chart UI, so document-capture drawing/replay
  handlers could treat toolbar pointerdowns as chart clicks. The toolbar container also used
  `overflow-hidden`, clipping the compact `Select bar` timing menu below the toolbar.
- Fix: `ReplayFloatingToolbar` and the shared `Dropdown` now carry `data-chart-ui`, and the floating
  toolbar no longer clips its dropdown.
- Guard: added `npm run check:replay-toolbar-events`.

### Save drawing template modal parity
- Replaced native browser prompts for saving drawing templates from both the floating drawing
  toolbar and `ObjectSettingsDialog`.
- Added `SaveDrawingTemplateDialog`: TradingView-style dark modal with `Save drawing template`,
  `New template name`, focused input, Cancel/Save buttons, disabled Save on empty input, and a
  dropdown of existing names for overwrite-by-name within the current style family.
- Guard: added `npm run check:template-save-dialog` so `window.prompt("Save drawing template as:")`
  cannot return unnoticed.

### Replay engine TradingView logic audit
- Fixed `Select date...` and dashboard date jump to select the candle closest to the requested date,
  matching TradingView's Bar Replay wording. The previous logic always chose the candle at/before
  the timestamp.
- Added `indexNearestByTime()` in `replayEngine.ts` and reused it from `ReplayTimingMenu`,
  `ReplayDashboard`, and `ReplaySelectionLayer` so manual chart picks and date picks share one
  snap rule.
- Kept `mtfSnapshot()` on `indexAtOrBefore()` deliberately: higher-timeframe rows must never reveal
  a bar that starts after the replay cursor.
- Updated `setTotalAtom` to sanitize total history length, clamp `anchor`/`cursor` when history
  shrinks, pause at the new end, and fully disarm/reset replay when history becomes empty.
- Added `scripts/check-replay-logic.mjs` and `npm run check:replay-logic` to guard these invariants.

### Replay mode TradingView timing controls
- Added `ReplayFloatingToolbar` over the chart so Bar Replay controls live where TradingView places
  them, instead of only inside the bottom Replay panel.
- Added shared `ReplayTimingMenu` with `Select bar`, `Select date...`, `Random bar`, and first-day
  selection. Both the floating toolbar and bottom replay panel use this same logic.
- Removed the non-TradingView `Quick start (70%)` shortcut from replay controls.
- Changed replay speed presets to TradingView-like timing values: `0.1x`, `0.3x`, `0.5x`, `1x`,
  `3x`, `10x`; default speed is `1x`. Speed UI is now a slider with a live value label.
- Added `Shift+Down` play/pause and `Shift+Right` forward-one-bar hotkeys while keeping Space and
  arrow controls available.
- Fixed `parseDateInput()` so `YYYY-MM-DD HH:mm`, `YYYY-MM-DDTHH:mm`, and date-only inputs all work
  for replay date selection.

### Reset chart view TradingView parity
- Fixed the toolbar `Reset chart view` action so it no longer calls `timeScale().fitContent()`,
  which fit the entire loaded history and felt different from TradingView.
- Both the chart context menu and toolbar now call `resetChartView()`: reset active timeframe bar
  spacing/right offset, reset time scale, scroll to realtime, and re-enable right price autoscale.
- `PriceChart.tsx` publishes the active timeframe viewport defaults into `chartRegistry`, so reset
  view stays correct after switching timeframe.

### Long/Short position settings dialog parity + double-click edit
- Updated `PositionSettingsDialog.tsx` toward the TradingView reference: compact 380px dark dialog,
  larger title with pencil/close controls, TradingView-like tabs, scrollable content, and footer
  actions (`Template`, `Cancel`, `Ok`).
- Kept the existing live-apply settings behavior, but removed the extra custom computed summary
  card from the Inputs tab so the field order matches TradingView more closely.
- Added chart double-click support for existing long/short position drawings. The interaction
  manager detects two close left-button pointerdowns on the same position within 350ms and opens
  the settings dialog before starting drag.
- Scope note: single-click selection, body drag, handle resize, TP/SL hit selection, and the
  recent width-preservation/hit-resolution fixes remain on the existing code path.

### Long/Short position drag width regression fix
- Fixed the short/long position body-drag regression where a TP/SL-hit drawing widened while being
  moved. `PositionTool` now treats TP/SL hit as visual state only; hit status may change labels,
  fill alpha, and diagonal hit guide, but it must not mutate `geo.xR` or any editable point width.
- Added `scripts/check-position-drag-width.mjs` and `npm run check:position-drag`. The script
  rejects the old hit-freeze geometry pattern and simulates repeated body drags to both the right
  and the left, asserting the time-width never changes.

### Position hit status hard-refresh fix
- Fixed the F5/reload case where a Long position that had already hit SL could re-render as TP when
  the initial reloaded candle window started after the entry/SL sequence and only contained later
  candles that reached target.
- Added `resolvePositionHit()` and `positionHitDataCoversEntry()` in `PositionTool.ts`. Candle data
  is authoritative only when it covers the entry time; otherwise the persisted TP/SL status is kept.
- `DrawingLayer.tsx` now uses the same resolver and only clears persisted TP/SL status when loaded
  candles cover the entry time and no hit is found.
- Added `scripts/check-position-hit-resolution.mjs` and `npm run check:position-hit` to simulate the
  partial-history reload case and assert a persisted SL stays SL.

### Long/Short position TradingView parity + SL-hit selection fix
- Fixed the post-hit selection bug in `PositionTool.ts` without extending the drawing to the hit
  candle. `hitTest()` and `boundingBox()` use the user-defined box plus the label chip band.
- Included the position label chip band in the body hit zone, so clicking `Stop:`, `Target:`, or
  `Entry:` also selects the object.
- Edit handles remain tied to the editable right edge, matching the existing anchor model and
  avoiding regressions where TP/SL hit state changes stored width unexpectedly.
- Updated the position labels to `Entry:`, `Target:`, and `Stop:` and changed target/stop percent
  stats to absolute distances, which is closer to TradingView and fixes misleading negative target
  percentages on short positions.
- Selected position drawings now show blue square handles around the box, closer to TradingView's
  selected-object controls than the previous circular generic drawing handles.

### TradingView-like chart motion and zoom update
- Updated `PriceChart.tsx` chart interaction options to better match TradingView behavior:
  mouse/touch kinetic panning is enabled, mouse-wheel zoom keeps the hovered bar stable, and new
  realtime bars shift the visible range only when the chart is already at the live edge.
- Added shared constants for right offset and minimum bar spacing so chart creation and theme/
  timeframe re-application stay consistent.
- Kept the existing O(1) `series.update()` realtime path for forming candles and appended candles;
  this version of Lightweight Charts does not expose `LastPriceAnimationMode` for candlestick
  series, so no unsupported series option is used.
- Scope note: this change is isolated to chart rendering/interaction. MT5 bridge, order sizing,
  risk validation, and trade execution paths are unchanged.

### Current-price marker TradingView parity update
- Replaced the default black Lightweight Charts current-price chip with a custom
  `CurrentPriceMarker` inside `PriceChart.tsx`.
- The marker is positioned from `candleSeries.priceToCoordinate(price)`, so it follows the real
  current-price line instead of sitting at a fixed `top: 50%`.
- Marker layout mirrors the TradingView reference: symbol chip on the left, price + countdown
  stacked on the right, and a small pointer toward the price line.
- Marker color follows immediate tick direction by comparing the current marker price with the
  previous marker price. It does not use `lastQuote.change`, which is session/24h change and can be
  green while the latest tick is falling.
- Native `lastValueVisible` stays disabled to avoid the black LWC price chip and duplicate labels.

### Python FTMO MT5 service adapter
- Added `bridge/ftmo_mt5/`, a standalone Python service that speaks the same Phase 6B WebSocket
  protocol as the browser and Node dry-run bridge.
- Added MT5 adapter code for terminal initialize/login, account/positions/orders/symbol snapshots,
  `order_check` before `order_send`, SL/TP modify, single-position close, close-all, and pending
  cancel through the official `MetaTrader5` Python package.
- Live mode requires both `FTMO_BRIDGE_DRY_RUN=false` and `FTMO_BRIDGE_ALLOW_LIVE=true`; dry-run
  remains default and FTMO credentials remain bridge-only.
- Added `bridge/ftmo_mt5/requirements.txt`, `bridge/ftmo_mt5/README.md`, and
  `npm run ftmo-mt5-python`.
- Local Python checks could not be run in this workspace because neither `python` nor `py` exists
  in PATH. Next validation must run on Windows/VPS with Python, the `MetaTrader5` package, and MT5
  terminal installed.

### FTMO MT5 dry-run copy trading bridge
- Added `scripts/ftmo-mt5-bridge.mjs` and `npm run ftmo-mt5-bridge`, a standalone FTMO bridge
  process that speaks the existing Phase 6B WebSocket protocol without changing simulator trading.
- Bridge is disabled/dry-run by default. With `FTMO_MT5_ENABLED=true` and
  `FTMO_BRIDGE_DRY_RUN=true`, it emits `ftmo.readiness`, `risk.snapshot`, account/symbol/position
  snapshots, validates web order intents, writes append-only audit JSONL, and simulates fills back
  to the web app.
- Implemented bridge-side guards: SL required by default, symbol mapping, lot min/max/step
  normalization, max order volume, per-trade risk cap, daily/max loss guard, daily order count,
  message rate limit, close-all kill switch, duplicate `clientOrderId` handling, and redacted audit
  logging.
- Live FTMO execution remains intentionally blocked with `LIVE_ADAPTER_NOT_CONFIGURED` until a real
  MT5 adapter is added and demo-validated.
- Updated `.env.example`, `.gitignore`, `docs/PHASE6B_FTMO_COPY_TRADING_PLAN.md`, and status docs.

### Multi-broker MT5 copy trading plan
- Added `docs/PHASE6B_MULTI_BROKER_MT5_COPY_TRADING_PLAN.md` as a broker-agnostic reference for
  copying web terminal orders to MT5 broker accounts such as Exness, IC Markets, Pepperstone, or
  any other MT5-compatible broker.
- The plan keeps broker credentials bridge-only and defines broker/account profiles, symbol
  discovery, broker-specific lot sizing, execution/fill differences, dry-run validation, audit
  logging, account routing, QA matrix, and live-mode hardening.

### FTMO MT5 copy trading plan
- Added `docs/PHASE6B_FTMO_COPY_TRADING_PLAN.md` for the requirement: place an order on the web
  terminal and copy the same intent into the user's FTMO MT5 account.
- Scope is intentionally bridge-side: FTMO login/master password/server stay outside the browser;
  the bridge connects to MT5, validates account readiness, maps symbols/lots, applies FTMO-aware
  loss/risk guards, writes an audit log, and only then submits orders to MT5.
- The plan stages delivery through docs/rule config, real bridge skeleton, MT5 session snapshots,
  dry-run order checks, demo execution, then explicit funded-mode hardening.

### Phase 6B MT5 bridge implementation scaffold
- Implemented the first Phase 6B code pass while preserving simulator mode as the default:
  `src/types/mt5.ts`, `src/services/mt5/{protocol,symbolMapping,runtime,Mt5BridgeClient}.ts`,
  `src/store/mt5Store.ts`, and `src/hooks/useMt5Bridge.ts`.
- Added `npm run mock-mt5` via `scripts/mock-mt5-bridge.mjs`. It uses Node core HTTP upgrade and
  minimal WebSocket framing, so no new dependency is required. Verified handshake/auth/account
  snapshot with a local Node WebSocket client.
- Added MT5 Trade Panel UI: `ExecutionModeSwitch`, `Mt5ConnectionPanel`, `Mt5CommandLog`, and
  `LiveOrderConfirmDialog`. `OrderTicket`, `PositionsTable`, and `TradeLevels` now switch between
  simulator data and MT5 bridge data based on `executionModeAtom`.
- Safety decisions: `tradeStore.ts` was not modified; MT5 is disabled by default; live commands
  require explicit MT5 mode, connected bridge, account snapshot, bridge symbol info, lot-step and
  max-volume validation, and confirmation by default. Chart context-menu quick trade pre-fills the
  ticket in MT5 mode instead of sending a live order directly.
- Checks: `npm run typecheck` ✅ · `npm run lint` ✅ · `npm run build` ✅ ·
  `node --check scripts/mock-mt5-bridge.mjs` ✅.

### Phase 6B MT5 bridge protocol plan
- Added `docs/MT5_BRIDGE_PROTOCOL.md`, the concrete browser-to-bridge WebSocket/JSON contract for
  Phase 6B: connection/auth/heartbeat flow, snapshot payloads, order command payloads,
  `order.ack` vs. `execution.report` semantics, bridge error codes, frontend risk gates, mock
  bridge requirements, and rollback behavior.
- Updated Phase 6B status docs so the next implementation work starts from the protocol and then
  proceeds through `src/types/mt5.ts`, `scripts/mock-mt5-bridge.mjs`, MT5 env placeholders,
  `Mt5BridgeClient`, and `mt5Store`.
- Files: `docs/MT5_BRIDGE_PROTOCOL.md`, `docs/PHASE6B_MT5_BRIDGE_PLAN.md`,
  `docs/PHASE6_IMPLEMENTATION_PLAN.md`, `docs/NEXT_TASKS.md`, `docs/CURRENT_STATE.md`,
  `docs/PROJECT_ARCHITECTURE.md`, `docs/HANDOFF.md`, `docs/CHANGELOG.md`.
- Docs-only change; no runtime checks required.

### Watchlist rebuilt as a 1:1 TradingView clone (dark + light)
- User request (with reference screenshot): clone TradingView's watchlist UI 1:1, both themes,
  including the tick animation which "didn't look like TradingView".
- Rebuilt `Watchlist.tsx`: TradingView panel header ("Watchlist ⌄" + add / grid / ⋯ sort menu),
  4 sortable columns `Symbol | Last | Chg | Chg%` (click header to sort, ▲/▼ indicator; new
  `changeAbs` sort key), 30px rows with circular symbol logos (new `SymbolLogo.tsx` — overlapping
  FX flag pairs, metal+flag, crypto coin, index logos from TradingView's public logo CDN with a
  lettered fallback), superscript fractional-pip last digit for FX/metals, true minus sign, no "+"
  on gains, rounded-outline active row, tabular-nums sans numbers (`.tnum`), exchange sub-line
  removed.
- Tick animation now matches TV: only the **Last cell** flashes a solid bull/bear block with white
  text fading out (`wl-flash-up/down`, replacing the whole-row `animate-watch-flash-*`); keyed by a
  tick sequence so consecutive same-direction ticks re-flash.
- Dark-theme `--bull`/`--bear` updated to TradingView's current palette `#089981`/`#f23645`
  (matches light), and `chartTheme.ts` candle/volume colours unified to the same pair so chart ==
  watchlist.
- Files: `src/components/watchlist/{Watchlist,SymbolLogo}.tsx`, `src/store/watchlistStore.ts`,
  `src/app/globals.css`, `src/components/chart/chartTheme.ts`.
- type-check ✅ · lint ✅ · build ✅ · Playwright screenshots verified in both themes against a
  fresh `next dev` (crypto rows streamed live; FX rows showed "—" only because no OANDA key was
  present in that environment — data availability, not UI).

### "+ Add text" for fillable shapes + 3 double-insert bugs found while verifying it
- User request: TradingView shows a "+ Add text" placeholder centered inside a selected
  Rectangle/Circle/etc.; the app was missing this entirely (only `d.text` rendering existed, and
  only for Rectangle).
- Implemented: `renderShapeText()` shared helper (`plugins/shared.ts`) used by all 5 shape plugins
  (Rectangle/RotatedRect/Circle/Ellipse/Triangle — `SHAPE_TOOLS`); also fixed `Circle`/`Ellipse`
  silently not rendering `fillColor` despite it being settable. New floating "+ Add text" /
  invisible re-edit hitbox in `DrawingLayer.tsx`, positioned via the same `adapter.boundingBox()`
  used by the hitTest pre-filter, reusing the existing `TextEditor` inline-input component.
- While verifying with a scripted Playwright repro, found and fixed **3 separate double-insert
  bugs** (all confirmed live, not guessed): every created drawing was inserted twice under an
  identical id (`addDrawingWithHistory` called `addDrawing()` directly *and* ran a
  `CreateDrawingCommand`, which already calls `addDrawing()` itself); Ctrl+D/Ctrl+V created two
  independent copies the same way one level up; and a *third*, separate cause — `useHotkeys.ts` and
  `DrawingInteractionManager.ts` are two independent global keydown listeners that both handled
  Delete/Ctrl+A/Ctrl+D, so Ctrl+D produced 3 copies even after fixing the first two bugs. Removing
  the redundant (non-undo-tracked) handlers from `useHotkeys.ts` also fixed single-selection Delete
  not being undoable (it was racing the two listeners and the non-undo-tracked one usually won).
- Files: `src/components/chart/drawing/tools/plugins/{shared,RectangleTool,CircleTool,EllipseTool,
  TriangleTool,RotatedRectTool}.ts`, `src/components/chart/DrawingLayer.tsx`,
  `src/components/chart/DrawingSettingsToolbar.tsx` (reuse `SHAPE_TOOLS` instead of a local dupe
  list), `src/components/chart/drawing/history/CommandManager.ts` (`DuplicateDrawingCommand`
  `onCreated` callback), `src/components/chart/drawing/interaction/DrawingInteractionManager.ts`,
  `src/hooks/useHotkeys.ts`.
- type-check ✅ · lint ✅ · build ✅ · verified live via a scripted Playwright repro (create → 1
  entry; Ctrl+D → 2; Ctrl+D+Ctrl+V → 3; add-text button appears/click/type/Enter patches the shape
  and the button becomes an invisible re-edit hitbox; screenshot-confirmed text renders centered).

### Shape add-text editor drag regression fixed
- User repro: click `+ Add text` inside a rectangle, then drag the rectangle; the rectangle moved
  but the inline input stayed at the old screen position.
- Root cause: `TextEditor` only committed on native blur, and document-level drawing listeners run
  in capture phase. Pointering into the chart could start a shape drag without reliably blurring the
  focused input, leaving the editor as a stale floating overlay.
- Fix: `TextEditor` is now `data-chart-ui`, commits/cancels on outside `pointerdown`, and guards
  against duplicate completion from `pointerdown` plus `blur`. Shape and standalone text editors
  remount per drawing id to avoid stale editor state when switching drawings.
- Follow-up fix after user repro: `DrawingLayer` now intercepts chart-area pointerdown while a shape
  text editor is open, commits the draft text, and consumes that pointer event before body-drag can
  start. The shape editor coordinates are derived from the current shape `boundingBox()` instead of
  the original `+ Add text` click position.
- Guard: added `npm run check:shape-text-editor`.

### Alert stayed "Active" client-side after a real server-confirmed trigger
- After the false-trigger fix, the user hit a *different*, legitimate gap: a `BTCUSDT crossUp`
  alert genuinely crossed and the server sent a real push (confirmed received), but the alert
  stayed listed as "Active" in the client (line still on chart) after reopening the tab.
- Root cause confirmed with live console data: the client's reopen-recovery scan is bounded by the
  **currently selected chart timeframe** (15m in this case). The brief crossing happened ~10s after
  the alert was armed, entirely within a 15-minute candle that had *started before* the alert
  existed — so the candle-level `since` cutoff correctly excludes that candle's aggregate high/low
  (to avoid pre-arm history), but that also throws away the legitimate post-arm portion inside the
  same candle. The server (1-minute Binance klines) doesn't have this blind spot and correctly
  caught + delivered the trigger; the client's own candle-bounded scan just can't see it.
- Rather than trying to always fetch finer-than-chart-timeframe history client-side, added a
  reconciliation path: the server now persists the actual `triggerPrice` per alert
  (`PushDeviceRecord.alertState[id].triggerPrice`, in `pushAlertEvaluator.ts`), and a new endpoint
  `POST /api/push/alerts/status` (`src/app/api/push/alerts/status/route.ts`) returns confirmed
  triggers for a device token (guarded by matching `alertSignature` so an edited/stale alert is
  never misapplied). A new hook `usePushTriggerReconcile.ts` (mounted in `GlobalRuntime`, alongside
  `usePushAlertSync`) polls this on mount, on `visibilitychange`→visible, and every 60s, and applies
  any newer-than-known trigger via the same `triggerAlertAtom` the live engine uses — without
  re-delivering notifications (those already went out server-side).
- Extracted the external (non-FCM) sync-token logic shared by `usePushAlertSync` and
  `usePushTriggerReconcile` into `useExternalSyncToken.ts` to avoid duplicating it.
- Files: `src/types/pushAlerts.ts`, `src/server/pushAlertStore.ts` (added `getPushDevice`),
  `src/server/pushAlertEvaluator.ts` (exported `alertSignature`, persist `triggerPrice`),
  `src/app/api/push/alerts/status/route.ts` (new), `src/services/notifications/push.ts` (added
  `fetchPushTriggerStatus`), `src/hooks/useExternalSyncToken.ts` (new),
  `src/hooks/usePushTriggerReconcile.ts` (new), `src/hooks/usePushAlertSync.ts` (refactored to
  share the token hook), `src/components/layout/GlobalRuntime.tsx`.
- type-check ✅ · lint ✅ · build ✅ · verified the new endpoint live against the real device/alert
  that had already fired server-side — returns the confirmed trigger correctly.

### Alert falsely triggered (+ push sent) even though price never touched the level
- User report: created a fresh `BTCUSDT crossDown ~60021` alert (price was ~60083 and never came
  back down to it), closed the tab — the alert line disappeared and both a notification and a push
  notification fired anyway.
- Root cause: `observedSinceArm()` in `src/hooks/useAlertEngine.ts` re-derived its rescan cutoff
  (`sinceMs`) from the *previous* tick's `candleTime` on every continuing call:
  `existing.candleTime !== undefined ? existing.candleTime * 1000 : 0`. If candle history for that
  symbol/timeframe hadn't loaded yet on some earlier tick (very possible right after creating a
  fresh alert — the ticker/kline subscription can lag a beat behind), `candleTime` was `undefined`
  on that tick, `sinceMs` collapsed to **epoch 0**, and every following tick's cutoff check
  (`c.time * 1000 < sinceMs`) never broke — the scan walked the *entire* loaded candle series (up
  to 500 bars) and folded in whatever historical high/low it found, not just what happened since
  the alert was armed. Any past dip below the target anywhere in that loaded history then read as
  "crossed" even though the live session never touched it.
- Fix: track the cutoff as its own field (`ObservedAlertRange.sinceMs`) instead of re-deriving it
  from `candleTime`, and only ever advance it forward when a real candle time is known — a tick
  with no candle history yet now keeps the previous trusted cutoff instead of falling back to 0.
- Files: `src/hooks/useAlertEngine.ts`.
- type-check ✅ · build ✅. Client-side fix — requires a page reload to pick up the new bundle
  (verified server restart serves the rebuilt client; user needs to reload the tab).
- **Confirmed live with the user**: added temporary `console.debug` instrumentation
  (`baf6d61`), had the user hard-refresh and paste real console output for the live
  `BTCUSDT crossDown ~60038.39` alert — `low: 60152` since arm vs. an actual ~58393 dip that
  happened *before* the alert was created (correctly excluded from the scan). Confirms the fix
  bounds the rescan to since-armed, not full history. Debug logging removed in `e0d7d30`. Also
  separately confirmed the crossUp counterpart legitimately triggered (real crossing) and the user
  received the push notification for it.

### Closed-browser push still silent after the in-process worker fix
- User re-tested after the in-process worker fix and still got no FCM push notification when a
  price touched their alert level while the browser was closed.
- Investigated the live running server directly (Firestore device/alert records,
  `/api/push/evaluate?debug=1`, `/api/notifications/test`) instead of guessing:
  - **Telegram delivery confirmed working** via the test endpoint — it doesn't depend on the
    browser/service worker at all, since it's a plain server → Telegram Bot API call. Recommended
    to the user as the reliable closed-browser channel alongside/instead of FCM push.
  - **Found the FCM push TTL was only 300 seconds** (`firebaseAdmin.ts`'s `webpush.headers.TTL`).
    If the browser/device doesn't reconnect to the push service within 5 minutes of the send, the
    push service drops the message for good — closing the browser for any realistic test duration
    silently loses the notification even though the server-side send succeeds (`messageId`
    returned, no error). Bumped to 86400s (24h).
  - **Found a real duplicate-trigger race**: manually firing two/three concurrent
    `/api/push/evaluate` calls (which happens naturally when the in-process worker's interval
    overlaps a manual or cron call) let each call read Firestore before the other's write landed,
    so a one-time alert fired 3 times in the live server log (`triggered=1` x3) instead of once.
    Fixed with an in-process `inFlight` promise lock in `evaluatePushAlerts()` so overlapping calls
    within the same server process share one evaluation instead of racing. Verified by firing 3
    concurrent evaluate calls and confirming identical, single-evaluation results.
  - Also flagged the fundamental Web Push limitation (not fixable in this codebase): browser
    push delivery requires the browser's own background process to stay alive even with every
    tab/window closed. If the user fully quits/kills the browser app, no web push implementation
    can delivered until it's reopened — this is why Telegram/Discord are the more reliable
    closed-browser channels.
- Files: `src/server/firebaseAdmin.ts`, `src/server/pushAlertEvaluator.ts`.
- type-check ✅ · build ✅ · manually verified against a real `next start` instance (live Firestore
  device records, concurrent evaluate calls, live Telegram test send).

## Completed 2026-07-01

### Closed-browser push silently never fired (no evaluator was running)
- User report: create an alert, close the browser, no push notification arrives; reopening the
  tab immediately shows the alert as triggered (via the existing reopen-recovery scan).
- Root cause: closed-browser delivery has always required a *second*, always-running process
  (`npm run push-worker`, or an external cron hitting `/api/push/evaluate`) — `useAlertEngine` only
  evaluates alerts while a browser tab is open. Checked the running processes on the dev machine:
  neither `next dev`/`next start` nor `push-alert-worker.mjs` was running, so nothing was ever
  polling prices while the tab was closed. This is the documented "Worker not running" failure
  mode in `docs/PHASE6A_PUSH_NOTIFICATIONS.md` — not a new bug in the evaluation/delivery code
  (which was already fixed earlier today for the data-only FCM payload and the Binance geo-block).
- Fix: added `src/instrumentation.ts`, which starts the same `evaluatePushAlerts()` evaluator
  in-process via a `setInterval` when the Next server boots (`register()` hook), so `npm run dev`
  / `npm run start` alone is enough — no second terminal to remember. Skipped when
  `process.env.VERCEL` is set (serverless functions can't host a long-lived interval; use the
  documented external cron there) or when `DISABLE_PUSH_WORKER=true`. `scripts/push-alert-worker.mjs`
  is kept as-is for that external/Vercel case.
- Verified end-to-end: built + started `next start`, confirmed the
  `[push-worker] in-process closed-browser evaluation started` log line appears, and called
  `POST /api/push/evaluate?debug=1` with the local `PUSH_WORKER_SECRET` — returned `ok:true` with
  the registered devices.
- Files: `src/instrumentation.ts` (new).
- type-check ✅ · build ✅ · manually verified against a real `next start` instance.

### Alert line no longer "jumps" when dragged near the live price
- Root cause (found via a scripted Playwright repro against a clean dev server, not guesswork):
  `AlertLines`' reconciliation effect depended on `symbolAlerts`, a brand-new array every render —
  including every price tick, since `useChartCtx()` gets a new reference each tick. That destroyed
  and recreated the native price line dozens of times per second unconditionally, which is the
  actual "nhảy view" the user saw, worse near the live price (more ticks land there).
- Fixed by keying the effect on a stable string (`id:price` pairs) instead of the array reference.
- Also added a `draggingAlertIds` guard (new export in `alertLineRegistry.ts`) so `AlertLines`
  doesn't destroy+recreate a line mid-drag when `AlertOverlay` has imperatively moved it ahead of
  the store commit — that was a second, smaller contributor to the same symptom.
- Files: `AlertLines.tsx`, `AlertOverlay.tsx`, `alertLineRegistry.ts`.
- type-check ✅ · lint ✅ · build ✅ · manually reproduced-then-fixed via Playwright.

### Alert line survives a visible mid-session crossing
- `observedSinceArm`'s continuing (browser-still-open) branch only widened forward from the latest
  tick's single candle, so a websocket reconnect / backgrounded tab / kline gap could drop a candle
  entirely — a real crossing visible on the chart never got detected.
- Fix: unified first-observation and continuing paths into one rule — rescan the loaded candle
  series for anything since the last-known point (walking backward from the newest candle, stopping
  at the cutoff, so the steady-state cost stays O(1-2) candles per tick).
- Files: `src/hooks/useAlertEngine.ts`.
- type-check ✅ · lint ✅ · build ✅.

### Alert stuck "pending" after reopen if the touch happened in an older candle
- `useAlertEngine`'s reopen recovery (`observedSinceArm`) only checked the current forming candle's
  high/low, so a level crossed while the browser was closed but inside an already-closed candle
  (not the latest bar) was never detected — the alert stayed armed forever after reopening.
- Fix: for alerts that predate the current browser session, scan every loaded candle since the
  alert's `updatedAt` and aggregate high/low across the whole gap. Added a guard so this recovery
  waits for candle history to load before locking in a range, instead of collapsing to a single
  point if a live quote arrives before the REST candle backfill.
- Files: `src/hooks/useAlertEngine.ts`.
- type-check ✅ · build ✅.

### Closed-browser push: notifications weren't displaying at all
- `sendFirebasePush` (`firebaseAdmin.ts`) still populated `webpush.notification.title/body`, which
  makes FCM auto-display the notification via the browser's built-in handling and skip the custom
  `onBackgroundMessage` handler already written in the service worker — so background delivery was
  silent/inconsistent even though the alert correctly triggered server-side.
- Fix: send a pure data-only FCM message (dropped `webpush.notification` entirely); the SW's
  existing `onBackgroundMessage` → `showNotification()` path now always runs.
- Files: `src/server/firebaseAdmin.ts`.
- type-check ✅.

### Closed-browser push: fix Binance geo-block on server-side price fetch
- Diagnosed cron-job.org-triggered `/api/push/evaluate` runs skipping every crypto alert with
  "price unavailable" and an empty `errors` array. Root cause: `fetchBinancePrice` called
  `api.binance.com`, which returns HTTP 451 for requests from US-hosted server IPs (Vercel
  serverless), and the failure was swallowed (`return undefined`) instead of surfaced.
- Fix: switched to `data-api.binance.vision` (Binance's unrestricted market-data mirror) and made
  fetch/parse failures throw so they show up in the evaluation's `errors` array.
- Files: `src/server/pushAlertEvaluator.ts`.
- type-check ✅.

### Long/Short position settings parity
- Rebuilt `PositionSettingsDialog` to match the TradingView Long/Short Position settings UI shown in the reference: dark modal, Inputs/Style/Visibility tabs, fixed-width numeric fields, Default currency selector, section headers, line style picker, color swatches, text font control, price-label checkbox, Stats multi-select, Compact stats mode, and Always show stats.
- Wired the Style tab into the renderer. `PositionTool` now respects custom line style, target/stop colors, text color/font size, selected stat fields (`percent`, `ticks`, `rr`, `amount`), compact labels, and always-visible stats. Label chips now scale with font size via `shared.chip()`.
- Added position defaults for newly placed long/short tools to match the reference workflow: account size `1000`, risk `25%`, lot size `1`, leverage `10000`, Default currency, default target/stop/text colors, and percent stats.
- Files: `PositionSettingsDialog.tsx`, `PositionTool.ts`, `shared.ts`, `chartStore.ts`, `types/drawing.ts`.
- type-check pass; lint pass; build pass.

### Position tool — SL hit priority on ambiguous bars
- TP/SL detection checked the target before the stop within a single bar, so a
  bar piercing both levels falsely reported a TP hit. Stop is now evaluated
  first in all three sites (`PositionTool.findHitCandle`, `DrawingLayer` candle
  scan + live-price fallback) → ambiguous bars resolve to a stop hit
  (TradingView/backtest convention). Cross-bar chronology unchanged.

### Chart screenshot save fix
- Download anchor now appended to the DOM before `click()` (detached anchors are
  ignored in Firefox) and `revokeObjectURL` deferred (synchronous revoke aborted
  the download). `screenshot()` wraps capture in try/catch; `captureChart` guards
  the final `toBlob` and retries chart-only on throw.
- type-check ✅ · lint ✅ · build ✅.

## Completed this session (2026-06-30)

### ObjectSettingsDialog redesigned to match TradingView
- Tabs **Style · Text · Coordinates · Visibility** + **Template ▼ · Cancel · Ok**
  footer; live preview with Cancel-revert (snapshot) and Ok-commit.
- Style (rectangle): Extend · Border · Middle line · Background (colour swatches,
  width/style line widgets, opacity slider). Text tab: colour/font/Bold/Italic +
  textarea + alignment. Wired into `RectangleTool`/`TextTool` rendering via new
  model fields (`bold/italic/textColor/textHAlign/textVAlign/extend/showMiddleLine/
  middleLineColor/middleLineStyle`), folded into `drawingsHash` + `TEMPLATE_STYLE_KEYS`.
- type-check ✅ · lint ✅ · build ✅.

### Drawing toolbar — Settings (hexagon) + Style Templates (plan §1, §2)
- **⬡ Settings for every object:** floating `DrawingSettingsToolbar` now shows a
  hexagon settings button for all drawings. New `ObjectSettingsDialog` (non-position
  tools) with family-based tabs — line/shape → Style · Coordinates · Visibility;
  text/emoji → Style · Visibility. Position tool keeps `PositionSettingsDialog`.
  Update 2026-07-04: standalone Text settings now use Text · Visibility to
  match the current TradingView text-object dialog.
- **▦ Templates:** save the selected object's style as a named, global, family-scoped
  preset; apply/delete from the toolbar popover. Style-only (never points/id). New
  `DrawingTemplate` type + template atoms, persisted under `drawingTemplates`.
- **Repaint fix:** `CanvasRenderer.drawingsHash()` now includes style fields so
  toolbar/dialog/template edits repaint immediately.
- **Anchor (§3) deferred** — high blast radius (needs viewport dims in the hit-test
  pipeline); no dead button added. See `DRAWING_TOOLBAR_PLAN.md`.
- Files: `chart/ObjectSettingsDialog.tsx` (new), `chart/PositionSettingsDialog.tsx`,
  `chart/DrawingSettingsToolbar.tsx`, `store/chartStore.ts`, `types/drawing.ts`,
  `components/Terminal.tsx`, `chart/drawing/renderer/CanvasRenderer.ts`.
- type-check ✅ · lint ✅ · build ✅.

## Current phase / milestone
- **✅ Phase 1 — Realtime Market Data Foundation — COMPLETE (Steps 1–17).**
- **✅ Phase 2 — Alert Engine — COMPLETE** (+ audit + Phase 2.1 interactive chart alerts).
- **✅ OANDA Integration — COMPLETE** (forex/metals/indices realtime + historical data).
- **✅ Phase 3 — TradingView UI Parity — COMPLETE** (visual ~95%, interaction ~87%).
- **✅ Phase 4.3 — SHAPE TOOLS SUITE — COMPLETE.**
- **✅ Phase 4.2.2 — TOOL GROUP SYSTEM — COMPLETE** (flyout portal fix).
- **✅ Phase 4.4 — FIBONACCI SUITE — COMPLETE.**
- **✅ Drawing engine stabilization — COMPLETE** (see below).
- **✅ Phase 5 — Left Toolbar / Indicator Engine — COMPLETE** (see below).
- **✅ Jotai migration — COMPLETE** (all 11 stores converted, Zustand removed).
- **Next milestone: Phase 6 — Push Notifications / MT5 Integration.**

## Completed this session

### Path tool TradingView parity (2026-06-29)
- Path tool was a closed filled polygon; TradingView's Path is an open connected
  polyline with a single arrowhead at the end. Rewrote `PathTool.render` (open,
  no fill, terminal arrowhead via new `arrowHead()` in `shared.ts`) and added
  segment-body hit-testing so the line is grabbable.
  Files: `chart/drawing/tools/plugins/PathTool.ts`, `chart/drawing/tools/plugins/shared.ts`.

### Position box "grows/pins to SL bar" during drag fix (2026-06-29)
- The real symptom: dragging a long/short position fast across its own stop/target
  made the box suddenly enlarge & pin to the SL/TP candle. Cause: drag start clears
  `tradeStatus`/`hitTime`, so `PositionTool.render` fresh-detected each frame and
  extended `geo.xR` to the hit candle. Fix: transient `_dragging` flag on the
  live-drag clone (`CanvasRenderer`) → `PositionTool` skips the hit-freeze while
  dragging; freeze re-applies on commit. `_dragging` never persisted.
  Files: `types/drawing.ts`, `chart/drawing/renderer/CanvasRenderer.ts`,
  `chart/drawing/tools/plugins/PositionTool.ts`.

### Position-tool fast-drag "view jump" fix (2026-06-29)
- Fixed residual chart view jump/zoom when dragging or resizing the long/short
  position tool *fast* (worst in dense candle clusters, most visible right→left).
  Real cause: lightweight-charts pans off **mouse events**, but the manager only
  stopped *pointer* events — and the drawing canvas is `pointerEvents:"none"`, so
  mouse events flowed straight to the chart. Fix: capture-phase blocker swallows
  `mousedown`/`mousemove`/`wheel`/`touch*` during a drag (gated by synchronous
  `dragActiveRef`); the option-freeze (`freezeChart`) is kept as backup.
  Files: `chart/DrawingLayer.tsx`, `chart/drawing/interaction/DrawingInteractionManager.ts`.

### Position/drawing-tool bug pass (2026-06-28)

1. **Settings toolbar is now draggable + top-pinned** (`DrawingSettingsToolbar.tsx`): no longer
   hard-pinned next to the object. Defaults to the chart's **top-centre** on select (like
   TradingView's object toolbar) and can be dragged anywhere via a `GripVertical` handle; the
   dragged position is kept (clamped into view) until the selection clears.

2. **Position tool TP/SL highlight** (`PositionTool.ts` + `DrawingLayer.tsx` + `CanvasRenderer.ts`):
   when price reaches the target/stop the corresponding zone brightens (stronger fill + glow
   outline + "✓ HIT" / "✕ HIT" label), direction-agnostic for Long & Short. Price read from
   `candlesAtom`; a non-React `candlesAtom` subscription force-repaints the canvas per tick only
   when a long/short tool exists. `RenderLoop.markDirty(force?)` added.

3. **Smooth drag into whitespace** (`DrawingLayer.fromEvent`): dragging stalled past the last bar
   because `coordinateToTime()` returns `null` there (hit rectangles drawn at the right edge most).
   Now extrapolates time from the fractional logical index + bar interval, so all tools drag
   smoothly across the whole chart.

### Replay "Select Bar" feature (2026-06-29)

1. **Replay state machine**: Added `reSelectingAtom` boolean — a 5th state where replay remains
   armed but the user can pick a different bar to restart from. Added `beginReSelectAtom`,
   `cancelReSelectAtom`, `confirmReSelectAtom` write atoms.

2. **ReplayControls**: "Select Bar" button placed between speed controls and Exit Replay
   (TradingView order). When active, shows an orange re-select banner with Cancel (Esc) button.

3. **ReplaySelectionLayer**: Extended to handle both initial `selecting` and `reSelecting` modes.
   Hover data stored in refs only (`hoverIdxRef`, `dirtyRef`) — zero React state, zero store
   updates during mouse move. Re-select mode uses orange visual theme to distinguish from initial
   selection. Right-click cancels re-select. Full candle list access enables picking any bar
   including future bars past the cursor.

4. **Hotkeys**: ESC priority chain: reSelect → initial select → drawing deselect → tool cancel.
   Replay transport keys (Space, Arrows, R) blocked during reSelect.

5. **TopToolbar**: `toggleReplay()` now handles reSelecting → cancelReSelect. Button shows
   "Cancel select" label during re-select mode.

### Summary of files changed (this session)
- `replayStore.ts` — +4 write atoms, +1 state atom, extended interfaces
- `ReplayControls.tsx` — Select Bar button + re-select UI
- `ReplaySelectionLayer.tsx` — ref-based hover, dual-mode draw, right-click cancel
- `useHotkeys.ts` — ESC priority fix, transport keys guarded during reSelect
- `TopToolbar.tsx` — reSelect toggle in toolbar button
- `ARCHITECTURE.md` — updated replayStore row + SSOT paragraph
- `CHANGELOG.md` — Select Bar feature entry
- `CURRENT_PROGRESS.md` — this section

### Floating drawing settings toolbar (2026-06-28)

1. **`DrawingSettingsToolbar.tsx` (NEW)**: a TradingView-style floating toolbar shown above
   the selected drawing. Inline controls for stroke colour, fill (shapes), line width,
   line style, clone, lock, delete. Writes through `updateDrawingAtom` + store actions.

2. **Positioning**: projects the selection's anchor points, floats above (falls back below),
   clamps to the chart container, and tracks pan/zoom/resize via `ChartContext.version`
   re-renders.

3. **Interaction guard**: `DrawingInteractionManager` now bails on pointer events over
   `[data-drawing-toolbar]` (`isOverDrawingUI`) — toolbar clicks no longer deselect the
   drawing or begin a drag. Mounted in `DrawingLayer`.

### Trend Angle tool + line suite parity (2026-06-28)

1. **New `trendAngle` tool** (`TrendAngleTool.ts`): two-point line that always shows the
   visual angle in degrees with a dashed baseline + sweep arc + degree chip at p1
   (TradingView "Trend angle"). Registered in `adapters.ts`; `trendAngle` added to the
   `DrawingTool` union + `DRAWING_TOOLS` in `types/drawing.ts`.

2. **TrendLine text parity update**: the plain trend line no longer shows price change /
   % change / angle metrics. Those belong to `infoLine` and `trendAngle`; selected
   trendlines show TradingView-style `+ Add text` instead.

3. **Shared geometry helpers**: `angleDeg()` + `angleArc()` added to `plugins/shared.ts`.

4. **Toolbar LINES group** consolidated to mirror TradingView's "LINES" flyout (9 line
   tools + channel, in TradingView order, with inline hotkey labels). Merged the old
   "horizontals" group in. `ToolItem.hotkey` field added (`DrawingToolbar.tsx`).

5. **Hotkeys**: Alt+T / Alt+H / Alt+J / Alt+V / Alt+C bound to trend / horizontal /
   horiz-ray / vertical / cross line (`useHotkeys.ts`).

Build ✅ · type-check ✅ · lint ✅ (0 warnings).

## Earlier this session

### Drawing engine stabilization (2026-06-26)

1. **Ctrl+D duplicate bug (critical):** `DuplicateDrawingCommand` generates valid `uid("dw")` internally.
   `chartStore.addDrawing()` guards empty/falsy IDs. Eliminates cross-contamination from empty-id drawings.

2. **Store safety:** `addDrawing` deep-copies points, generates uid fallback for missing IDs.

3. **Right-click drag fix:** Added `e.button === 0` guard to cursor-mode `handleDown`. Right-clicks
   select drawings and open context menus without starting drag operations.

4. **DrawingContextMenu restored:** Moved `contextmenu` listener from canvas (blocked by
   `pointerEvents:"none"`) to document capture phase. Right-clicking a drawing now opens the
   drawing-specific menu (Clone, Delete, Lock, Hide, Bring, Send).

5. **Pointer capture release:** `activePointerIdRef` tracks captured pointer for explicit
   `releasePointerCapture()` on drag completion, Escape, and cancel paths.

6. **Adapter resolution:** Machine state stores `drawingTool` from `hit.drawing.tool` during
   drag start, eliminating `?? "trendline"` fallback.

7. **Undoable drags:** `commitMove` wired through to `handleUp`, recording `MoveDrawingCommand`.

8. **Render loop crash fix:** `CanvasRenderer` now checks `pr.length >= getTool(tool)?.minPoints`
   before injecting preview drawing. Prevents all 15 multi-point tools from crashing on partial
   previews (accessing `points[1]` when only 1 anchor exists).

9. **Drawing cancellation fix:** `handleUp`'s `releaseCapture`+`reset` moved back inside the
   `MovingDrawing`/`ResizingHandle` guard. Prevents cursor-mode pointerup from cancelling
   active drawing operations.

### Summary of files changed (this session)
- `CommandManager.ts` — DuplicateDrawingCommand fix
- `chartStore.ts` — empty-id guard, deep-copy points
- `DrawingLayer.tsx` — Ctrl+D fix, commitMove wiring
- `DrawingInteractionManager.ts` — button check, contextmenu fix, capture release, adapter fix, handleUp fix
- `CanvasRenderer.ts` — minPoints preview guard
- `useCommandHistory.ts` — ESLint fix
- `TrendLineTool.ts` — unchanged (bug was in renderer, not tool)
- `docs/` — CURRENT_PROGRESS.md, HANDOFF.md updated

### Phase 5 — Left Toolbar / Indicator Engine (2026-06-28)

1. **Indicator Settings Dialog:** `IndicatorSettingsDialog.tsx` — modal for customising indicator
   parameters (type, length/slow/signal, colours, overlay vs separate pane, visible toggle, remove).
   Opened via gear icon on indicator panes or from the Indicator menu.

2. **Hotkey system:** Extended `useHotkeys.ts` with drawing shortcuts: 1–9 for tool switching,
   Delete/Backspace for remove, Ctrl+D duplicate, Ctrl+A select all, Ctrl+Z undo guard,
   Ctrl+I toggle SMA, Escape deselect/cancel. Existing replay/trade shortcuts preserved.

3. **Left toolbar organisation:** Split into 9 tool groups (mode, trend lines, horizontals,
   shapes, freeform, fibonacci, positions, annotations) with proper separators. Added
   missing tools: channel, fib (legacy), emoji, long, short, brush, crosshair, eraser.

4. **IndicatorMenu enhancements:** Shows active indicators list with colour dots and
   settings gear; "Remove all indicators" action; clicking a toggle-open indicator opens
   settings dialog.

5. **IndicatorPane gear icon:** Settings gear next to indicator name opens the settings dialog.

6. **Left rail width:** Increased from 40px to 52px to accommodate the expanded toolbar.

### Summary of files changed (this session)
- `IndicatorSettingsDialog.tsx` — NEW: indicator parameter customisation modal
- `useHotkeys.ts` — extended with drawing + indicator keyboard shortcuts
- `DrawingToolbar.tsx` — 9 groups, 25+ tools, missing tools added
- `IndicatorMenu.tsx` — active indicators list, settings gear, remove all
- `IndicatorPane.tsx` — settings gear icon on indicator header
- `chartStore.ts` — `editingIndicatorId` + `setEditingIndicator` state
- `uiStore.ts` — left panel width 40 → 52px
- `Terminal.tsx` — wired IndicatorSettingsDialog + useHotkeys
- `docs/` — CURRENT_PROGRESS.md updated

## Build & quality status
- `npm run type-check` → ✅ PASS
- `npm run lint` → ✅ PASS (0 warnings)
- `npm run build` → ✅ PASS
- TODO/FIXME/HACK in `src/` → **0**

### Replay "Select Bar" feature (2026-06-29)

5th replay state added: `ReSelecting` (active=true, playing=false, reSelecting=true).
See `CHANGELOG.md` §"Added — Replay Select Bar" for full detail.

Files: replayStore.ts, ReplayControls.tsx, ReplaySelectionLayer.tsx, useHotkeys.ts,
TopToolbar.tsx. Docs: ARCHITECTURE.md, CHANGELOG.md, CURRENT_PROGRESS.md.

### Zustand → Jotai migration (2026-06-28)

All 11 Zustand stores replaced with Jotai atoms. ~60 consumer files updated.
Each store now exports individual atoms + write atoms for fine-grained subscriptions.
`zustand` package removed from dependencies.

Key patterns:
- `useStore((s) => s.field)` → `useAtomValue(fieldAtom)`
- `useStore((s) => s.action)` → `useSetAtom(actionAtom)`
- `useStore.getState()` → `getDefaultStore().get/set(atom)`

### Jotai hydration fix (2026-06-28)

**Infinite re-render loop in `GlobalRuntime`:** Fixed by replacing
`useAlertStore((s) => s.hydrate)` with `useSetAtom(hydrateAtom)`. The
compatibility `useXStore(selector)` hook reads all atoms and creates new
function references on every render — in a `useEffect` dependency array,
this causes the effect to re-fire after `hydrate()` mutates atoms, creating
an infinite loop. `useSetAtom` returns a stable function reference that
never changes. Pattern to avoid: never destructure action functions from
`useXStore(selector)` if they're used as `useEffect` dependencies.

## Remaining known issues
- Context menu bypasses undo history (DrawingContextMenu calls store directly)
- `framer-motion` broken (unused)

## Not started (later phases)
- Phase 6 — Push Notifications / MT5 Integration
