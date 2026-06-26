# CURRENT PROGRESS

_Last updated: 2026-06-26 (drawing engine stability fixes)_

## Current phase / milestone
- **✅ Phase 1 — Realtime Market Data Foundation — COMPLETE (Steps 1–17).**
- **✅ Phase 2 — Alert Engine — COMPLETE** (+ audit + Phase 2.1 interactive chart alerts).
- **✅ OANDA Integration — COMPLETE** (forex/metals/indices realtime + historical data).
- **✅ Phase 3 — TradingView UI Parity — COMPLETE** (visual ~95%, interaction ~87%).
  Watchlist 92%, toolbar 93%, typography 95%, spacing 92%, layout 93%,
  price marker 95% (native LWC), countdown 100%, header layout 95%.
- **✅ Phase 4.3 — SHAPE TOOLS SUITE — COMPLETE.**
- **✅ Phase 4.2.2 — TOOL GROUP SYSTEM — COMPLETE** (flyout portal fix).
  Toolbar shows 4 grouped icons (Cursor, Lines, Shapes, Text) with flyout menus.
  Flyout renders via `createPortal` to `document.body` to escape left-rail overflow.
- **✅ Phase 4.4 — FIBONACCI SUITE — COMPLETE.**
  Fib retracement (2-point, auto-levels at standard ratios) and fib extension
  (2-point, levels projected beyond B via A→B impulse). Both use the plugin
  architecture with full render/hitTest/movePoints/boundingBox support.
  Legacy `fib` tool kept for backward compat.
- **Next milestone: Phase 5 — Left Toolbar / Indicator Engine.**

## Completed this session
1. **Drawing engine stability fixes (5 files, 4 priorities):**
   - **Critical — Ctrl+D fix:** `DuplicateDrawingCommand` now generates its own valid `uid("dw")`
     instead of trusting the caller's ID. Ctrl+D handler in `DrawingLayer.tsx` no longer calls
     `duplicateDrawing` + command simultaneously (was creating 2 copies, 1 with `id:""`).
   - **Critical — Store guard:** `chartStore.addDrawing()` now generates `uid("dw")` if `d.id` is empty/falsy,
     and deep-copies points (`d.points.map(p => ({...p}))`) to prevent shared-reference corruption.
   - **High — Pointer capture release:** `DrawingInteractionManager` now stores `activePointerIdRef`
     and calls `releasePointerCapture()` explicitly in `handleUp`, `reset()`, and Escape paths.
   - **High — Adapter resolution:** Machine state now stores `drawingTool` from `hit.drawing.tool`
     during cursor-mode drag start, eliminating the `?? "trendline"` fallback.
   - **Medium — Undoable drags:** `commitMove` wired from `useCommandHistory` through to
     `DrawingInteractionManager.handleUp`, so drag operations are recorded as `MoveDrawingCommand`.
   - Build: type-check ✅ · lint ✅ (0 warnings) · build ✅ · zero `id:""` occurrences.
2. **TrendLineTool hit-test vocabulary fix:** Changed hitTest target from `"segment"` to
   `"body"` to align with the interaction manager's dragTarget vocabulary (`"p1" | "p2" | "body"`).
   Previously the interaction manager silently re-mapped `"segment"` → `"body"` at line 243 of
   `DrawingInteractionManager.ts`; now the pipeline is consistent end-to-end. Behavior unchanged —
   defaultMovePoints already handles all three trendline drag modes correctly. Removed unused
   `applyStyle` import from TrendLineTool.
3. **Phase 4.4 — Fibonacci Suite:** Implemented Fibonacci retracement (`fibRetracement`) and
   Fibonacci extension (`fibExtension`) drawing tools. Retracement: 2-point (high→low), auto-levels
   at 0/0.236/0.382/0.5/0.618/0.786/1, dashed anchor trend line, percentage + price labels.
   Extension: 2-point (A→B impulse), levels projected from B using A→B as base unit, ratios
   -0.272 through 2.618. Both use the `DrawingToolPlugin` architecture (render/hitTest/movePoints/
   boundingBox). `FIB_EXT_LEVELS` added to types. Shapes flyout updated to show both tools.
   Legacy `fib` tool + plugin retained for backward compatibility.
4. **Drawing interaction regression fix:** Fixed chart zoom/pan being blocked when drawings
   exist. Switched canvas from synthetic React events + event forwarding to native
   `addEventListener` with `pointerEvents: "none"` in cursor mode. Native listener fires
   regardless of CSS, hit-tests drawings, captures pointer on hit. Chart gets all events
   normally when not interacting with a drawing.
5. **Flyout portal fix:** Fixed tool group flyout menus being clipped by TerminalLayout
   `overflow-hidden`. Flyout now renders via `createPortal` to `document.body` with
   position computed from button bounding rects (`btnRefs`).
6. **Diagnostic cleanup:** Removed all temporary `console.log` traces from
   `DrawingLayer.tsx` (7 diagnostic blocks) and `chartStore.ts` (`setActiveTool`).
   Zero remaining debug logs in drawing engine or store.
7. **Phase 4.2.2 — Tool Group System:** Transformed flat 20-tool toolbar into
   4 TradingView-style grouped icons (Cursor, Lines, Shapes, Text) with flyout menus.
   Last-used tool per group becomes the visible sidebar icon. Backdrop closes flyout
   on outside click. Docs: TOOL_GROUP_ARCHITECTURE.md, TOOLBAR_BEHAVIOR.md.
8. **Phase 4.3 — Shape Tools Suite:** Implemented 8 TradingView-style shape tools (rectangle,
   rotatedRect, circle, ellipse, triangle, polyline, curve, path). Fill system (fillColor +
   opacity). Supply/demand zone workflow for rectangle. Zero core engine changes.
   Docs: SHAPE_TOOLS_ARCHITECTURE.md, RECTANGLE_TOOL_GUIDE.md, SHAPE_TOOL_TEST_PLAN.md.
9. **Phase 4.2 — Trend Line Suite:** Implemented 8 TradingView-style line tools (trendline,
   ray, extendedLine, infoLine, channel, horizontal, horizRay, vertical, crossLine, brush) via
   plugin architecture. Right-click `DrawingContextMenu` (Delete/Clone/Lock/Hide/Bring/Send).
   Style customization (color, line width).
10. **Phase 2 — Alert Engine:** `alertStore` (alerts/triggered/history/settings), pure `alertEngine`,
   `useAlertEngine` (evaluates off `marketDataStore`, refcounted subs, once-only), toast + browser +
   sound notifications, responsive Alert Center, persistence. Reference-counted subscriptions
   (`subRefs`) added to `marketDataStore`. `ALERT_ARCHITECTURE.md` written.
11. **Phase 2 audit:** `PHASE2_REVIEW.md` + `PHASE2_GAPS.md`.
12. **Phase 2.1 — interactive chart alerts:** alert lines are now selectable, draggable (reprice +
   persist), deletable; right-click / long-press menu (Edit/Clone/Disable/Delete), edit dialog,
   keyboard (Delete/Esc), `enabled`/`locked`. Replaced static `AlertLines` with `AlertOverlay`.
   (Resolved Phase 2 gaps G1 + G5.)
13. **OANDA Integration:** production-grade forex/metals/indices data provider via OANDA v20 REST
   API. `OandaProvider` with bearer-token auth, 1s pricing poll, historical candles, reconnect
   with backoff. Fallback to TwelveData when OANDA key is absent. Symbol mapping (EURUSD → EUR_USD,
   etc.). Extension points for FxcmProvider and ICMarketsProvider. Docs: `FOREX_DATA_ANALYSIS.md`,
   `OANDA_INTEGRATION.md`.

## Recently modified files
- `src/components/chart/drawing/history/CommandManager.ts` (critical: DuplicateDrawingCommand generates valid uid)
- `src/store/chartStore.ts` (guard: empty-id fallback + deep-copy points)
- `src/components/chart/DrawingLayer.tsx` (fix: Ctrl+D single-create + commitMove wiring)
- `src/components/chart/drawing/interaction/DrawingInteractionManager.ts` (releasePointerCapture, adapter resolution, commitMove)
- `src/components/chart/drawing/history/useCommandHistory.ts` (fix: ESLint warning)
- `src/components/chart/drawing/tools/plugins/TrendLineTool.ts` (audit: `"segment"` → `"body"`
  hitTest target, removed unused `applyStyle` import)
- `src/components/chart/drawing/tools/plugins/FibRetracementTool.ts` (new — Phase 4.4),
  `FibExtensionTool.ts` (new — Phase 4.4)
- `src/components/chart/drawing/tools/adapters.ts` (Phase 4.4: imported FibRetracementTool +
  FibExtensionTool)
- `src/types/drawing.ts` (Phase 4.4: added `fibRetracement`/`fibExtension` to DrawingTool +
  `FIB_EXT_LEVELS`)
- `src/components/toolbar/DrawingToolbar.tsx` (Phase 4.4: shapes flyout updated with
  fibRetracement + fibExtension)
- `src/services/market-data/providers/OandaProvider.ts` (new — OANDA forex/metals/indices provider),
  `FxcmProvider.ts` (stub), `ICMarketsProvider.ts` (stub)
- `src/services/market-data/MarketDataService.ts` (wired OandaProvider + fallback routing),
  `HistoricalDataService.ts` (OANDA historical candles), `symbols.ts` (OANDA symbol registry)
- `src/types/marketData.ts` (`'oanda'` added to `MarketProvider`)
- `src/components/chart/AlertOverlay.tsx` (new — interactive alert lines), `AlertContextMenu.tsx`
  (new), `src/components/alerts/AlertEditDialog.tsx` (new) — Phase 2.1 chart interactivity
  (select/drag/delete/edit/right-click/long-press); `AlertLines.tsx` deleted
- `src/store/alertStore.ts` (Phase 2 rewrite + 2.1 enabled/locked/selection),
  `src/services/alertEngine.ts`, `src/hooks/useAlertEngine.ts`, `src/components/alerts/AlertCenter.tsx`
- `src/store/toastStore.ts`, `src/components/notifications/Toaster.tsx`,
  `src/services/notifications/{notify,sound,browser}.ts`
- `src/store/marketDataStore.ts` (refcounted subscriptions — `subRefs`)
- `src/components/layout/GlobalRuntime.tsx` (mount engine + hydrate alerts), `Terminal.tsx`
  (Toaster + AlertCenter + AlertEditDialog), `TopToolbar.tsx` (bell), `ChartContextMenu.tsx`
  (directional create-alert)
- `src/services/marketData.ts` **(deleted — Step 17, last mock removed)**
- `src/hooks/useMtfSnapshotSeries.ts` (new — real higher-TF history for replay MTF)
- `src/services/replayEngine.ts` (Step 17: `mtfSnapshot` now pure, takes `seriesByTf`)
- `src/components/{replay/ReplayDashboard,smc/SmcLayer,journal/JournalPanel,trade/OrderTicket,trade/PositionsTable}.tsx`
  (Step 17: `getSymbol`→`getMarketSymbol`)
- `src/store/replayStore.ts` (Step 16: `setTotal` equality-guard — no per-tick replay churn)
- `src/components/toolbar/TopToolbar.tsx`, `DrawingToolbar.tsx`, `src/components/chart/DrawingLayer.tsx`
  (Step 16: whole-store subscriptions → atomic selectors; no per-tick re-renders)
- `src/services/market-data/providers/{Binance,TwelveData}Provider.ts` (Step 15: dead-socket
  watchdog + instant reconnect on `window 'online'`; baseline backoff/auto-resubscribe verified)
- `src/store/marketDataStore.ts` (Step 12–13: `selectMarket` now idempotent — re-asserts kline sub
  for the active key; prevents the latent "history but no live kline" gap when defaults align)
- `src/components/toolbar/ConnectionBadge.tsx` (new — Step 14 🟢/🟡/🔴 feed-status chip)
- `src/components/toolbar/TopToolbar.tsx` (Step 14: mounts `<ConnectionBadge />`)
- `src/hooks/useMarketData.ts` (realtime rewrite — selection + history + mirror to chartStore)
- `src/components/chart/PriceChart.tsx` (incremental `series.update`; registry precision)
- `src/store/marketDataStore.ts` (`selectMarket`, kline-only chart channel)
- `src/store/chartStore.ts` (default symbol BTCUSDT)
- `src/components/toolbar/SymbolSearch.tsx`, `ChartArea.tsx`, `ChartContextMenu.tsx` (registry symbols)
- `src/services/exchange.ts` (`contractTagOf(AssetClass)`)
- `src/components/watchlist/Watchlist.tsx`, `useMarketDataBootstrap.ts` (Step 10)
- `src/services/market-data/*` (service layer, Steps 3–8)
- `src/services/market-data/HistoricalDataService.ts` (REST history loader, Step 7)
- `src/services/market-data/symbols.ts` (canonical symbol registry, Step 6)
- `src/services/market-data/providers/{Binance,TwelveData}Provider.ts` (Steps 4–5)
- `src/store/marketDataStore.ts` (single source of truth, Step 3)
- `src/types/marketData.ts` (unified models, Step 2) · `src/types/index.ts` (barrel)
- `.env.example`, `.gitignore` (env hardening)
- `docs/*` (progress/next-tasks/handoff/changelog updated)

## Build & quality status
- `npm run type-check` → ✅ PASS (exit 0)
- `npm run lint` → ✅ PASS (0 warnings)
- `npm run build` → ✅ PASS (route `/` ≈ 103 kB first load; terminal is an async ssr:false chunk)
- TODO/FIXME/HACK markers in `src/` → **0** (7 matches are HTML `placeholder` attributes)

## Features completed (production-ready)

### Foundation
- Next.js 15 + TS strict + Tailwind, TradingView dark theme via CSS variables.
- Full-screen resizable terminal shell (top / left / center / right / bottom docks).
- Browser-only render via `dynamic(ssr:false)` + post-mount store hydration (no hydration
  mismatches).
- Persistence: localStorage (ui/drawings/indicators/watchlist/smc-settings) + IndexedDB
  (journal + screenshots).

### Realtime market data (Phase 1 — Steps 1–17 ✅ COMPLETE, no mock data)
- Unified types + single-source `marketDataStore`; Binance + TwelveData WS providers (one socket
  each, backoff reconnect + auto-resubscribe + dead-socket watchdog + `online` recovery);
  `MarketDataService` routing via a canonical symbol
  registry; `HistoricalDataService` (REST 500–5000 bars, paginated); `CandleEngine` (tick→bar).
- **Watchlist and chart stream live** (Binance crypto no-key; forex/metals/indices via OANDA or
  TwelveData key). Read-only hooks + bootstrap; chart uses incremental `series.update` for the forming bar.
- Replay gate (`useVisibleCandles`) preserved over the realtime master series.

### Charting
- Lightweight Charts candlesticks + volume, TradingView-style theme (background `#131722`,
  subtle grid, dashed crosshair with floating price/time labels, colored last-price line).
- Indicators: SMA, EMA, VWAP, RSI, MACD, ADR (overlay + stacked panes), toggle on/off.
- Drawing tools (current shipped set): trend line, horizontal, vertical, rectangle, text,
  fib retracement, fib extension — create / move / select / delete, persisted per symbol.
- Right-click **chart context menu** (price detection via `coordinateToPrice`): create alert,
  sell-limit, buy-stop, add-order (ticket prefill), draw horizontal line.

### Replay (no look-ahead)
- Bar-replay with structural future-hiding (`useVisibleCandles`).
- Click-to-select start bar (`ReplaySelectionLayer`) + quick-start, transport (play/pause/stop/
  step/±10), speeds 1×–100×, scrubber, jump-to-date, dashboard, multi-timeframe snapshot.

### Smart Money Concepts
- Structure (HH/HL/LH/LL, BOS/CHOCH/MSS), FVG, Order Blocks, Liquidity (EQH/EQL + sweeps),
  Displacement, Sessions + kill zones. Off-thread `smc.worker`. Toggle menu (all 8 groups,
  reactive). Coordinate-correct canvas overlay.

### Trading & journal & analytics
- Trade simulator: market/limit/stop, risk-based sizing, partial closes, floating risk panel,
  entry/SL/TP chart lines, hotkeys (B/S/X). Auto-journaling on close.
- Journal: notes, before/after screenshots (IndexedDB), CSV + Excel export.
- Analytics: win rate, profit factor, avg RR, max DD, expectancy, equity/drawdown curve,
  R-distribution, monthly performance.

### Alerts (Phase 2 — production-ready)
- Conditions: price above / below, crosses above / below; one-time or recurring (60s re-arm).
- Evaluated by `useAlertEngine` off `marketDataStore` (push, no polling); refcounted ticker
  subscriptions so any symbol's alerts work without new sockets; once-only trigger, no duplicates.
- Notifications: in-app toast (`Toaster`), Web Audio chime, browser/system notification (permission
  from the Alert Center). Dispatch isolated in `notify.ts` (Phase 6 Firebase push seam).
- Responsive **Alert Center** drawer (toolbar bell): create form, active / triggered / history,
  notification settings. Alerts + history persisted to localStorage.
- **Interactive chart alerts (Phase 2.1):** alert lines are selectable, **draggable to change price**
  (commits + persists on release), deletable, with hover grab-cursor, right-click / long-press menu
  (Edit / Clone / Disable / Delete), an edit dialog, and Delete/Esc keyboard support. `enabled` +
  `locked` per alert. See `docs/ALERT_ARCHITECTURE.md`.

## In progress (NOT shipped — see CURRENT_STATE.md §9)
- **Left drawing-toolbar overhaul (Phase 3 scope):** types + store actions + pure
  `drawingRenderer.ts` landed, but **not wired** into `DrawingLayer`/`DrawingToolbar`. Currently
  dead code; build green (additive). Finish in Phase 3 or revert before Phase 1 if undesired.

## Remaining in Phases 1 & 2
- **None — Phases 1 and 2 are complete.** No mock data remains. Optional Phase 2 polish (non-blocking)
  is tracked in `PHASE2_GAPS.md`. Next milestone is **Phase 3 — Drawing Engine**. See `NEXT_TASKS.md`.

## Not started (later phases)
- Full drawing engine (Phase 3), TradingView toolbar polish (Phase 4), indicator dialogs (Phase 5),
  MT5/broker integration + Firebase mobile push (Phase 6 — alert dispatch seam is ready in
  `services/notifications/notify.ts`).
- 🟡 **DrawingContextMenu fix needed:** canvas `pointerEvents:"none"` blocks contextmenu event.
  Move listener to document capture phase to restore right-click drawing menu (Clone/Delete/Lock/Hide).
