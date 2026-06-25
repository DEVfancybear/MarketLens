# NEXT TASKS

## Current status

- **✅ Phase 1 — Realtime Market Data Foundation: COMPLETE (Steps 1–17).**
- **✅ Phase 2 — Alert Engine: COMPLETE** (engine + notifications + Alert Center + audit + Phase 2.1
  interactive chart alerts).
- **▶ Phase 3 — Drawing Engine: NEXT (current focus).**

## Immediate tasks — Phase 3 (Drawing Engine)

The drawing refactor is **partially landed but unwired** (additive dead code; build green). Finish it:

1. **Wire the renderer** — use `components/chart/drawing/drawingRenderer.ts` (+ extended
   `types/drawing.ts` with `zIndex/locked/visible/stop/target`) inside `DrawingLayer` instead of the
   inline `renderDrawing`.
2. **Wire the new `chartStore` drawing actions** — `duplicateDrawing / lockDrawing / hideDrawing /
   bringToFront / sendToBack / toggleLockAll / toggleHideAll`.
3. **Expand `DrawingToolbar`** to the full TradingView tool set (~17 tools).
4. **Add a `DrawingContextMenu`** (right-click a drawing: edit/clone/lock/hide/delete/z-order) and a
   shared **hit-test** module + drawing **hotkeys**. The interactive `AlertOverlay` (Phase 2.1) is a
   good reference pattern for canvas selection/drag/right-click/touch.
5. Keep everything **persisted per symbol** (localStorage `drawings:<symbol>`), as today.

Optional Phase 2 polish (non-blocking, from `PHASE2_GAPS.md`): clear stale `prevPrice` on unsubscribe
(G2), evaluate on alert-create for instant level alerts (G3), de-double-gate notifications (G1
remainder), Alert Center backdrop should not block chart on desktop (G6).

---

## Phase 1 — Realtime Market Data Foundation (✅ COMPLETE — record)

Step record:

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
| 12 ✅ | Symbol switching | `selectMarket` hardened (DONE) | Switches via chartStore.setSymbol → useMarketData → selectMarket (unsub old kline, sub new, load history). Verified: Binance `UNSUBSCRIBE` is sent on switch (no socket leak); engine reset; rapid-switch race covered by the `cancelled` guard. **Hardened:** `selectMarket` is now idempotent — re-asserts the kline sub for the active key even when symbol+TF are unchanged, so initial mount can never be left with history but no live kline (`subscribe()` dedupes). |
| 13 ✅ | Timeframe switching | `selectMarket` hardened (DONE) | Switches via chartStore.setTimeframe → selectMarket. Verified history reloads at new TF + realtime resumes; chart pan/zoom intentionally re-fits on TF change (acceptable). Same idempotent `selectMarket` path as Step 12. |
| 14 ✅ | Connection status | `ConnectionBadge.tsx` + `TopToolbar` (DONE) | 🟢/🟡/🔴 dot + label from `useConnectionMeta()` (over `marketDataStore.connectionStatus`), pulsing while connecting/reconnecting; label hides below `md`. |
| 15 ✅ | Reconnect | inside providers (DONE) | Backoff `1→2→5→10→30s` (holds at 30s), infinite, auto-resubscribe on `onopen`; `manualClose` suppresses reconnect on intentional disconnect. **Hardened:** dead-socket watchdog (recycle an OPEN-but-silent socket after 45s) + instant reconnect on `window 'online'`. Both SSR-guarded. |
| 16 ✅ | Performance | atomic selectors on hot paths (DONE) | Removed per-tick re-renders from non-candle consumers: `replayStore.setTotal` equality-guarded; `TopToolbar`/`DrawingToolbar`/`DrawingLayer` converted from whole-store subscriptions to atomic per-field selectors. Already had: memoized watchlist rows + per-row `useQuote` (Step 10), O(1) `series.update` (Step 11), candle cap `MAX_CANDLES = 5000`. |
| 17 ✅ | Remove mock data | **deleted** `services/marketData.ts` (DONE) | `mtfSnapshot` made pure + fed by new `useMtfSnapshotSeries` (real `HistoricalDataService`); `getSymbol`→`getMarketSymbol` in 5 components. No mock data remains anywhere in the app. |

### Phase 1 success criteria
Realtime watchlist + chart, historical + realtime candles, symbol/timeframe switching,
reconnect, single market-data store, **no mock data**, no duplicate sockets.

### Cross-cutting cautions for Phase 1
- Keep the **`useVisibleCandles()` replay gate** as the single visibility source — realtime
  must update the master series, and replay continues to slice it.
- `tradeStore` consumes the latest visible candle (`useTradeRuntime`) — live ticks already flow
  through `chartStore.candles`, so pending orders/SL/TP fill in realtime.
- SMC now runs on the realtime `chartStore.candles` (via `useVisibleCandles`). The replay MTF panel
  (`replayEngine.mtfSnapshot` + `useMtfSnapshotSeries`) now reads real higher-TF history from
  `HistoricalDataService`. **No mock data remains.**
- **Secrets:** TwelveData/any keyed provider → `.env.local` (gitignored), never hardcode.

---

## Later phases (roadmap, not started)

- **Phase 2 — Alert Engine:** ✅ **COMPLETE** (incl. audit + Phase 2.1 interactive chart alerts:
  select / drag-to-reprice / delete / edit dialog / right-click + long-press menu / keyboard;
  `enabled`+`locked`). `alertStore`, pure `alertEngine`, `useAlertEngine` (off `marketDataStore`,
  refcounted subs, once-only), toast + browser + sound, responsive Alert Center, persistence. See
  `docs/ALERT_ARCHITECTURE.md`, `PHASE2_REVIEW.md`, `PHASE2_GAPS.md`. Optional polish items in
  `PHASE2_GAPS.md` (e.g. once-per-bar-close firing, indicator/drawing alerts, webhook delivery).
- **Phase 3 — Drawing Engine (NEXT — see "Immediate tasks" above):** finish the unwired toolbar
  overhaul. See also `CURRENT_STATE.md` §9.
- **Phase 4 — TradingView Toolbar:** full left toolbar polish + tool settings.
- **Phase 5 — Indicator Engine:** indicator settings dialogs, more indicators, per-indicator
  params persistence.
- **Phase 6 — MT5 Integration:** real order routing (replace `tradeStore` sim with broker
  bridge), position tracking, mobile notifications.
