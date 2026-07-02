# ARCHITECTURE

SMC Trading Terminal — a TradingView/FXReplay/TradeZella-style web terminal focused on
Smart Money Concept backtesting via a no-look-ahead Replay engine.

> Scope: the **current** architecture as built (updated 2026-06-28 for Jotai migration).
> See `CURRENT_STATE.md` for the Phase-1 gap analysis and `NEXT_TASKS.md` for planned work.

---

## 1. Tech stack

| Concern | Choice | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.9 |
| Language | TypeScript (strict) | 5.7 |
| UI | React | 19 |
| Charts | TradingView **Lightweight Charts** | 4.2.3 |
| State | **Jotai** (atoms) | 2.x |
| Async/data | **@tanstack/react-query** | 5 |
| Styling | TailwindCSS + CSS variables | 3.4 |
| Icons | lucide-react | — |
| Persistence | IndexedDB (`idb`) + localStorage | — |
| Workers | Native Web Worker (SMC compute) | — |

> **2026-06-28**: Upgraded to Next.js 16.2.9 (Turbopack). `next lint` removed in v16 —
> linting now runs via `eslint` directly with flat config (`eslint.config.mjs`).
> All 11 Zustand stores migrated to Jotai atoms — see below.
>
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
       ├─ AlertOverlay          interactive chart alerts
       ├─ DrawingLayer          canvas overlay — user drawings        pointer-events:auto*
       └─ ReplaySelectionLayer  canvas overlay — bar-replay picker    z-30, auto when selecting
  + ChartContextMenu            right-click price actions (portal)
  + ReplayFloatingToolbar       Bar Replay transport/timing controls
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
                          DrawingLayer, ChartContextMenu, AlertLines, AlertOverlay,
                          chartTheme, chartRegistry
    alerts/               AlertCenter, AlertEditDialog
    smc/                  SmcLayer
    toolbar/              TopToolbar, DrawingToolbar, SymbolSearch, IndicatorMenu,
                          IndicatorSettingsDialog, SmcMenu, ChartSettingsMenu
    watchlist/            Watchlist
    replay/               ReplayPanel, ReplayControls, ReplayDashboard, ReplaySelectionLayer,
                          ReplayFloatingToolbar, ReplayTimingMenu
    trade/                TradePanel, OrderTicket, PositionsTable, RiskPanel, TradeLevels
    journal/              JournalPanel
    analytics/            AnalyticsPanel, EquityChart
    ui/                   IconButton, Panel, Resizer, Dropdown
    notifications/        Toaster
  hooks/          useMarketData, useVisibleCandles, useReplayPlayback, useHotkeys,
                  useSmcEngine, useTradeRuntime, useStoreHydration, useResizable
  services/       indicators.ts, replayEngine.ts, tradeEngine.ts, analyticsEngine.ts,
                  alertEngine.ts, exporters.ts, storage.ts, exchange.ts,
                  market-data/{MarketDataService, HistoricalDataService, CandleEngine, symbols, providers/*},
                  notifications/{notify, sound, browser}, smc/{structure, fvg, orderBlock, liquidity, ...}
  store/          **Jotai atom modules**: uiStore, chartStore, replayStore, smcStore, tradeStore,
                  journalStore, analyticsStore, watchlistStore, marketDataStore, alertStore, toastStore
                  (each exports individual `atom()` + write atoms + `useXStore()` compat hook)
  types/          market, marketData, drawing, indicators, smc, trade, analytics, index
  utils/          format, time, math, cn, id, bus
  workers/        smc.worker.ts
```

---

## 4. State management (Jotai atoms)

All state is managed through **Jotai atoms** — each store module exports:

1. **Individual state atoms** — `atom<Type>(defaultValue)` for each piece of state
2. **Write atoms** — `atom(null, (get, set, ...args) => { ... })` for action methods
3. **Compatibility hook** — `useXStore(selector?)` for backward-compatible selector-based access
4. **Non-React accessor** — `getXState()` using `getDefaultStore()` for services/hooks

### Atom modules

| Module | State atoms | Key atoms | Persistence |
|---|---|---|---|
| `uiStore` | theme, panels, bottomTab, rightOpen, bottomOpen, fullscreen, alertCenterOpen, gridVisible, logs | `logAtom`, `hydrateAtom`, `toggleThemeAtom` | localStorage `ui` |
| `chartStore` | symbol, timeframe, candles, drawings, indicators, activeTool, drawColor, selectedDrawingId, selectedDrawingIds, drawingsLocked, drawingsHidden, editingIndicatorId, crosshair, loading | `addDrawingAtom`, `updateDrawingAtom`, `removeDrawingAtom`, `toggleIndicatorAtom`, ... (30 write atoms) | localStorage `drawings:<symbol>`, `indicators` |
| `replayStore` | active, selecting, reSelecting, playing, speed, cursor, anchor, total | `armAtom`, `disarmAtom`, `stepAtom`, `beginReSelectAtom`, `cancelReSelectAtom`, `confirmReSelectAtom` | — |
| `smcStore` | snapshot, settings | `toggleSmcAtom`, `hydrateSmcAtom` | localStorage `smc-settings` |
| `tradeStore` | equity, startingEquity, positions, price, time, tradeSymbol | `placeOrderAtom`, `closePositionAtom`, `closeAllAtom` | — |
| `journalStore` | entries, loaded | `addJournalEntryAtom`, `removeJournalEntryAtom` (async) | **IndexedDB** `smc-terminal/journal` |
| `analyticsStore` | startingEquity, symbolFilter | `setStartingEquityAtom`, `setSymbolFilterAtom` | — |
| `watchlistStore` | symbols, sortKey, sortDir | `addWatchlistSymbolAtom`, `removeWatchlistSymbolAtom` | localStorage `watchlist` |
| `marketDataStore` | quotes, candles, selectedSymbol, selectedTimeframe, connectionStatus, subscriptions, subRefs, lastUpdate | `updateCandleAtom`, `selectMarketAtom`, `subscribeAtom` | runtime only |
| `alertStore` | alerts, triggeredAlerts, history, settings, selectedAlertId, editingAlertId | `createAlertAtom`, `triggerAlertAtom`, `deleteAlertAtom` | localStorage `alerts` |
| `toastStore` | toasts | `pushToastAtom`, `dismissToastAtom` | runtime only |

### Render optimisation by example

Before (Zustand — component re-renders on *any* store change):
```tsx
const symbol = useChartStore((s) => s.symbol);   // re-renders when candles tick
```

After (Jotai — component only re-renders when *that atom* changes):
```tsx
const symbol = useAtomValue(symbolAtom);          // only re-renders on symbol change
```

Key optimisations:
- `TopToolbar` no longer re-renders on every candle tick
- `DrawingToolbar` subscribes to 5 atoms instead of full 30-field chartStore
- `ChartArea` subscribes to 5 atoms instead of full chartStore
- `AlertOverlay` subscribes only to `alertsAtom` + `selectedAlertIdAtom`
- `PriceChart` indicator overlay only re-renders when `indicatorsAtom` changes

### Access patterns

| Context | Pattern |
|---|---|
| React state read | `useAtomValue(symbolAtom)` |
| React action call | `useSetAtom(addDrawingAtom)` → `addDrawing(drawing)` |
| React compat (legacy) | `useChartStore((s) => s.symbol)` |
| Non-React read | `getDefaultStore().get(candlesAtom)` |
| Non-React write | `getDefaultStore().set(logAtom, { level, msg })` |

> **⚠ Gotcha:** `useXStore(selector)` returns unstable references (new state object per render).
> Never destructure action functions from it into `useEffect` deps — use `useSetAtom(writeAtom)`
> instead. Example: `useAlertStore((s) => s.hydrate)` → `useSetAtom(hydrateAtom)`.

**Alert architecture (Phase 2):** `marketDataStore` (SSOT) → `useAlertEngine` (push subscription,
no polling/sockets; refcounted alert-symbol tickers) → pure `services/alertEngine.ts` (above/below/
crossUp/crossDown) → `alertStore.triggerAlert` (once-only/recurring) → `services/notifications/
notify.ts` → toast / sound / browser (Firebase push seam for Phase 6). UI: `components/alerts/
AlertCenter.tsx` + chart `AlertOverlay`. Full detail in **`docs/ALERT_ARCHITECTURE.md`**.

**Single source of truth for visibility:** `useVisibleCandles()` returns `candlesAtom` value
(full) or, while replay is armed, `candles[0..replayCursor]`. Every chart/indicator/SMC/trade
computation reads from it — the structural no-look-ahead guarantee. During **re-select mode**
(`reSelectingAtom`), visible candles remain unchanged (hover previews use the full list read
directly from `candlesAtom` in the overlay canvas).
Bar Replay date/chart selection uses `indexNearestByTime()` to choose the closest candle; MTF
snapshots intentionally use `indexAtOrBefore()` so higher-timeframe rows cannot reveal a bar after
the replay cursor.

> Atoms init with deterministic SSR-safe defaults; persisted values load in
> `useStoreHydration()` after mount via `getDefaultStore().set(hydrateAtom)`.

---

## 5. Data flow

```
MarketDataService (Binance WS / OANDA REST / TwelveData)
        │  realtime kline + ticker
        ▼
marketDataStore (quotesAtom / candlesAtom / updateCandleAtom)
        ▼
useMarketData (selectMarket → history → mirror into chartStore)
        ▼
chartStore.setCandlesAtom  → candlesAtom (master series)
        ▼
useVisibleCandles()  → replay-aware slice
        ├─ PriceChart.setData()      candles + volume
        ├─ indicators.ts             SMA/EMA/VWAP/RSI/MACD/ADR
        ├─ useSmcEngine → smc.worker structure/FVG/OB/liquidity/...
        └─ useTradeRuntime           fills pending orders, SL/TP
```

---

## 6. Runtime loops (`GlobalRuntime`, headless)

- `useReplayPlayback` — rAF clock advancing the replay cursor at TradingView-style speeds
  `0.1x`, `0.3x`, `0.5x`, `1x`, `3x`, `10x`.
- `useHotkeys` — drawing shortcuts (1–9, Delete, Ctrl+D/Z/A/I, Escape) + replay transport
  (Space, Shift+Down, ArrowLeft/Right, Shift+Left, R) + trade (B/S/X).
- `useSmcEngine` — posts visible candles to `smc.worker` (throttled ~90ms) → `setSmcSnapshotAtom`.
- `useTradeRuntime` — streams the latest visible candle into `setTradeMarketAtom`.
- `useAlertEngine` — pushes `marketDataTickAtom` subscription, evaluates alerts on price ticks.
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

- **localStorage:** `ui`, `drawings:<symbol>`, `indicators`, `watchlist`, `smc-settings`, `alerts`.
- **IndexedDB** (`services/storage.ts`, db `smc-terminal` v1): `journal` + `screenshots` via
  `idb`. SSR-guarded and lazy.

---

## 9. Drawing subsystem

The drawing engine uses a document-level pointer-event architecture:
- `DrawingLayer` canvas is `pointerEvents:"none"` — purely a rendering surface
- All pointer/keyboard events handled via document capture-phase listeners in `DrawingInteractionManager`
- 25 drawing tools registered via `ToolRegistry` plugin architecture
- Hit testing via `HitTestEngine` (canonical targets: `"p1" | "p2" | "body"`)
- Command history via `CommandManager` + `useCommandHistory` for undo/redo
- All tools' hitTest vocabulary standardised (2026-06-26 audit)

Full architecture audit in `DEEPSEEK.md` §"Full Interaction Pipeline Audit".
