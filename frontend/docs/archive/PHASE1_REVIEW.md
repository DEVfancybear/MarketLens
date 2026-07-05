# PHASE 1 REVIEW — Realtime Market Data Foundation

_Audit date: 2026-06-25 · Branch `master` · Verified at commit `d3c8d55` (Step 17)._

This is a post-implementation audit of Phase 1 (Steps 1–17) against its stated success
criteria. Conducted before starting Phase 2.

## 1. Verdict

**Phase 1 is complete and meets every success criterion.** Build, type-check, and lint are
green; there is no mock data anywhere in the application; the realtime pipeline is a single
source of truth with one socket per provider.

## 2. Success criteria — verification

| Criterion | Status | Evidence |
|---|---|---|
| **Realtime watchlist** | ✅ | `Watchlist.tsx` rows each read `useQuote(ticker)` from `marketDataStore`; `useMarketDataBootstrap` subscribes watchlist tickers on the shared socket. |
| **Realtime chart** | ✅ | `useMarketData` selects the kline stream + loads REST history, mirrors `marketDataStore` candles into `chartStore.candles`; `PriceChart` uses incremental `series.update` for the forming bar. |
| **Historical candles** | ✅ | `HistoricalDataService.loadHistory` (Binance REST w/ `endTime` pagination; TwelveData `time_series`), 500–5000 bars, normalized + deduped. |
| **Realtime candles** | ✅ | Binance kline events → `marketDataStore.updateCandle` (TradingView-style forming-bar upsert by open time). TwelveData ticks → `CandleEngine` → candles. |
| **Symbol switching** | ✅ | `chartStore.setSymbol` → `useMarketData` → `selectMarket` (unsub old kline, sub new, reload history). Hardened idempotent in Step 12 (re-asserts the kline sub for the active key). |
| **Timeframe switching** | ✅ | `chartStore.setTimeframe` → `selectMarket`; history reloads at the new TF, realtime resumes. |
| **Reconnect** | ✅ | Providers: backoff `1→2→5→10→30s` (holds at 30s), infinite retries, auto-resubscribe on `onopen`. Hardened in Step 15 with a dead-socket watchdog (recycle an OPEN-but-silent socket after 45s) + instant reconnect on `window 'online'`. |
| **Single market-data store** | ✅ | `marketDataStore` is the sole owner of quotes/candles/selection/status/subscriptions. Service layer is module-level (not in React state), attached via `attachMarketDataService`. |
| **No mock data** | ✅ | `services/marketData.ts` deleted (Step 17). Grep for `services/marketData` / `getHistorySync` returns zero real importers. Replay MTF reads real higher-TF history via `useMtfSnapshotSeries`. |
| **No duplicate sockets** | ✅ | One combined WS per provider. Binance adds/removes streams via JSON-RPC `SUBSCRIBE`/`UNSUBSCRIBE`; TwelveData multiplexes via `subscribe`/`unsubscribe` actions. Chart (kline) and watchlist (ticker) use disjoint subscription keys → never tear each other down. |

## 3. Architecture as built

```
provider (Binance / TwelveData WS)
  → MarketDataService (routes via symbol registry, fans events, aggregates status)
    → marketDataStore (SSOT: quotes, candles, selection, status, subscriptions)
      → read-only hooks (useQuote / useCandles / useConnectionStatus / useMarketDataFeed)
        → UI (Watchlist rows, ConnectionBadge)
      → useMarketData (chart bridge: select → history → mirror into chartStore.candles)
        → useVisibleCandles (replay gate) → chart / indicators / SMC / trade
```

- **CandleEngine** builds candles from tick-only providers (TwelveData) using `TF_SECONDS` buckets.
- **HistoricalDataService** is REST-only, key-guarded, paginated.
- **Connection status** is aggregated per active provider and surfaced by `ConnectionBadge`.

## 4. Quality gates (verified this audit)

- `npm run type-check` → ✅ pass (0 errors)
- `npm run lint` → ✅ pass (0 warnings)
- `npm run build` → ✅ pass (route `/` ≈ 103 kB first load)
- No TODO/FIXME/HACK markers in `src/`.
- No mock-data importers remain.

## 5. Performance review (Step 16)

- Watchlist rows memoized + per-row `useQuote` → a tick on one symbol re-renders only that row.
- Chart forming-bar updates are O(1) via `series.update`; full `setData` only on
  symbol/timeframe/history/theme/replay changes.
- Candle arrays bounded to `MAX_CANDLES = 5000`.
- Per-tick re-renders removed from non-candle consumers: `replayStore.setTotal` is equality-guarded;
  `TopToolbar` / `DrawingToolbar` / `DrawingLayer` use atomic Zustand selectors (do not subscribe to
  `candles`).

## 6. Notable design decisions (intentional)

- **`chartStore` remains the chart's candle source**, bridged from `marketDataStore` by
  `useMarketData`. This kept indicators/SMC/replay/trade reading `chartStore.candles` (via
  `useVisibleCandles`) unchanged while swapping the data source from mock → realtime.
- **Chart subscribes kline only**; the watchlist subscribes ticker. Disjoint keys avoid
  cross-teardown.
- **Reconnect lives in the providers**, not the store or React — the store only reflects status.
- **Chart pan/zoom intentionally re-fits on timeframe change** (acceptable, TradingView-like).

See `PHASE1_GAPS.md` for the open items found during this audit (none are Phase 1 blockers).
