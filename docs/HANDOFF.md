# HANDOFF

_Engineer handoff for the SMC Trading Terminal. Last updated 2026-06-25._

You are taking over a **TradingView/FXReplay/TradeZella-style** web terminal for Smart Money
Concept backtesting. It is feature-rich and builds clean. **Phase 1 (realtime market data) is in
progress and mostly done: the watchlist and chart now stream live** (Binance crypto with no API
key; forex/metals/indices via TwelveData with a key). A small amount of mock remains only behind
the replay multi-timeframe snapshot (removed in Step 17).

Read in this order: `PROJECT_ARCHITECTURE.md` / `ARCHITECTURE.md` → `CURRENT_STATE.md` →
`NEXT_TASKS.md` → `KNOWN_ISSUES.md`.

## Repo state
- **Branch:** `master`
- **Remote:** `origin → https://github.com/DEVfancybear/tradingview.git`
- **Phase 1 progress:** Steps 1–11 ✅ · **Steps 12–13 (switch hardening) ✅** · **Step 14
  (connection badge) ✅**. **The chart now streams live** (history via REST + realtime klines).
  Reconciliation chosen: `chartStore` stays the chart's selection + candle source
  (drawings/indicators/tool too); `useMarketData` bridges it to `marketDataStore` (select → history
  → mirror candles). `useVisibleCandles` replay gate intact. `selectMarket()` is now idempotent so
  the active kline is always (re)asserted on the active key.
- **Recommended next action:** Phase 1 **Step 16** — performance pass (atomic Zustand selectors,
  `React.memo`/`useMemo` on hot paths; target 100+ symbols, 5000+ candles). Then **Step 17** —
  remove the last mock: repoint `replayEngine.mtfSnapshot` to `HistoricalDataService` and delete
  `services/marketData.ts`. (Step 15 reconnect already lives in the providers.)
- **Runtime:** `npm run dev` → BTCUSDT chart + watchlist stream live from Binance (no key).
  TwelveData (forex/metals/indices) need `NEXT_PUBLIC_TWELVEDATA_API_KEY` in `.env.local`
  (see `.env.example`).
- **Mock status:** the chart (`useMarketData.ts`) and watchlist are now realtime. The mock
  generator `services/marketData.ts` remains only behind replay's multi-timeframe snapshot
  (`replayEngine.mtfSnapshot`) — to remove in Step 17.

---

## 1. Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run type-check   # tsc --noEmit
npm run lint         # next lint
```
- Node 18+ (built/verified on Node 24, npm 11, Windows). Next 15.3.9, React 19.
- **Windows build note:** Next's page-data worker occasionally fails with
  `Cannot find module './<chunk>.js'` / `/_not-found` during "Collecting page data". This is a
  known Next-on-Windows race (the project sits under `Downloads`, which AV/sync tools watch),
  **not** a code error — re-run `npm run build` once (warm chunks) and it passes.

## 2. Current status (verified 2026-06-25)
- type-check ✅ · lint ✅ (0 warnings) · build ✅ · no TODO/FIXME markers.

## 3. Existing architecture (1-minute version)
- Browser-only Next app; the whole terminal is a `dynamic(ssr:false)` client chunk.
- **10 Zustand stores** (`ui, chart, replay, smc, trade, journal, analytics, watchlist, alert,
  marketData`). The realtime feed has its own single-source-of-truth `marketDataStore`; the
  chart's selection + candle series live in `chartStore` and are bridged from `marketDataStore`
  by `useMarketData`.
- Chart = Lightweight Charts + **canvas overlays** (SMC, drawings, replay picker, alerts) that
  project (time,price)→pixels and repaint on `ChartContext.version`.
- **`useVisibleCandles()` is the single visibility gate** — the no-look-ahead replay guarantee;
  it slices `chartStore.candles`, which is now the realtime master series.
- Pure domain engines (indicators, SMC, trade, analytics) consume only the candle array → safe.

## 4. Realtime market data — current implementation (Phase 1, Steps 1–14 done)
Live pipeline: `provider → MarketDataService → marketDataStore → hooks → UI`.
- **Types** `src/types/marketData.ts` (unified `MarketQuote/MarketCandle/MarketSymbol/
  ConnectionStatus/Timeframe` + events/consts).
- **Store** `src/store/marketDataStore.ts` — quotes/candles/selection/status/subscriptions;
  `updateCandle` does the TradingView-style forming-bar upsert; `selectMarket()` (chart) and
  `subscribe/unsubscribe` (watchlist).
- **Providers** `services/market-data/providers/` — `BinanceProvider` (one combined WS, kline +
  ticker + miniTicker, backoff reconnect + auto-resubscribe) and `TwelveDataProvider` (price WS,
  forex/metals/indices). Both implement `MarketDataServiceBinding`.
- **Orchestration** `MarketDataService.ts` (routes via `symbols.ts` registry, fans events into
  the store, aggregates status; `getMarketDataService()` attaches) + `HistoricalDataService.ts`
  (REST 500–5000 bars, paginated) + `CandleEngine.ts` (builds candles from tick-only feeds).
- **Hooks** `useCandles/useQuote/useConnectionStatus/useMarketDataFeed` (read-only) +
  `useMarketDataBootstrap` (subscribes watchlist tickers, mounted in `GlobalRuntime`) +
  `useMarketData` (chart: select → history → mirror candles into `chartStore`).
- **Connection badge** `components/toolbar/ConnectionBadge.tsx` (Step 14) — 🟢/🟡/🔴 chip in the
  `TopToolbar` right group via `useConnectionMeta()`.
- **Remaining Phase 1:** Step 16 (perf), 17 (remove the last mock). Steps 12–14 done; 15 (reconnect)
  lives in the providers. Full plan in `NEXT_TASKS.md`.
- **Still mock:** only `services/marketData.ts` behind `replayEngine.mtfSnapshot` (Step 17).

## 5. TradingView features already completed
- ✅ **Realtime candles + watchlist** (Binance crypto no-key; TwelveData forex/metals/indices),
  TradingView dark theme, crosshair w/ floating labels, last-price line, incremental
  `series.update` for the forming bar.
- ✅ Indicators: SMA/EMA/VWAP/RSI/MACD/ADR (toggleable).
- ✅ Drawings: trend/horizontal/vertical/rectangle/text/fib (create/move/delete, persisted).
- ✅ Right-click chart context menu (alert / sell-limit / buy-stop / add-order / hline).
- ✅ Bar Replay with click-to-select start, transport, speeds, scrubber, jump-to-date, MTF.
- ✅ SMC suite (structure, FVG, OB, liquidity, displacement, sessions/kill-zones) off-thread.
- ✅ Trade simulator + risk panel + journal (screenshots, CSV/Excel) + analytics dashboard.
- ✅ Watchlist (add/remove/sort, realtime), symbol search (registry), timeframe switching, theme
  toggle, fullscreen, screenshot export, resizable panels.

## 6. Remaining / missing features
- 🟡 **Phase 1 finish** — Steps 16–17 (perf pass, remove last mock). Switch hardening + status
  badge (12–14) done.
- 🟡 **Left drawing toolbar overhaul** — partially landed and **unwired** (see §8 Known Issues
  and `CURRENT_STATE.md` §9). Belongs to Phase 3.
- ❌ Alert **triggering**/notifications (Phase 2) — only alert lines render today.
- ❌ Indicator settings dialogs (Phase 5).
- ❌ Real broker/MT5 order routing + mobile notifications (Phase 6).

## 7. Where to continue Phase 1
1. **Step 16** — performance pass: prefer atomic Zustand selectors, `React.memo`/`useMemo`/
   `useCallback` on hot paths (watchlist rows, chart mirror). Target 100+ symbols, 5000+ candles
   without jank. The candle series is already bounded to `MAX_CANDLES = 5000` in `marketDataStore`.
2. **Step 17** — remove the last mock (`services/marketData.ts`): repoint
   `replayEngine.mtfSnapshot` to `HistoricalDataService`, then delete the mock generator.
3. Manual smoke test still worth doing: BTCUSDT ↔ ETHUSDT and 1m ↔ 1H switches — confirm the badge
   stays 🟢, the forming bar ticks, and no duplicate streams accumulate.

## 8. Known issues / gotchas
- **`framer-motion` is broken** in this install (`motion-dom` export mismatch). It is **not
  imported** anywhere (the context menu uses a CSS pop animation). If you need motion later,
  pin a matching `framer-motion`/`motion-dom` pair; otherwise consider removing it from
  `package.json`.
- **Unwired drawing refactor:** `components/chart/drawing/drawingRenderer.ts` and the new
  `chartStore` drawing actions / extended `types/drawing.ts` are **not used yet**. Either finish
  in Phase 3 or revert before Phase 1 to avoid confusion.
- **Mock history still feeds replay MTF** (`replayEngine.mtfSnapshot`) — repoint to
  `HistoricalDataService` in Step 17, then delete `services/marketData.ts`.
- **Git on Windows:** `git` is installed but not on PATH — invoke it by full path
  `C:\Program Files\Git\cmd\git.exe`. Repo `origin → github.com/DEVfancybear/tradingview` on
  branch `master`. `.claude/settings.local.json` is gitignored (machine-local).
- **Secrets:** keyed providers (TwelveData) must read from `.env.local` (gitignored). Never
  commit keys/tokens. (`.env`, `.env*.local` are gitignored; `.env.example` is the template.)

## 9. Useful entry points (files)
- Realtime feed: `services/market-data/{MarketDataService,HistoricalDataService,CandleEngine,
  symbols}.ts`, `services/market-data/providers/*`, `store/marketDataStore.ts`.
- Chart bridge / data: `hooks/useMarketData.ts` (chart), `hooks/useMarketDataBootstrap.ts`
  (watchlist feed), `hooks/{useCandles,useQuote,useConnectionStatus}.ts`, `store/chartStore.ts`.
- Chart: `components/chart/PriceChart.tsx`, `ChartContext.tsx`, `ChartArea.tsx`.
- Visibility gate: `hooks/useVisibleCandles.ts`.
- Watchlist: `components/watchlist/Watchlist.tsx`, `store/watchlistStore.ts`.
- Runtime loops: `components/layout/GlobalRuntime.tsx`.
- Legacy mock (Step 17 removal): `services/marketData.ts`.
