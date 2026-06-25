# NEXT TASKS

## Phase 1 — Realtime Market Data Foundation (current phase)

Steps 1–2 are **complete**. Step 1 = codebase analysis (`CURRENT_STATE.md`); Step 2 = unified
types (`src/types/marketData.ts`). **Immediate next: Step 3.** Remaining steps mapped to
concrete files/integration seams in this repo:

| Step | Task | Create / Touch | Notes |
|---|---|---|---|
| 2 ✅ | Market data types | `src/types/marketData.ts` (DONE) | `MarketQuote, MarketCandle, MarketSymbol, ConnectionStatus, Timeframe` + supporting types/consts. `Timeframe` single-sourced from `types/market.ts` (re-exported). Barrel updated. |
| 3 ⬅ | Market data store | `src/stores/marketDataStore.ts` | Single source of truth: `quotes, candles, selectedSymbol, selectedTimeframe, connectionStatus, subscriptions, lastUpdate` + actions. **Reconcile with existing `chartStore`** (move symbol/timeframe/candles here; keep `chartStore` for drawings/indicators/tool). Consume the Step-2 types. |
| 4 | Binance provider | `src/services/market-data/providers/BinanceProvider.ts` | ONE combined WS (`/stream?streams=`), ticker + kline + miniTicker, normalize → unified types, auto-reconnect. Never one socket per symbol. |
| 5 | TwelveData provider | `src/services/market-data/providers/TwelveDataProvider.ts` | Forex/metals/indices. Needs API key handling (env, **never commit**). |
| 6 | Market data service | `src/services/market-data/MarketDataService.ts` | Provider routing + subscription manager + reconnect. No UI. Replaces `marketData.ts` as the data entry point. |
| 7 | Historical service | `src/services/market-data/HistoricalDataService.ts` | REST history (500–5000 bars) before WS starts; pagination. Replaces `fetchHistory`. |
| 8 | Candle engine | `src/services/market-data/CandleEngine.ts` | Merge history + live ticks; update O/H/L/C/V of the forming bar; emit closed bars. |
| 9 | Hooks | `src/hooks/useMarketData.ts` (rewrite), `useCandles.ts`, `useQuote.ts` | Read from `marketDataStore` only; **must not** open sockets. |
| 10 | Watchlist integration | `components/watchlist/Watchlist.tsx` | Replace `useQueries(['quote'])` with `useQuote` selectors; memoized rows; minimal rerenders. |
| 11 | Chart integration | `components/chart/PriceChart.tsx`, `ChartArea.tsx` | History on load, then **`series.update(lastBar)`** for ticks (don't `setData` every tick). Keep `useVisibleCandles` replay gate intact. |
| 12 | Symbol switching | store action `changeSymbol()` | unsubscribe old → subscribe new → load history → resume realtime. No leaks. |
| 13 | Timeframe switching | store action `changeTimeframe()` | load new history, resume realtime, preserve chart state. |
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
