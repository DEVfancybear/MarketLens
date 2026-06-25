# CHANGELOG

All notable changes to the SMC Trading Terminal. Dates are UTC.

## [Unreleased]

### Changed — Phase 1 Step 17: Remove Last Mock — Phase 1 COMPLETE (2026-06-25)
- **Deleted `src/services/marketData.ts`** (the seeded mock OHLCV generator) — the last mock data
  path in the app is gone. All candle/quote/symbol data now comes from the realtime pipeline.
- `src/services/replayEngine.ts` — `mtfSnapshot()` is now **pure**: it takes a caller-supplied
  `seriesByTf` map instead of importing the mock's `getHistorySync`. Signature changed from
  `mtfSnapshot(symbol, time, tfs?)` → `mtfSnapshot(time, seriesByTf, tfs?)`. No-look-ahead is
  unchanged — each series is still sliced to the bar at/just before the replay cursor.
- `src/hooks/useMtfSnapshotSeries.ts` (new) — loads the 5 higher TFs (`5m/15m/1H/4H/1D`, 500 bars
  each) for the active replay symbol from the real `HistoricalDataService` (Binance no-key; TwelveData
  needs a key), cancellable, only while replay is active. Feeds the pure `mtfSnapshot`.
- `src/components/replay/ReplayDashboard.tsx` — consumes `useMtfSnapshotSeries` + the new
  `mtfSnapshot` signature.
- Swapped the mock's `getSymbol(...)?.pricePrecision` for the registry's `getMarketSymbol(...)` in
  `ReplayDashboard`, `SmcLayer`, `JournalPanel`, `OrderTicket`, `PositionsTable` (precision only).
- **Phase 1 (Realtime Market Data Foundation) is complete — Steps 1–17 done.** Build/type/lint green.

### Changed — Phase 1 Step 16: Performance Pass (2026-06-25)
- Eliminated per-realtime-tick re-renders in components that don't consume candle data:
- `src/store/replayStore.ts` — `setTotal()` now **equality-guards** (`if (total !== get().total)`).
  It's called once per tick from the chart mirror, but only a new bar changes the count; previously
  every tick produced a fresh replay-store object that re-rendered every whole-store subscriber
  (transport, dashboard, toolbar). Now they re-render only when the bar count actually changes.
- `src/components/toolbar/TopToolbar.tsx` — dropped the whole-store `useChartStore()` destructure
  (it pulled `candles`, which mutates every tick → full-toolbar re-render). Now selects `timeframe`
  + `setTimeframe` atomically and reads `candles.length` lazily via `getState()` inside the replay
  handler.
- `src/components/toolbar/DrawingToolbar.tsx` and `src/components/chart/DrawingLayer.tsx` — converted
  whole-store subscriptions to **atomic per-field selectors**. Neither reads `candles` (the drawing
  canvas repaints on `ctx.version` for pan/zoom, not on candle data), so they no longer re-render on
  every forming-bar tick.
- Already in place (verified): watchlist rows are memoized + per-row `useQuote` (Step 10); chart uses
  the O(1) `series.update` fast path (Step 11); candle series capped at `MAX_CANDLES = 5000`.
- Build/type/lint green.

### Changed — Phase 1 Step 15: Reconnect Hardening (2026-06-25)
- Baseline reconnect was already present (backoff `1→2→5→10→30s` holding at 30s, infinite retries,
  auto-resubscribe on `onopen`, `manualClose` suppresses reconnect on intentional disconnect) and
  was verified. Step 15 adds the two cases the `onclose`-driven path can't cover:
- `src/services/market-data/providers/BinanceProvider.ts` and `TwelveDataProvider.ts` —
  **dead-socket watchdog**: a `setInterval` (15s) records the last inbound-frame time (every frame,
  incl. RPC acks / heartbeats) and, if an OPEN socket goes silent for `> 45s` while subscriptions
  are active, force-closes it so the normal reconnect path resubscribes. Catches sockets that die
  without firing `onclose` (sleeping tabs / flaky networks). Idle providers (no active subs) never
  trigger it. TwelveData's ~10s heartbeats and Binance's per-second klines keep a live socket well
  under the threshold, so no false recycles.
- Same files — **instant network recovery**: a `window 'online'` listener clears the pending backoff
  timer and reconnects immediately instead of waiting out the (up to 30s) backoff. Listener is
  bound on `connect()` and removed on `disconnect()`; both new mechanisms are SSR-guarded.
- Build/type/lint green.

### Changed — Phase 1 Steps 12–14: Switch Hardening + Connection Badge (2026-06-25)
- `src/store/marketDataStore.ts` — **`selectMarket()` made idempotent**. It now re-asserts the
  kline subscription for the active key even when symbol+timeframe are unchanged (previously an
  early `return` could leave the chart with REST history but **no live kline stream** whenever the
  chart default already equalled the store default). `subscribe()` is dedup-guarded, so re-asserting
  an existing subscription is a no-op; switching still unsubscribes the old kline before subscribing
  the new one. Verified: Binance `UNSUBSCRIBE` is sent on switch (no socket leak) and the
  `cancelled` guard in `useMarketData` prevents an abandoned symbol's history from overwriting
  (Steps 12–13 — symbol/timeframe switching).
- `src/components/toolbar/ConnectionBadge.tsx` (new) — Step 14 realtime-feed status chip. Reads
  `useConnectionMeta()` (over `marketDataStore.connectionStatus`) and renders a 🟢/🟡/🔴 dot + label
  from `CONNECTION_STATUS_META`; the dot pulses while connecting/reconnecting. Label hides below
  `md` to keep the toolbar compact. Pure read — no sockets.
- `src/components/toolbar/TopToolbar.tsx` — mounts `<ConnectionBadge />` in the right-side group
  (divider before the icon buttons).
- Build/type/lint green.

### Changed — Phase 1 Step 11: Realtime Chart Integration (2026-06-25)
- `src/hooks/useMarketData.ts` — **rewritten from mock to realtime**. On symbol/timeframe change:
  `marketDataStore.selectMarket()` (subscribe kline, drop old) + load history via
  `HistoricalDataService` → `setCandles`. Continuously mirrors the store's candle series into
  `chartStore.candles`, so chart/indicators/SMC/replay/trade keep reading `chartStore.candles`
  (via `useVisibleCandles`) unchanged — now realtime instead of mock. Verified: Binance klines
  REST shape matches the parser.
- `src/components/chart/PriceChart.tsx` — incremental `series.update(lastBar)` fast path for
  forming-bar ticks and single appended bars (smooth O(1) realtime); full `setData` only on
  symbol/timeframe/history/theme/replay changes. Precision via registry `getMarketSymbol`.
- `store/marketDataStore.ts` — `DEFAULT_CHANNELS = ['kline']` (chart) so chart (kline) and
  watchlist (ticker) never share a stream → no cross-teardown; added atomic `selectMarket()`;
  `changeSymbol`/`changeTimeframe` delegate to it.
- `store/chartStore.ts` — default symbol `BTCUSDT` (Binance, streams with no API key).
- `Watchlist` click and `SymbolSearch` now use registry symbols (`MARKET_SYMBOLS`); precision in
  `ChartArea`/`ChartContextMenu` via `getMarketSymbol`. `exchange.ts` `contractTagOf` takes
  `AssetClass` (exchange label now from the registry).
- Crypto charts stream live (history + realtime klines); forex/metals/indices need a TwelveData
  key (history + tick-built candles). Mock `marketData.ts` still used only by replay MTF (Step 17).
  Build/type/lint green.

### Changed — Phase 1 Step 10: Realtime Watchlist Integration (2026-06-25)
- `components/watchlist/Watchlist.tsx` — removed mock React Query (`useQueries`/`fetchQuote`).
  Each row is now a memoized `WatchRow` reading its own `useQuote(ticker)` from `marketDataStore`
  (a tick on one symbol re-renders only that row). Symbols + metadata now come from the registry
  (`MARKET_SYMBOLS`). Parent reads the quotes map only for value-sorts; symbol-sort uses a stable
  empty map so it never re-renders on ticks. Green/red from real change %.
- `src/hooks/useMarketDataBootstrap.ts` (new) — mounted once in `GlobalRuntime`; creates the
  MarketDataService and keeps watchlist symbols subscribed for `ticker` (diffs add/remove),
  `connect()`/`disconnect()` lifecycle. This is the first point that opens live sockets.
- `store/watchlistStore.ts` — registry-backed defaults (`BTCUSDT`, …); `hydrate()` migrates/drops
  persisted ids not in the registry (e.g. old mock `BTCUSD`).
- Crypto (Binance) shows real price + 24h change; forex/metals/indices (TwelveData) need
  `NEXT_PUBLIC_TWELVEDATA_API_KEY` (rows show "—" without it; TD WS has no daily change → 0%).
- Watchlist row click still drives the MOCK chart (chart swap is Step 11). Build/type/lint green.

### Added — Phase 1 Step 9: Read-only Market Data Hooks (2026-06-25)
- `src/hooks/useCandles.ts` — `useCandles(symbol?, timeframe?)` atomic store selector → candle
  series (defaults to active selection).
- `src/hooks/useQuote.ts` — `useQuote(symbol)` / `useLastPrice(symbol)` per-symbol selectors
  (one per watchlist row → minimal rerenders).
- `src/hooks/useConnectionStatus.ts` — `useConnectionStatus()` / `useConnectionMeta()` for the
  Step-14 status badge.
- `src/hooks/useMarketDataFeed.ts` — aggregate read hook (symbol/timeframe/candles/quote/status);
  the realtime "useMarketData", to take over the `useMarketData.ts` filename in Step 11.
- All read from `marketDataStore` only; **none open sockets**. Existing mock `useMarketData.ts`
  left untouched (still drives the chart until Step 11). Build/type/lint green.

### Added — Phase 1 Step 8: Realtime Candle Engine (2026-06-25)
- `src/services/market-data/CandleEngine.ts` — merges history + realtime into a forming bar
  (TradingView-style). `applyTick` buckets price ticks into the current bar via `TF_SECONDS`
  (O/H/L/C/V), emitting the previous bar as `closed` on rollover; `applyKline` passes through for
  kline providers; `seedHistory` continues the last loaded bar; per-`symbol:timeframe` state.
- `MarketDataService` wired to the engine: tick-only providers (TwelveData) now build candles
  from `quote` ticks (seeded lazily from the store's history) and push `current`/`closed` bars via
  `updateCandle`; kline providers (Binance) still push klines directly. Tracks active timeframe
  per symbol (`tfBySymbol`) and resets engine state on unsubscribe.
- Build/type/lint green. Realtime candle loop now closed for both provider kinds.

### Added — Phase 1 Step 7: Historical Data Service (2026-06-25)
- `src/services/market-data/HistoricalDataService.ts` — REST history loader (500–5000 bars),
  routed by the symbol registry, normalized to unified `MarketCandle[]` (ascending, `closed:true`).
  Binance `GET /api/v3/klines` with `endTime` pagination (1000/request), TwelveData
  `GET /time_series` (`outputsize`, `order=ASC`). `before` cursor for paging; dedupe + sort.
  TwelveData key from `NEXT_PUBLIC_TWELVEDATA_API_KEY` (throws clearly if missing).
- Pure fetch service — callers push into `marketDataStore.setCandles` (Steps 9–13).
  `getHistoricalDataService()` singleton. Build/type/lint green.

### Added — Phase 1 Step 6: Market Data Service + Symbol Registry (2026-06-25)
- `src/services/market-data/MarketDataService.ts` — owns BinanceProvider + TwelveDataProvider,
  routes each symbol to the right provider (via the registry), fans normalized
  `MarketDataEvent`s into `marketDataStore` (`updateQuote`/`updateCandle`/`setConnectionStatus`),
  and aggregates a single `connectionStatus` (only providers with active subs count). Implements
  `MarketDataServiceBinding`; `getMarketDataService()` lazily creates it and calls
  `attachMarketDataService()`. Pure service, no UI.
- `src/services/market-data/symbols.ts` — canonical symbol registry (config, not mock data):
  `MARKET_SYMBOLS` with provider routing + `providerSymbol` (Binance "BTCUSDT", TwelveData
  "XAU/USD"), `getMarketSymbol()`, `twelveDataSymbolMap()`.
- Resolves the canonical↔provider symbol mapping flagged in Step 5. Not bootstrapped into the app
  yet (Steps 10–13). Build/type/lint green.

### Added — Phase 1 Step 5: TwelveData Provider (2026-06-25)
- `src/services/market-data/providers/TwelveDataProvider.ts` — single price WebSocket
  (`wss://ws.twelvedata.com/v1/quotes/price`) for forex/metals/indices; one socket multiplexes
  symbols via `subscribe`/`unsubscribe`. Emits unified `quote` events (TwelveData WS is
  price-only; candles come from REST + CandleEngine). Backoff reconnect + auto-resubscribe;
  implements `MarketDataServiceBinding`. Optional `symbolMap` (canonical ↔ "EUR/USD") with
  reverse mapping on emitted events.
- API key from `NEXT_PUBLIC_TWELVEDATA_API_KEY` (graceful error if missing). Added `.env.example`
  template; hardened `.gitignore` (`.env`, `.env*.local`, keep `!.env.example`). No key committed.
- Standalone until Step 6/10–13. Build/type/lint green.

### Added — Phase 1 Step 4: Binance Provider (2026-06-25)
- `src/services/market-data/providers/BinanceProvider.ts` — single combined WebSocket to
  `wss://stream.binance.com:9443/ws`; dynamic `SUBSCRIBE`/`UNSUBSCRIBE` (one socket, never one
  per symbol) for `@ticker`, `@miniTicker`, `@kline_<interval>`.
- Normalizes Binance payloads → unified `MarketDataEvent` (`quote` / `candle` / `status`).
- Auto-reconnect walking `RECONNECT_BACKOFF_MS` (1→2→5→10→30s, infinite) with full
  auto-resubscribe of active streams on reopen; SSR-guarded (`typeof WebSocket`).
- Implements `MarketDataServiceBinding` (connect/disconnect/subscribe/unsubscribe) so it can be
  attached to `marketDataStore` directly or via `MarketDataService` (Step 6).
- Standalone (not bootstrapped into the app yet — Step 6/10–13). Build/type/lint green.

### Added — Phase 1 Step 3: Market Data Store (2026-06-25)
- `src/store/marketDataStore.ts` — Zustand single source of truth: `quotes, candles,
  selectedSymbol, selectedTimeframe, connectionStatus, subscriptions, lastUpdate` + actions
  `connect/disconnect/subscribe/unsubscribe/changeSymbol/changeTimeframe` (intents) and
  `updateQuote/updateCandle/setCandles/setConnectionStatus` (ingress) + selectors.
- Pure store — no socket/provider logic; a `MarketDataServiceBinding` is attached at runtime via
  `attachMarketDataService()` (Step 6) to avoid a store↔service cycle.
- `updateCandle` does the TradingView-style realtime merge (upsert last bar by time; trim to
  `MAX_CANDLES = 5000`).
- Path note: placed in `src/store/` (existing convention), not `src/stores/` from the roadmap,
  to avoid a duplicate store directory.
- Standalone; not yet wired to chart/watchlist (Steps 10–13). Build/type/lint green.

### Added — Phase 1 Step 2: Market Data Types (2026-06-25)
- `src/types/marketData.ts` — unified market-data model contract: `MarketQuote`,
  `MarketCandle`, `MarketSymbol`, `ConnectionStatus` (+`ConnectionState`), `Timeframe`
  (re-exported single-source from `market.ts`), plus supporting `MarketProvider`,
  `AssetClass`, `MarketChannel`, `MarketSubscription`, `MarketDataEvent`,
  `MarketDataListener`, `HistoryRequest`, and constants `SUPPORTED_TIMEFRAMES`,
  `RECONNECT_BACKOFF_MS`, `CONNECTION_STATUS_META`, `subscriptionKey()`.
- `src/types/index.ts` — re-export `./marketData` from the barrel (no `Timeframe` collision:
  same symbol re-exported from `market`).
- Types only; no runtime/UI wired yet, no mock data touched. Build/type/lint green.

### Added — 2026-06-25
- `docs/`: `ARCHITECTURE.md`, `CURRENT_STATE.md`, `CURRENT_PROGRESS.md`, `NEXT_TASKS.md`,
  `HANDOFF.md`, `CHANGELOG.md` (Phase 1 Step 1 codebase analysis + handoff package).
- `docs/PROJECT_ARCHITECTURE.md` + `docs/KNOWN_ISSUES.md` to complete the project memory set
  required by `.claude/CLAUDE.md`. `HANDOFF.md` now records branch / last commit / next action.

### Added — Drawing toolbar overhaul (IN PROGRESS, unwired)
- `types/drawing.ts`: new tools (channel, brush, measure, long, short, emoji, eraser,
  crosshair) and per-drawing `zIndex/locked/visible/stop/target`.
- `store/chartStore.ts`: `duplicateDrawing, lockDrawing, hideDrawing, bringToFront, sendToBack,
  toggleLockAll, toggleHideAll` + `drawingsLocked/drawingsHidden`; `addDrawing` now assigns
  `zIndex/visible/locked`.
- `components/chart/drawing/drawingRenderer.ts`: pure renderer for all drawing types incl.
  position RR boxes and the measure overlay. **Not yet wired into `DrawingLayer`.**

### Added — Chart right-click context menu
- `components/chart/ChartContextMenu.tsx` (portal, viewport-clamped, Esc/outside-close, arrow
  nav), wired in `PriceChart` via `coordinateToPrice`/`coordinateToTime`.
- `store/alertStore.ts` + `components/chart/AlertLines.tsx` (alert price lines).
- `utils/bus.ts`: `trade:prefill` event; `OrderTicket` consumes it. `types/trade.ts`:
  `OrderPrefill`. Menu actions: create alert, sell-limit, buy-stop, add-order, draw hline.
- Replaced broken `framer-motion` usage with a CSS pop-in animation.

### Added — Replay bar-selection
- `replayStore`: `selecting` + `beginSelect/cancelSelect`.
- `components/replay/ReplaySelectionLayer.tsx`: TradingView-style click-to-pick start bar
  (snapping cursor, disables chart pan/zoom while selecting, Esc cancels).

### Fixed
- Indicator menu: clicking an enabled indicator now **toggles it off** (`toggleIndicator`),
  previously add-only (duplicated series).
- SMC overlay coordinate mapping: always resolve via `timeToCoordinate`; bound to `timeScale
  .width()` (excludes price axis) — fixes "compressed at right" + label overlap. Added
  `window.__SMC_DEBUG__` trace.
- SMC menu reactivity: forced rAF redraw on settings change; added missing **displacement**
  render path.
- `IndicatorPane`: guard against double-free of series on unmount (chart already disposed).
- ADR indicator: emit empty data instead of `time:0` duplicate points (fixed Lightweight Charts
  "data must be asc ordered by time" assertion).
- Hydration: stores now init with deterministic SSR-safe defaults and hydrate post-mount;
  terminal loaded via `dynamic(ssr:false)`.

### Changed — Chart UI redesign (TradingView dark)
- `chartTheme.ts`/`PriceChart.tsx`: `#131722` background, subtle grid, dashed crosshair +
  floating labels, colored last-price line, time/price scale styling, interaction options.
- Toolbar: symbol header (ticker + contract tag + exchange via `services/exchange.ts`),
  segmented timeframes, `ChartSettingsMenu` (grid/theme/reset). SMC labels as chips + price tags.

## [0.1.0] — Initial build (Modules 1–6)
- M1 Architecture: Next 15 + TS + Tailwind, typed domain models, IndexedDB/localStorage,
  resizable terminal shell, theme system.
- M2 Chart engine + mock market data (seeded generator), indicators, drawings, watchlist,
  toolbars.
- M3 Replay engine (no look-ahead), controls, dashboard, hotkeys, multi-timeframe.
- M4 SMC engine (structure/FVG/OB/liquidity/displacement/sessions) + Web Worker + overlay.
- M5 Trade simulator + risk panel + journal (screenshots, CSV/Excel).
- M6 Analytics dashboard (equity/drawdown/distribution/monthly) + README.
