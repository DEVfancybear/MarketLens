# CURRENT PROGRESS

_Last updated: 2026-07-02 (FTMO MT5 dry-run bridge)_

## Completed this session (2026-07-02)

### Info Line measurement panel parity
- User repro: `InfoLineTool` showed a single blue chip with only price/% while TradingView shows a
  dark measurement panel.
- Fix: `InfoLineTool.ts` now renders a three-row panel with price change / percent / tick span,
  bars + elapsed time + pixel distance, and angle. The panel is positioned near the measured segment
  and clamped inside the chart viewport.
- Follow-up fix: panel width is now measured from its row text before render and clamped to the
  viewport; if the viewport cannot fit the full row, the text is ellipsized instead of overflowing
  beyond the grey panel when dragging the info line right-to-left.
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
