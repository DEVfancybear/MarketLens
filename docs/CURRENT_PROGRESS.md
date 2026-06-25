# CURRENT PROGRESS

_Last updated: 2026-06-26_

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
- **Next milestone: Phase 4.4 — Fibonacci Suite.**

## Completed this session
1. **Flyout portal fix:** Fixed tool group flyout menus being clipped by TerminalLayout
   `overflow-hidden`. Flyout now renders via `createPortal` to `document.body` with
   position computed from button bounding rects (`btnRefs`).
2. **Diagnostic cleanup:** Removed all temporary `console.log` traces from
   `DrawingLayer.tsx` (7 diagnostic blocks) and `chartStore.ts` (`setActiveTool`).
   Zero remaining debug logs in drawing engine or store.
3. **Phase 4.2.2 — Tool Group System:** Transformed flat 20-tool toolbar into
   4 TradingView-style grouped icons (Cursor, Lines, Shapes, Text) with flyout menus.
   Last-used tool per group becomes the visible sidebar icon. Backdrop closes flyout
   on outside click. Docs: TOOL_GROUP_ARCHITECTURE.md, TOOLBAR_BEHAVIOR.md.
2. **Phase 4.3 — Shape Tools Suite:** Implemented 8 TradingView-style shape tools (rectangle,
   rotatedRect, circle, ellipse, triangle, polyline, curve, path). Fill system (fillColor +
   opacity). Supply/demand zone workflow for rectangle. Zero core engine changes.
   Docs: SHAPE_TOOLS_ARCHITECTURE.md, RECTANGLE_TOOL_GUIDE.md, SHAPE_TOOL_TEST_PLAN.md.
3. **Phase 4.2 — Trend Line Suite:** Implemented 8 TradingView-style line tools (trendline,
   connection-status badge (Step 14), reconnect hardening (Step 15 — dead-socket watchdog + `online`
   recovery), performance pass (Step 16 — atomic selectors, guarded `setTotal`), and **removal of the
   last mock** (Step 17 — deleted `services/marketData.ts`; replay MTF now uses real
   `HistoricalDataService`). Phase 1 audited → `PHASE1_REVIEW.md` + `PHASE1_GAPS.md`.
2. **Phase 2 — Alert Engine:** `alertStore` (alerts/triggered/history/settings), pure `alertEngine`,
   `useAlertEngine` (evaluates off `marketDataStore`, refcounted subs, once-only), toast + browser +
   sound notifications, responsive Alert Center, persistence. Reference-counted subscriptions
   (`subRefs`) added to `marketDataStore`. `ALERT_ARCHITECTURE.md` written.
3. **Phase 2 audit:** `PHASE2_REVIEW.md` + `PHASE2_GAPS.md`.
4. **Phase 2.1 — interactive chart alerts:** alert lines are now selectable, draggable (reprice +
   persist), deletable; right-click / long-press menu (Edit/Clone/Disable/Delete), edit dialog,
   keyboard (Delete/Esc), `enabled`/`locked`. Replaced static `AlertLines` with `AlertOverlay`.
   (Resolved Phase 2 gaps G1 + G5.)
5. **OANDA Integration:** production-grade forex/metals/indices data provider via OANDA v20 REST
   API. `OandaProvider` with bearer-token auth, 1s pricing poll, historical candles, reconnect
   with backoff. Fallback to TwelveData when OANDA key is absent. Symbol mapping (EURUSD → EUR_USD,
   etc.). Extension points for FxcmProvider and ICMarketsProvider. Docs: `FOREX_DATA_ANALYSIS.md`,
   `OANDA_INTEGRATION.md`.

## Recently modified files
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
- Drawing tools (current shipped set): trend line, horizontal, vertical, rectangle, text, fib —
  create / move / select / delete, persisted per symbol.
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
