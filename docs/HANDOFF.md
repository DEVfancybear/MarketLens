# HANDOFF

_Engineer handoff for the SMC Trading Terminal. Last updated 2026-06-25._

You are taking over a **TradingView/FXReplay/TradeZella-style** web terminal for Smart Money
Concept backtesting. It is feature-rich and builds clean, but **all market data is mock** — the
immediate roadmap (Phase 1) replaces it with a realtime architecture.

Read in this order: `PROJECT_ARCHITECTURE.md` / `ARCHITECTURE.md` → `CURRENT_STATE.md` →
`NEXT_TASKS.md` → `KNOWN_ISSUES.md`.

## Repo state
- **Branch:** `master`
- **Remote:** `origin → https://github.com/DEVfancybear/tradingview.git`
- **Phase 1 progress:** Steps 1–9 ✅ · Step 10 (realtime Watchlist + `useMarketDataBootstrap`
  in `GlobalRuntime` + registry-backed `watchlistStore`) ✅. **Live sockets now open at runtime.**
- **Recommended next action:** Phase 1 **Step 11** — Chart integration (the big one). On
  symbol/timeframe select, subscribe `['ticker','kline']` and prime history via
  `HistoricalDataService` → `marketDataStore.setCandles`, then feed the store's candles to the
  chart, preferring `series.update(lastBar)` for the forming bar. **Keep the `useVisibleCandles`
  replay gate** (replay slices the realtime master series). Plan the `chartStore`↔`marketDataStore`
  split: chart selection (symbol/timeframe) + candles move to `marketDataStore`; `chartStore`
  keeps drawings/indicators/active tool. Retire the mock `useMarketData.ts` here (rename
  `useMarketDataFeed` → `useMarketData`). The watchlist click currently sets `chartStore.symbol`
  (still mock chart) — rewire to `marketDataStore.changeSymbol` in Step 11/12.
- **Runtime note:** running `npm run dev` now opens a Binance WS (crypto quotes live). TwelveData
  feeds need `NEXT_PUBLIC_TWELVEDATA_API_KEY` in `.env.local`.
- **Env:** TwelveData needs `NEXT_PUBLIC_TWELVEDATA_API_KEY` in `.env.local` (see `.env.example`);
  Binance needs no key. App still runs fully on mock data until Steps 10–13 wire the providers in.

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
- **9 Zustand stores** (see `ARCHITECTURE.md` §4). Market state currently lives in `chartStore`
  + React Query cache; **there is no `marketDataStore` yet**.
- Chart = Lightweight Charts + **canvas overlays** (SMC, drawings, replay picker, alerts) that
  project (time,price)→pixels and repaint on `ChartContext.version`.
- **`useVisibleCandles()` is the single visibility gate** — the no-look-ahead replay guarantee.
- Pure domain engines (indicators, SMC, trade, analytics) consume only the candle array → safe.

## 4. Realtime market data — current implementation
**There is none.** It is fully mocked:
- `services/marketData.ts` — deterministic mulberry32 seeded generator producing 1m OHLCV,
  aggregated to higher TFs. `fetchHistory` fakes 60ms latency; `fetchQuote` derives from daily
  candles. `SYMBOLS` is a hardcoded list of 10.
- `Watchlist` polls quotes every 15s via React Query, but values don't move (deterministic).
- No WebSocket, no connection status, no reconnect, no provider abstraction.
- **Phase 1** introduces: unified types, `marketDataStore`, Binance + TwelveData providers,
  `MarketDataService`, `HistoricalDataService`, `CandleEngine`, realtime hooks, connection
  status, reconnect, and removal of all mock data. Full plan in `NEXT_TASKS.md`.

## 5. TradingView features already completed
- ✅ Candles + volume, TradingView dark theme, crosshair w/ floating labels, last-price line.
- ✅ Indicators: SMA/EMA/VWAP/RSI/MACD/ADR (toggleable).
- ✅ Drawings: trend/horizontal/vertical/rectangle/text/fib (create/move/delete, persisted).
- ✅ Right-click chart context menu (alert / sell-limit / buy-stop / add-order / hline).
- ✅ Bar Replay with click-to-select start, transport, speeds, scrubber, jump-to-date, MTF.
- ✅ SMC suite (structure, FVG, OB, liquidity, displacement, sessions/kill-zones) off-thread.
- ✅ Trade simulator + risk panel + journal (screenshots, CSV/Excel) + analytics dashboard.
- ✅ Watchlist (add/remove/sort), symbol search, timeframe switching, theme toggle, fullscreen,
  screenshot export, resizable panels.

## 6. Remaining / missing features
- ❌ **Realtime data** (Phase 1) — the whole point of the current roadmap.
- 🟡 **Left drawing toolbar overhaul** — partially landed and **unwired** (see §8 Known Issues
  and `CURRENT_STATE.md` §9). Belongs to Phase 3.
- ❌ Alert **triggering**/notifications (Phase 2) — only alert lines render today.
- ❌ Indicator settings dialogs (Phase 5).
- ❌ Real broker/MT5 order routing + mobile notifications (Phase 6).

## 7. Where to start Phase 1
1. `NEXT_TASKS.md` Step 2 → create `src/types/marketData.ts` (unified models).
2. Step 3 → `src/stores/marketDataStore.ts`; decide the `chartStore` split (move
   symbol/timeframe/candles out; keep drawings/indicators/tool in `chartStore`).
3. Build `BinanceProvider` first (no API key needed) to prove the socket/normalize/reconnect
   path end-to-end, then wire `useMarketData`/`PriceChart` to `series.update(lastBar)`.

## 8. Known issues / gotchas
- **`framer-motion` is broken** in this install (`motion-dom` export mismatch). It is **not
  imported** anywhere (the context menu uses a CSS pop animation). If you need motion later,
  pin a matching `framer-motion`/`motion-dom` pair; otherwise consider removing it from
  `package.json`.
- **Unwired drawing refactor:** `components/chart/drawing/drawingRenderer.ts` and the new
  `chartStore` drawing actions / extended `types/drawing.ts` are **not used yet**. Either finish
  in Phase 3 or revert before Phase 1 to avoid confusion.
- **Mock history is also used by replay/SMC** (`replayEngine.mtfSnapshot`, `smcEngine`) — when
  removing mock data, repoint these to the new `HistoricalDataService`.
- **No git in this environment** (`git` not installed; not a repo). The commit/push workflow in
  the task spec cannot run here — run it from a machine with git + remote configured.
- **Secrets:** keyed providers (TwelveData) must read from `.env.local` (gitignored). Never
  commit keys/tokens.

## 9. Useful entry points (files)
- Data: `services/marketData.ts`, `hooks/useMarketData.ts`, `store/chartStore.ts`.
- Chart: `components/chart/PriceChart.tsx`, `ChartContext.tsx`, `ChartArea.tsx`.
- Visibility gate: `hooks/useVisibleCandles.ts`.
- Watchlist: `components/watchlist/Watchlist.tsx`, `store/watchlistStore.ts`.
- Runtime loops: `components/layout/GlobalRuntime.tsx`.
