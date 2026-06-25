# PROJECT ARCHITECTURE

Canonical subsystem architecture (per the project memory contract in `.claude/CLAUDE.md`).
For the detailed layer/render/data-flow write-up see **`ARCHITECTURE.md`**; this file adds the
subsystem-specific sections and forward-looking (planned) architecture.

---

## System architecture
Browser-only Next.js 15 (App Router) SPA. The terminal is a `dynamic(ssr:false)` client chunk.
Lightweight Charts renders price; **HTML5 canvas overlays** render everything custom (SMC,
drawings, replay picker) by projecting (time,price)→pixels via chart APIs and repainting on
`ChartContext.version`. Zustand holds state; React Query loads (currently mock) history.

## Folder structure
See `ARCHITECTURE.md` §3 for the full tree. Top level: `src/{app,components,hooks,services,
store,types,utils,workers}` + `docs/`.

## State management
9 Zustand stores (`ARCHITECTURE.md` §4). Visibility single-source = `useVisibleCandles()`
(replay gate). Stores init with SSR-safe defaults, hydrate post-mount via `useStoreHydration`.
Persistence: localStorage + IndexedDB.

## Data flow
`marketData.ts (MOCK)` → `useMarketData` (React Query) → `chartStore.candles` →
`useVisibleCandles()` → chart / indicators / SMC worker / trade runtime. See `ARCHITECTURE.md` §5.

## WebSocket architecture — **PLANNED (Phase 1, not yet built)**
Target design:
```
MarketDataService (routing, subscriptions, reconnect)
  ├─ BinanceProvider   (ONE combined WS: ticker + kline + miniTicker)   crypto
  └─ TwelveDataProvider (forex / metals / indices)                      keyed
        normalize → unified types → marketDataStore → useCandles/useQuote hooks
```
Rules: one socket per provider (never per symbol), backoff reconnect 1→2→5→10→30s (infinite),
auto-resubscribe, `CandleEngine` merges history + ticks into the forming bar. Hooks read the
store only; they never open sockets. **Current code has none of this** — all mock.

## Trading architecture (simulator — implemented)
`tradeStore` (equity, positions) + `services/tradeEngine.ts` (risk sizing, market/limit/stop
triggering, SL/TP exits, R-multiple). `useTradeRuntime` streams the latest visible candle to
fill pending orders and trip SL/TP. UI: `OrderTicket`, `PositionsTable`, `RiskPanel`,
`TradeLevels` (entry/SL/TP price lines). Closed trades auto-journal (IndexedDB) → analytics.
**Planned (Phase 6):** replace the simulator with a real MT5/broker bridge.

## Alert architecture (partial)
`alertStore` (in-memory price alerts) + `AlertLines` (renders alert price lines on the candle
series). Created from the chart right-click context menu. **Missing (Phase 2):** trigger
detection (price-cross in `CandleEngine`) and notifications (Firebase push per roadmap).

## Drawing architecture
**Shipped:** `chartStore.drawings` (persisted `drawings:<symbol>`) + `DrawingLayer` canvas
overlay (create/move/select/delete for trend/horizontal/vertical/rectangle/text/fib) +
`DrawingToolbar` (7 tools). Right-click chart context menu adds a horizontal line.
**In progress (Phase 3, unwired):** extended `types/drawing.ts` (channel/brush/measure/long/
short/emoji/eraser), `chartStore` layer/lock/hide/duplicate actions, and pure
`components/chart/drawing/drawingRenderer.ts`. Not yet wired into `DrawingLayer`/`DrawingToolbar`
(dead code; build green). See `KNOWN_ISSUES.md`.

## MT5 architecture — **PLANNED (Phase 6, not started)**
Bridge service to route real orders / positions; replace `tradeStore` simulation; mobile/push
notifications. No code yet.

## Technology stack
Next 15.3.9 · React 19 · TypeScript 5.7 (strict) · Lightweight Charts 4.2.3 · Zustand 5 ·
React Query 5 · Tailwind 3.4 · idb 8 · Web Workers. (`framer-motion` present but broken/unused —
see `KNOWN_ISSUES.md`.)
