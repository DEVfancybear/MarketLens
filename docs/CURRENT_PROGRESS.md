# CURRENT PROGRESS

_Last updated: 2026-06-25_

## Current phase / milestone
- **Phase 1 — Realtime Market Data Foundation.** Steps 1–8 ✅ (service layer) · **Step 9
  (read-only hooks) ✅** · **Next: Step 10 (Watchlist integration — first real UI swap).**

## Recently modified files
- `src/hooks/{useCandles,useQuote,useConnectionStatus,useMarketDataFeed}.ts` (new — store readers)
- `src/services/market-data/CandleEngine.ts` (tick→bar merge, Step 8)
- `src/services/market-data/MarketDataService.ts` (wired to CandleEngine for tick providers)
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

## Not started
- **Realtime market data (Phase 1)** — see `NEXT_TASKS.md`. Everything is currently mock.
- Alert triggering (Phase 2), full drawing engine (Phase 3), indicator dialogs (Phase 5),
  MT5/broker integration + notifications (Phase 6).
