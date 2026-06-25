# NEXT TASKS

## Phase 1 — Realtime Market Data Foundation (current phase)

Steps 1–11 are **complete** (service layer + hooks + realtime watchlist + **realtime chart**).
The chart now streams live (Binance crypto needs no key). **Immediate next: Step 12 (symbol
switching hardening) + Step 13 (timeframe switching).** Remaining steps:

| Step | Task | Create / Touch | Notes |
|---|---|---|---|
| 2 ✅ | Market data types | `src/types/marketData.ts` (DONE) | `MarketQuote, MarketCandle, MarketSymbol, ConnectionStatus, Timeframe` + supporting types/consts. `Timeframe` single-sourced from `types/market.ts` (re-exported). Barrel updated. |
| 3 ✅ | Market data store | `src/store/marketDataStore.ts` (DONE; note: `store/` not `stores/`) | Single source of truth with all required state + actions + a `MarketDataServiceBinding` seam (`attachMarketDataService`). Standalone; chart/`chartStore` reconciliation happens in Steps 10–13. |
| 4 ✅ | Binance provider | `src/services/market-data/providers/BinanceProvider.ts` (DONE) | Single combined WS, dynamic SUBSCRIBE/UNSUBSCRIBE for ticker/miniTicker/kline, normalize → unified events, backoff reconnect + auto-resubscribe, implements `MarketDataServiceBinding`. |
| 5 ✅ | TwelveData provider | `src/services/market-data/providers/TwelveDataProvider.ts` (DONE) | Price-only WS for forex/metals/indices; unified `quote` events; backoff reconnect; `symbolMap`; key from `NEXT_PUBLIC_TWELVEDATA_API_KEY`. `.env.example` added, `.gitignore` hardened. |
| 6 ✅ | Market data service | `src/services/market-data/MarketDataService.ts` (+ `symbols.ts`) (DONE) | Owns both providers, routes via the symbol registry, fans events into the store, aggregates status, `getMarketDataService()` attaches it. |
| 7 ✅ | Historical service | `src/services/market-data/HistoricalDataService.ts` (DONE) | REST 500–5000 bars, Binance `endTime` pagination + TwelveData `time_series` (`order=ASC`), normalized `MarketCandle[]`, `before` cursor, dedupe/sort, key-guarded. `getHistoricalDataService()`. |
| 8 ✅ | Candle engine | `src/services/market-data/CandleEngine.ts` (DONE; wired into MarketDataService) | Tick→bar bucketing via `TF_SECONDS`, closed-bar emission, `seedHistory`, kline pass-through. TwelveData ticks now produce candles in the store. |
| 9 ✅ | Hooks | `useCandles.ts`, `useQuote.ts`, `useConnectionStatus.ts`, `useMarketDataFeed.ts` (DONE) | Read-only store selectors; no sockets. Mock `useMarketData.ts` left untouched (Step 11 retires it). |
| 10 ✅ | Watchlist integration | `Watchlist.tsx` + `useMarketDataBootstrap` (`GlobalRuntime`) + `watchlistStore` (DONE) | Realtime per-row `useQuote`, registry symbols, memoized rows, minimal rerenders, bootstrap subscribes tickers. |
| 11 ✅ | Chart integration | `useMarketData.ts` (realtime rewrite), `PriceChart.tsx`, `marketDataStore`, `chartStore`, `SymbolSearch` (DONE) | Realtime chart: select → kline sub + history → mirror store candles into `chartStore.candles`; `series.update` fast path; replay gate kept; chart/watchlist streams disjoint. |
| 12 ⬅ | Symbol switching | verify/harden `selectMarket` + `useMarketData` | Already works via chartStore.setSymbol → useMarketData (selectMarket unsub old kline, sub new, load history). **Verify no leaks** (old kline UNSUBSCRIBE sent; engine reset) and rapid-switch race (history of an abandoned symbol must not overwrite — `cancelled` guard already in place). |
| 13 ⬅ | Timeframe switching | verify/harden | Works via chartStore.setTimeframe → selectMarket. Verify history reloads at new TF + realtime resumes; chart pan/zoom intentionally re-fits on TF change (acceptable). |
| 14 | Connection status | `TopToolbar` (new badge) | 🟢/🟡/🔴 from `marketDataStore.connectionStatus`. |
| 15 | Reconnect | inside provider | backoff 1s→2s→5s→10s→30s, infinite, auto-resubscribe. |
| 16 | Performance | selectors, `React.memo`, `useMemo/useCallback` | 100+ symbols, 5000+ candles; prefer atomic Zustand selectors. |
| 17 | Remove mock data | delete/replace `services/marketData.ts` mock paths | Update all callers: `useMarketData`, `Watchlist`, `replayEngine.mtfSnapshot`, `tradeStore` price feed, `SmcLayer`/`smcEngine` history. |

### Phase 1 success criteria
Realtime watchlist + chart, historical + realtime candles, symbol/timeframe switching,
reconnect, single market-data store, **no mock data**, no duplicate sockets.

### Cross-cutting cautions for Phase 1
- Keep the **`useVisibleCandles()` replay gate** as the single visibility source — realtime
  must update the master series, and replay continues to slice it.
- `tradeStore` consumes the latest visible candle (`useTradeRuntime`) — ensure live ticks flow
  through the same path so pending orders/SL/TP still fill.
- `replayEngine.mtfSnapshot` and `smcEngine` currently pull mock higher-TF history; repoint to
  `HistoricalDataService`.
- **Secrets:** TwelveData/any keyed provider → `.env.local` (gitignored), never hardcode.

---

## Later phases (roadmap, not started)

- **Phase 2 — Alert Engine:** promote `alertStore` to triggered alerts (price cross detection
  in `CandleEngine`), notifications. (`AlertLines` already renders alert price lines.)
- **Phase 3 — Drawing Engine:** finish the in-progress toolbar overhaul (wire
  `drawingRenderer.ts` into `DrawingLayer`, expand `DrawingToolbar` to 17 tools, add
  `DrawingContextMenu`, hit-test module, drawing hotkeys). See `CURRENT_STATE.md` §9.
- **Phase 4 — TradingView Toolbar:** full left toolbar polish + tool settings.
- **Phase 5 — Indicator Engine:** indicator settings dialogs, more indicators, per-indicator
  params persistence.
- **Phase 6 — MT5 Integration:** real order routing (replace `tradeStore` sim with broker
  bridge), position tracking, mobile notifications.
