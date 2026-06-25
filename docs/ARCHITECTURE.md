# ARCHITECTURE

SMC Trading Terminal — a TradingView/FXReplay/TradeZella-style web terminal focused on
Smart Money Concept backtesting via a no-look-ahead Replay engine.

> Scope: the **current** architecture as built. Reference for Phase 1 (Realtime Market Data
> Foundation). See `CURRENT_STATE.md` for the Phase-1 gap analysis and `NEXT_TASKS.md` for
> planned work.

---

## 1. Tech stack

| Concern | Choice | Version |
|---|---|---|
| Framework | Next.js (App Router) | 15.3.9 |
| Language | TypeScript (strict) | 5.7 |
| UI | React | 19 |
| Charts | TradingView **Lightweight Charts** | 4.2.3 |
| State | **Zustand** | 5 |
| Async/data | **@tanstack/react-query** | 5 |
| Styling | TailwindCSS + CSS variables | 3.4 |
| Icons | lucide-react | — |
| Persistence | IndexedDB (`idb`) + localStorage | — |
| Workers | Native Web Worker (SMC compute) | — |

> `framer-motion` is in `package.json` but its installed build is broken (`motion-dom` export
> mismatch). It is **not imported anywhere**; animations use CSS. See `HANDOFF.md` → Known Issues.

---

## 2. Runtime model & rendering pipeline

Browser-only app. The whole UI loads via
`dynamic(() => import('@/components/Terminal'), { ssr: false })` (`src/app/page.tsx`), so no
chart/canvas/localStorage code is server-rendered (removes a hydration-mismatch bug class).

```
src/app/layout.tsx          server shell (<html class="theme-dark">, fonts, metadata)
  └─ providers.tsx          React Query client + theme sync          [client]
       └─ page.tsx          dynamic ssr:false → <Splash/> fallback   [client]
            └─ Terminal.tsx  gated on useStoreHydration()            [client]
                 ├─ GlobalRuntime   headless runtime loops (see §6)
                 └─ TerminalLayout  resizable docks (top/left/center/right/bottom)
```

### Chart layer stack (z-order, all inside `PriceChart`)
```
PriceChart (lightweight-charts: candles + volume + overlay indicators)
  └─ ChartContext.Provider { chart, candleSeries, candles, version }
       ├─ SmcLayer              canvas overlay — SMC objects          pointer-events:none
       ├─ TradeLevels           price lines for open positions
       ├─ AlertLines            price lines for alerts
       ├─ DrawingLayer          canvas overlay — user drawings        pointer-events:auto*
       └─ ReplaySelectionLayer  canvas overlay — bar-replay picker    z-30, auto when selecting
  + ChartContextMenu            right-click price actions (portal)
```
Overlays convert **(time, price) → pixels** via `timeScale().timeToCoordinate()` /
`series.priceToCoordinate()` and repaint when `ChartContext.version` bumps (pan/zoom via
`subscribeVisibleLogicalRangeChange`, resize via `ResizeObserver`). Overlays never store
pixels — this is the sync contract that keeps drawings pinned through zoom/pan/resize/timeframe.

---

## 3. Directory map

```
src/
  app/            layout.tsx, page.tsx (dynamic), providers.tsx, globals.css
  components/
    Terminal.tsx          client root (hydration gate)
    layout/               TerminalLayout, BottomPanel, GlobalRuntime, Splash
    chart/                PriceChart, ChartArea, ChartContext, IndicatorPane,
                          DrawingLayer, ChartContextMenu, AlertLines, chartTheme,
                          chartRegistry, drawing/drawingRenderer.ts
    smc/                  SmcLayer
    toolbar/              TopToolbar, DrawingToolbar, SymbolSearch, IndicatorMenu,
                          SmcMenu, ChartSettingsMenu
    watchlist/            Watchlist
    replay/               ReplayPanel, ReplayControls, ReplayDashboard, ReplaySelectionLayer
    trade/                TradePanel, OrderTicket, PositionsTable, RiskPanel, TradeLevels
    journal/              JournalPanel
    analytics/            AnalyticsPanel, EquityChart
    ui/                   IconButton, Panel, Resizer, Dropdown
  hooks/          useMarketData, useVisibleCandles, useReplayPlayback, useHotkeys,
                  useSmcEngine, useTradeRuntime, useStoreHydration, useResizable
  services/       marketData.ts (MOCK), indicators.ts, replayEngine.ts, tradeEngine.ts,
                  analyticsEngine.ts, exporters.ts, storage.ts, exchange.ts,
                  smc/ (structure, fvg, orderBlock, liquidity, displacement, session, smcEngine)
  store/          uiStore, chartStore, replayStore, smcStore, tradeStore, journalStore,
                  analyticsStore, watchlistStore, alertStore
  types/          market, drawing, indicators, smc, trade, analytics, index
  utils/          format, time, math, cn, id, bus
  workers/        smc.worker.ts
```

---

## 4. State management (Zustand stores)

| Store | Owns | Persistence |
|---|---|---|
| `uiStore` | theme, panel sizes, bottom tab, fullscreen, grid toggle, logs | localStorage `ui` |
| `chartStore` | **symbol, timeframe, candles (master series)**, drawings, indicators, active tool, crosshair | localStorage `drawings:<symbol>`, `indicators` |
| `replayStore` | armed/selecting/playing, speed, cursor, anchor, total | — |
| `smcStore` | SMC snapshot + per-group visibility settings | localStorage `smc-settings` |
| `tradeStore` | equity, positions, current sim price/time | — |
| `journalStore` | closed-trade journal entries | **IndexedDB** `smc-terminal/journal` |
| `analyticsStore` | starting equity, symbol filter | — |
| `watchlistStore` | watchlist symbols, sort | localStorage `watchlist` |
| `alertStore` | in-memory price alerts | runtime only |

**Single source of truth for visibility:** `useVisibleCandles()` returns `chartStore.candles`
(full) or, while replay is armed, `candles[0..replayCursor]`. Every chart/indicator/SMC/trade
computation reads from it — the structural no-look-ahead guarantee.

> Stores init with deterministic SSR-safe defaults; persisted values load in
> `useStoreHydration()` after mount.

---

## 5. Data flow (current — MOCK)

```
services/marketData.ts (seeded mulberry32 PRNG → 1m OHLCV → aggregate to TF)
        │  fetchHistory({ticker, timeframe, limit})   [~60ms simulated latency]
        ▼
hooks/useMarketData.ts (React Query: ['history', symbol, timeframe], limit 2000)
        ▼
chartStore.setCandles()  → master series
        ▼
useVisibleCandles()  → replay-aware slice
        ├─ PriceChart.setData()      candles + volume
        ├─ indicators.ts             SMA/EMA/VWAP/RSI/MACD/ADR
        ├─ useSmcEngine → smc.worker structure/FVG/OB/liquidity/...
        └─ useTradeRuntime           fills pending orders, SL/TP
```

- **Quotes:** `Watchlist` uses `useQueries(['quote', ticker])` with `refetchInterval: 15000`,
  but `fetchQuote` derives from the deterministic generator anchored to the current hour, so
  values are effectively static between symbol changes — **faux realtime**.
- **No WebSocket layer, no connection status, no reconnect, no central market-data store.**
  Phase 1 introduces all of these.

---

## 6. Runtime loops (`GlobalRuntime`, headless)

- `useReplayPlayback` — rAF clock advancing the replay cursor at 1×–100×.
- `useHotkeys` — Space/←/→/R (replay), B/S/X (trade) via `utils/bus`.
- `useSmcEngine` — posts visible candles to `smc.worker` (throttled ~90ms) → `smcStore`.
- `useTradeRuntime` — streams the latest visible candle into `tradeStore`.
- Journal hydrate from IndexedDB on mount.

---

## 7. Domain engines (pure, replay-safe)

- **Indicators** (`services/indicators.ts`): SMA, EMA, session-VWAP, RSI, MACD, ADR.
- **SMC** (`services/smc/*`): structure (HH/HL/LH/LL, BOS/CHOCH/MSS), FVG, Order Blocks,
  Liquidity (EQH/EQL + sweeps), Displacement, Sessions + kill zones — orchestrated by
  `smcEngine.ts`, run off-thread in `smc.worker.ts`.
- **Trade** (`services/tradeEngine.ts`): risk sizing, market/limit/stop triggering, SL/TP, R.
- **Analytics** (`services/analyticsEngine.ts`): win rate, profit factor, expectancy, max DD,
  equity/drawdown curve, monthly, R-distribution.

All consume only the candle array passed in → inherently look-ahead-free.

---

## 8. Persistence

- **localStorage:** `ui`, `drawings:<symbol>`, `indicators`, `watchlist`, `smc-settings`.
- **IndexedDB** (`services/storage.ts`, db `smc-terminal` v1): `journal` + `screenshots` via
  `idb`. SSR-guarded and lazy.

---

## 9. Integration seams for Phase 1 (realtime)

Insertion points so realtime work needs no rewrites:

1. **`services/marketData.ts`** — `fetchHistory` / `fetchQuote` are the only data sources; swap
   their bodies (or route through a new `MarketDataService`) and the rest is agnostic.
2. **`chartStore.setCandles` / `useMarketData`** — where history lands; a realtime engine should
   append/update the last bar here (or via a new `marketDataStore`).
3. **`Watchlist`** — reads `useQueries(['quote'])`; repoint to a realtime quotes selector.
4. **`SYMBOLS`** (`marketData.ts`) — hardcoded symbol registry to replace/extend.
5. **`PriceChart`** — already supports incremental `setData`; realtime should prefer
   `series.update(lastBar)` for O(1) tick updates (not yet wired).
