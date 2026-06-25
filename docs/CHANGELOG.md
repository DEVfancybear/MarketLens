# CHANGELOG

All notable changes to the SMC Trading Terminal. Dates are UTC.

## [Unreleased]

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
