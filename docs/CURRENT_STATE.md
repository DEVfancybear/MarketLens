# CURRENT STATE — Phase 1, Step 1 (Codebase Analysis)

> Analysis only. No implementation code in this step. Goal: map what exists before replacing
> mock data with a realtime market-data architecture.

Validation at time of writing (2026-06-25):
`tsc --noEmit` ✅ exit 0 · `next lint` ✅ 0 warnings · `next build` ✅ · no TODO/FIXME markers.

---

## 1. Existing chart implementation

- **Library:** TradingView Lightweight Charts 4.2.3 (`components/chart/PriceChart.tsx`).
- One candlestick series + one volume histogram (overlay price scale `vol`).
- Overlay indicators (SMA/EMA/VWAP/ADR) added as line series on the main chart; RSI/MACD live
  in stacked `IndicatorPane` sub-charts time-synced to the main chart.
- Data is pushed with `series.setData(...)` on every `useVisibleCandles()` change (full array).
  **There is no `series.update(tick)` incremental path yet** — relevant for realtime.
- Coordinate conversion + canvas overlays (`SmcLayer`, `DrawingLayer`, `ReplaySelectionLayer`,
  `AlertLines`, `TradeLevels`) are already correct and synced via `ChartContext.version`.

## 2. Existing stores (Zustand)

`uiStore, chartStore, replayStore, smcStore, tradeStore, journalStore, analyticsStore,
watchlistStore, alertStore`.

- **Market data currently lives in `chartStore`** (`symbol`, `timeframe`, `candles`), loaded by
  `hooks/useMarketData.ts` (React Query). There is **no dedicated `marketDataStore`** — Phase 1
  Step 3 creates one as the single source of truth.
- No duplicate market-data stores. `chartStore.symbol` (active chart symbol),
  `watchlistStore.symbols` (watchlist), and `tradeStore.symbol` (sim) are distinct concerns,
  but all resolve symbols against the same hardcoded `SYMBOLS` registry.

## 3. Existing WebSocket code

- **None.** There is no WebSocket, no `provider`, no `ConnectionStatus`, no reconnect logic.
- Realtime is simulated by: (a) `setTimeout(60ms)` in `fetchHistory`, and (b) React Query
  `refetchInterval: 15000` on watchlist quotes — but the underlying generator is deterministic,
  so polled values don't actually change.

## 4. Existing watchlist

- `components/watchlist/Watchlist.tsx` + `store/watchlistStore.ts`.
- Quotes via `useQueries(['quote', ticker])` → `fetchQuote(ticker)` (MOCK).
- Renders last price, daily change %, volume; supports add/remove/sort. Green/red already keyed
  off `changePct`, but **the % never moves** because data is static/deterministic.

## 5. Existing symbol selector

- `components/toolbar/SymbolSearch.tsx` → `chartStore.setSymbol()`.
- On change: clears candles, sets loading, swaps persisted drawings, **disarms replay**, React
  Query refetches history. No subscribe/unsubscribe (no socket to manage).

## 6. Existing timeframe selector

- `TopToolbar` timeframe buttons → `chartStore.setTimeframe()`.
- Supported TFs: `1m, 3m, 5m, 15m, 30m, 1H, 4H, 1D, 1W` (`types/market.ts` `TF_SECONDS`).
- On change: clears candles + refetch. Chart re-fits once on first load, then preserves
  pan/zoom on subsequent updates.

---

## 7. Mock / fake / hardcoded inventory (to remove in Phase 1, Step 17)

| Item | Location | Notes |
|---|---|---|
| Seeded candle generator | `services/marketData.ts` → `generate1m`, `aggregate`, `getHistorySync` | mulberry32 PRNG, volatility clustering, displacement impulses |
| Mock history fetch | `services/marketData.ts` → `fetchHistory` | `setTimeout(60ms)` fake latency |
| Mock quote | `services/marketData.ts` → `fetchQuote` | derived from daily candles, deterministic |
| Hardcoded symbols | `services/marketData.ts` → `SYMBOLS` (10) | EURUSD, GBPUSD, USDJPY, XAUUSD, BTCUSD, ETHUSD, NAS100, SPX500, AAPL, TSLA |
| Per-symbol price profiles | `services/marketData.ts` → `profile()` | start price/drift/vol/volume |
| Default watchlist | `store/watchlistStore.ts` → `DEFAULT` | 8 symbols |
| Exchange/contract labels | `services/exchange.ts` | display-only mapping (type → BINANCE/FX/…) |
| MTF replay snapshot | `services/replayEngine.ts` → `mtfSnapshot` | calls `getHistorySync` (mock) |

> Note: the replay engine and SMC also call `getHistorySync` (mock). When the realtime engine
> lands, `mtfSnapshot` must source higher-TF history from the new `HistoricalDataService`.

## 8. Duplicate stores / risks

- No literal duplicate stores. **Risk:** market state is split across `chartStore` and React
  Query cache; Phase 1 should centralize into `marketDataStore` and treat `chartStore` as
  chart-UI-only (active symbol/timeframe + drawings/indicators).

## 9. In-progress work (NOT part of Phase 1)

A **left drawing-toolbar overhaul** was started and is **partially landed**:
- ✅ `types/drawing.ts` extended (channel, brush, measure, long/short, emoji, eraser, crosshair;
  `zIndex/locked/visible/stop/target`).
- ✅ `chartStore` actions added: `duplicateDrawing, lockDrawing, hideDrawing, bringToFront,
  sendToBack, toggleLockAll, toggleHideAll`, `drawingsLocked/Hidden`.
- ✅ `components/chart/drawing/drawingRenderer.ts` (pure renderer for all new types).
- ❌ **Not wired:** `DrawingLayer.tsx` still uses the old inline renderer/7-tool flow;
  `DrawingToolbar.tsx` still shows the old 7 tools; no `DrawingContextMenu`, no `drawingHitTest`
  module, no drawing keyboard-shortcut hook.
- **Net effect:** `drawingRenderer.ts` is currently **dead (unused) code**; the build is green
  because the changes are additive. This belongs to **Phase 3 (Drawing Engine)** per the
  roadmap and should be completed there or explicitly reverted before Phase 1 if undesired.
