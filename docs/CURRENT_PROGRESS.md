# CURRENT PROGRESS

_Last updated: 2026-06-25_

## Current phase / milestone
- **✅ Phase 1 — Realtime Market Data Foundation — COMPLETE (Steps 1–17).** Switch hardening,
  connection badge, reconnect hardening, perf pass, and **the last mock removed**. Chart + watchlist
  stream live (Binance crypto, no key needed); replay MTF reads real higher-TF history. **Next
  milestone: Phase 2 — Alert Engine.**

## Recently modified files
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
- **Watchlist and chart stream live** (Binance crypto no-key; forex/metals/indices via TwelveData
  key). Read-only hooks + bootstrap; chart uses incremental `series.update` for the forming bar.
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

## In progress (NOT shipped — see CURRENT_STATE.md §9)
- **Left drawing-toolbar overhaul (Phase 3 scope):** types + store actions + pure
  `drawingRenderer.ts` landed, but **not wired** into `DrawingLayer`/`DrawingToolbar`. Currently
  dead code; build green (additive). Finish in Phase 3 or revert before Phase 1 if undesired.

## Remaining in Phase 1
- **None — Phase 1 is complete (Steps 1–17).** No mock data remains in the app. Next milestone is
  Phase 2 (Alert Engine). See `NEXT_TASKS.md`.

## Not started (later phases)
- Alert triggering (Phase 2), full drawing engine (Phase 3), indicator dialogs (Phase 5),
  MT5/broker integration + notifications (Phase 6).
