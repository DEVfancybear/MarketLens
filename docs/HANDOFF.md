# HANDOFF

_Engineer handoff for the SMC Trading Terminal. Last updated 2026-06-30 (Drawing toolbar Settings hexagon + Style Templates — plan §1/§2)._

You are taking over a **TradingView/FXReplay/TradeZella-style** web terminal for Smart Money
Concept backtesting. **All 11 Zustand stores have been migrated to Jotai atoms** for fine-grained
render optimisation — components subscribe only to the atoms they need via `useAtomValue`/`useSetAtom`.
`zustand` has been removed from dependencies. It is feature-rich and builds clean. **Phase 1 (realtime market data) and Phase 2 (alert engine) are
both COMPLETE, along with the OANDA integration.** The watchlist, chart, and replay MTF panel all stream live (Binance crypto with no
API key; forex/metals/indices via OANDA with a bearer token, or TwelveData as fallback); **there is no mock data anywhere**
(`services/marketData.ts` deleted). Phase 2 adds a TradingView-style alert engine (above/below/
crosses), toast + browser + sound notifications, a responsive Alert Center, and **interactive chart
alerts** (Phase 2.1 — select / drag-to-reprice / delete / edit / right-click + long-press).
**Phase 3 (TradingView UI Parity) is COMPLETE** — 95% visual parity.
**Phase 4.3 (Shape Tools Suite) is COMPLETE** — 8 shapes + fill system + supply/demand zones.
**Phase 4.2.2 (Tool Group System) is COMPLETE** — flyout menus fixed via `createPortal`.
**Phase 4.4 (Fibonacci Suite) is COMPLETE** — fib retracement + fib extension drawing tools.
**Phase 5 (Left Toolbar / Indicator Engine) is COMPLETE** — 9-group toolbar, indicator settings dialogs, hotkey system.
The next milestone is **Phase 6 — Push Notifications / MT5 Integration**. Phase 6A push
notifications are implemented, including closed-browser delivery when `npm run push-worker` (or a
cron calling `/api/push/evaluate`) runs next to the Next server. Continue with Phase 6B MT5 Bridge
from `docs/PHASE6B_MT5_BRIDGE_PLAN.md`.

Read in this order: `PROJECT_ARCHITECTURE.md` / `ARCHITECTURE.md` → `CURRENT_STATE.md` →
`NEXT_TASKS.md` → `KNOWN_ISSUES.md`.

## Repo state
- **Branch:** `master`
- **Remote:** `origin → https://github.com/DEVfancybear/tradingview.git`
- **Phase 1 progress:** **COMPLETE — Steps 1–17 ✅.** Realtime watchlist + chart + replay MTF,
  switch hardening, connection badge, reconnect hardening (watchdog + online recovery), perf pass,
  and the **last mock deleted**. **The chart streams live** (history via REST + realtime klines).
  Reconciliation chosen: `chartStore` stays the chart's selection + candle source
  (drawings/indicators/tool too); `useMarketData` bridges it to `marketDataStore` (select → history
  → mirror candles). `useVisibleCandles` replay gate intact. `selectMarket()` is idempotent so
  the active kline is always (re)asserted on the active key.
- **Phase 2 progress:** **COMPLETE ✅** (engine + audit + Phase 2.1). `alertStore`
  (alerts/triggeredAlerts/history/settings + `selectedAlertId`/`editingAlertId`), pure
  `services/alertEngine.ts`, `hooks/useAlertEngine.ts` (mounted in `GlobalRuntime`; evaluates off
  `marketDataStore` with reference-counted ticker subs — no polling, no new sockets), toast +
  browser + sound notifications, responsive `AlertCenter` (toolbar bell). `marketDataStore`
  subscriptions are now refcounted (`subRefs`). Audited in `PHASE2_REVIEW.md` / `PHASE2_GAPS.md`.
- **Phase 2.1 (interactive chart alerts):** `AlertOverlay` (replaces deleted `AlertLines`) — canvas
  lines + DOM hit strips give **hover / select / drag-to-reprice / delete / right-click + touch
  long-press**; `AlertContextMenu` (Edit/Clone/Disable/Delete), `AlertEditDialog`. `Alert` gained
  `enabled`+`locked`; the engine skips disabled alerts. Selection is ephemeral; price/enabled/locked
  persist. See `docs/ALERT_ARCHITECTURE.md` §"Interactive chart alerts".
- **Phase 4.4 (Fibonacci Suite):** `FibRetracementTool` (2-point, retracement levels 0–1,
  dashed anchor trend line, % + price labels) + `FibExtensionTool` (2-point, extension levels
  -0.272–2.618 projected from B via A→B impulse). Both registered in `adapters.ts`, exposed
  in Shapes flyout. Legacy `fib` tool + `FibTool` plugin retained for backward compat.
  `FIB_EXT_LEVELS` added to `types/drawing.ts`.
- **Drawing engine stability fixes (2026-06-26):** Ctrl+D duplicate bug fixed (empty-id
  corruption eliminated), store now guards against empty IDs + deep-copies points, explicit
  pointer capture release added, adapter resolution during drag fixed, drag operations now
  undoable via commitMove. See `CURRENT_PROGRESS.md` for details.
- **Phase 5 (Left Toolbar / Indicator Engine):** `DrawingToolbar` reorganised into 9 tool groups
  (mode, trend lines, horizontals, shapes, freeform, fibonacci, positions, annotations) with
  25+ tools. `IndicatorSettingsDialog` modal for customising indicator type, length(s), colours,
  pane assignment, and visibility. `IndicatorMenu` shows active indicators with settings gear and
  remove-all action. `IndicatorPane` shows settings gear. `useHotkeys` extended with drawing
  shortcuts (1–9 tool switch, Delete, Ctrl+D duplicate, Ctrl+A select all, Ctrl+I toggle SMA,
  Escape deselect/cancel). Left rail width increased 40->52px. See `CURRENT_PROGRESS.md`.
- **Position settings dialog (updated 2026-07-01):** `chart/PositionSettingsDialog.tsx` is a
  TradingView-style Inputs/Style/Visibility modal for the long/short tool, opened via the gear
  on the floating drawing toolbar (`editingDrawingIdAtom` / `setEditingDrawingAtom`, mounted in
  `Terminal`). Inputs cover account size/currency (including Default), lot size, risk (%/amount),
  entry, leverage, profit & stop (ticks+price), qty precision, with a live Qty/Risk/Profit/RR
  summary. Style now matches the TradingView reference: Lines picker, Stop color, Target color,
  Text color/font size, Price labels, Stats multi-select, Compact stats mode, and Always show
  stats. `Drawing` now includes the position account/risk fields plus `stopColor`, `targetColor`,
  `positionStats`, `compactStats`, and `alwaysShowStats`; `PositionTool` applies line style,
  colors, text style, and selected stats on-canvas. See `CHANGELOG.md`.
- **Long/Short position tool (2026-06-28):** Rebuilt TradingView-style in `PositionTool.ts`
  (replaces the old `LongPositionTool`/`ShortPositionTool`). Points-based geometry
  (`[0]=entry, [1]={rightEdge,target}, [2]={rightEdge,stop}`) so the drag engine moves it.
  `chartStore.addDrawingAtom` auto-expands a single click into a default box (±1%, 2:1 R/R,
  ~20-bar width from candle interval). Green profit / red risk zones, entry/target/stop lines,
  and labels (prices, %, R/R). Target handle = `p1`, stop handle = `p2` (both set right-edge
  time); body/entry drag moves all. `long`/`short` removed from `SINGLE_CLICK_TOOLS` so they
  return to cursor after placement. See `CHANGELOG.md`.
- **Floating drawing settings toolbar (2026-06-28):** Selecting a drawing pops a
  TradingView-style floating toolbar (`chart/DrawingSettingsToolbar.tsx`, mounted in
  `DrawingLayer`) with inline stroke colour / fill / line width / line style / clone / lock /
  delete. **It now defaults to the chart's top-centre (not pinned next to the object) and is
  draggable via a `GripVertical` handle — the dragged position is kept (clamped) until the
  selection clears (2026-06-28 bug pass).** `DrawingInteractionManager` ignores pointer events
  over `[data-drawing-toolbar]` (`isOverDrawingUI`) so clicks don't deselect/drag. See `CHANGELOG.md`.
- **Position/drawing-tool bug pass (2026-06-28):** (1) settings toolbar draggable + top-pinned;
  (2) Long/Short tool highlights the profit/risk zone when price reaches target/stop
  (`PositionTool.ts` reads `candlesAtom`; `DrawingLayer` force-repaints per tick only when a
  position tool exists; `RenderLoop.markDirty(force?)`); (3) `DrawingLayer.fromEvent` extrapolates
  time in chart whitespace so dragging (esp. rectangles at the right edge) no longer stalls. See
  `CHANGELOG.md` / `KNOWN_ISSUES.md`.
- **Line suite parity (2026-06-28):** Added the **`trendAngle`** tool (`TrendAngleTool.ts`) —
  a 2-point line that always renders its screen angle in degrees (dashed baseline + sweep arc +
  degree chip), matching TradingView's "Trend angle". The plain `trendline` now shows a stats
  chip (price change / % / angle°) while drawing + when selected. New `angleDeg()`/`angleArc()`
  helpers in `plugins/shared.ts`. The toolbar **LINES** group was consolidated to mirror
  TradingView's LINES menu (Trend line, Ray, Info line, Extended line, Trend angle, Horizontal
  line, Horizontal ray, Vertical line, Cross line, Channel) with inline hotkey labels, and
  Alt+T/H/J/V/C hotkeys were added. See `CHANGELOG.md`.
- **Jotai migration (2026-06-28):** All 11 Zustand stores (`create()`) replaced with Jotai
  atoms (`atom()`). Each store module now exports individual state atoms, write atoms for
  actions, a backward-compatible `useXStore()` hook, and a `getXState()` non-React accessor.
  Components use `useAtomValue`/`useSetAtom` for fine-grained subscriptions — updating
  `candlesAtom` no longer re-renders `TopToolbar`, `DrawingToolbar`, or other unrelated
  components. `zustand` removed from dependencies. See `ARCHITECTURE.md` for full details.
- **Drawing toolbar parity (2026-06-30):** floating `DrawingSettingsToolbar` gained a
  **⬡ Settings** button for every object (new `ObjectSettingsDialog` — Style/Coordinates/
  Visibility tabs by family; long/short keeps `PositionSettingsDialog`) and a **▦ Templates**
  popover (global, family-scoped, style-only presets — `DrawingTemplate` +
  `saveTemplateAtom`/`applyTemplateAtom`/`deleteTemplateAtom`, persisted under
  `drawingTemplates`). `CanvasRenderer.drawingsHash()` now folds in style fields so edits
  repaint immediately. Plan §3 (Anchor) intentionally deferred — needs viewport dims in the
  hit-test pipeline. See `docs/DRAWING_TOOLBAR_PLAN.md`. (Plan §4 More was already shipped.)
- **Closed-browser push — Binance geo-block fix (2026-07-01):** cron-job.org-triggered
  `/api/push/evaluate` runs were skipping every crypto alert with "price unavailable" and no
  `errors` entry. Cause: `pushAlertEvaluator.ts`'s `fetchBinancePrice` called `api.binance.com`,
  which returns HTTP 451 for requests from US-hosted server IPs (Vercel serverless), and the
  failure was swallowed instead of surfaced. Fixed by switching to `data-api.binance.vision`
  (Binance's unrestricted market-data mirror) and making fetch/parse failures throw so they land
  in the evaluation's `errors` array. See `KNOWN_ISSUES.md` Workarounds.
- **Recommended next action:** Start **Phase 6B — MT5 Bridge Integration** from
  `docs/PHASE6B_MT5_BRIDGE_PLAN.md`. Phase 6A push docs:
  `docs/PHASE6A_PUSH_NOTIFICATIONS.md`.
- **OANDA diagnostics:** **DEBUG LOGGING ADDED** — `MarketDataService` and `OandaProvider` now log
  key presence, routing decisions, subscription attempts, and API call results to the console. Open
  the browser console to see why forex symbols show "--". See `docs/OANDA_DEBUG_REPORT.md`.
- **OANDA Integration:** **COMPLETE ✅** — forex/metals/indices via OANDA v20 REST (pricing poll +
  historical), fallback to TwelveData. Fxcm/ICMarkets stubs in place.
- **Runtime:** `npm run dev` → BTCUSDT chart + watchlist stream live from Binance (no key).
  OANDA (forex/metals/indices) needs `NEXT_PUBLIC_OANDA_API_KEY` + `NEXT_PUBLIC_OANDA_ACCOUNT_ID`
  in `.env.local`; TwelveData is the fallback for those symbols.
- **Mock status:** **none.** The chart, watchlist, and replay multi-timeframe panel are all
  realtime. The mock generator `services/marketData.ts` has been deleted (Step 17).

---

## 1. Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run type-check   # tsc --noEmit
npm run lint         # next lint
```
- Node 18+ (built/verified on Node 24, npm 11, Windows). Next 15.3.9, React 19.
- **Windows build note:** Next's page-data worker occasionally fails with
  `Cannot find module './<chunk>.js'` / `/_not-found` during "Collecting page data". This is a
  known Next-on-Windows race (the project sits under `Downloads`, which AV/sync tools watch),
  **not** a code error — re-run `npm run build` once (warm chunks) and it passes.

## 2. Current status (verified 2026-06-28)
- type-check ✅ · lint ✅ (0 warnings) · build ✅ · no TODO/FIXME markers.

## 3. Existing architecture (1-minute version)
- Browser-only Next app; the whole terminal is a `dynamic(ssr:false)` client chunk.
- **11 Jotai atom modules** (`ui`, `chart`, `replay`, `smc`, `trade`, `journal`, `analytics`, `watchlist`, `alert`, `marketData`, `toast`). Each exports individual `atom()` primitives, write atoms for actions, and a backward-compatible `useXStore(selector?)` hook. The realtime feed has its own single-source-of-truth `marketDataStore`; the chart's selection + candle series live in `chartStore` and are bridged from `marketDataStore` by `useMarketData`.
- Chart = Lightweight Charts + **canvas overlays** (SMC, drawings, replay picker, alerts) that
  project (time,price)→pixels and repaint on `ChartContext.version`.
- **`useVisibleCandles()` is the single visibility gate** — the no-look-ahead replay guarantee;
  it reads from `candlesAtom` (realtime master series, Jotai atom).
- Pure domain engines (indicators, SMC, trade, analytics) consume only the candle array → safe.

## 4. Realtime market data — current implementation (Phase 1 COMPLETE, Steps 1–17)
Live pipeline: `provider → MarketDataService → marketDataStore → hooks → UI`.
- **Types** `src/types/marketData.ts` (unified `MarketQuote/MarketCandle/MarketSymbol/
  ConnectionStatus/Timeframe` + events/consts).
- **Store** `src/store/marketDataStore.ts` — quotes/candles/selection/status/subscriptions;
  `updateCandle` does the TradingView-style forming-bar upsert; `selectMarket()` (chart) and
  `subscribe/unsubscribe` (watchlist).
- **Providers** `services/market-data/providers/` — `BinanceProvider` (one combined WS, kline +
  ticker + miniTicker, backoff reconnect + auto-resubscribe) and `TwelveDataProvider` (price WS,
  forex/metals/indices). Both implement `MarketDataServiceBinding`.
- **Orchestration** `MarketDataService.ts` (routes via `symbols.ts` registry, fans events into
  the store, aggregates status; `getMarketDataService()` attaches) + `HistoricalDataService.ts`
  (REST 500–5000 bars, paginated) + `CandleEngine.ts` (builds candles from tick-only feeds).
- **Hooks** `useCandles/useQuote/useConnectionStatus/useMarketDataFeed` (read-only) +
  `useMarketDataBootstrap` (subscribes watchlist tickers, mounted in `GlobalRuntime`) +
  `useMarketData` (chart: select → history → mirror candles into `chartStore`).
- **Connection badge** `components/toolbar/ConnectionBadge.tsx` (Step 14) — 🟢/🟡/🔴 chip in the
  `TopToolbar` right group via `useConnectionMeta()`.
- **Reconnect (Step 15)** lives in the providers: backoff `1→2→5→10→30s`, infinite, auto-resubscribe
  on `onopen`; plus a dead-socket watchdog (recycle an OPEN-but-silent socket after 45s) and instant
  reconnect on `window 'online'`. Both SSR-guarded.
- **Perf (Step 16):** per-tick re-renders removed from non-candle consumers — `replayStore.setTotal`
  equality-guarded; `TopToolbar`/`DrawingToolbar`/`DrawingLayer` use atomic selectors (don't pull
  `candles`).
- **Remaining Phase 1:** none — Steps 1–17 done. Full plan + Phase 2 roadmap in `NEXT_TASKS.md`.
- **Still mock:** nothing — `services/marketData.ts` is deleted; replay MTF reads real higher-TF
  history via `useMtfSnapshotSeries` → `HistoricalDataService`.

## 5. TradingView features already completed
- ✅ **Realtime candles + watchlist** (Binance crypto no-key; TwelveData forex/metals/indices),
  TradingView dark theme, crosshair w/ floating labels, last-price line, incremental
  `series.update` for the forming bar.
- ✅ Indicators: SMA/EMA/VWAP/RSI/MACD/ADR (toggleable).
- ✅ Drawings: trend/horizontal/vertical/rectangle/text/fib (create/move/delete, persisted).
- ✅ Right-click chart context menu (alert / sell-limit / buy-stop / add-order / hline).
- ✅ Bar Replay with click-to-select start, transport, speeds, scrubber, jump-to-date, MTF.
- ✅ SMC suite (structure, FVG, OB, liquidity, displacement, sessions/kill-zones) off-thread.
- ✅ Trade simulator + risk panel + journal (screenshots, CSV/Excel) + analytics dashboard.
- ✅ **Alert engine (Phase 2)** — price above/below + crosses above/below, once-only/recurring,
  evaluated off `marketDataStore` (no polling/sockets), toast + browser + sound, responsive Alert
  Center (toolbar bell), persisted alerts + history. **Interactive chart alerts (2.1):** lines are
  selectable / draggable-to-reprice / deletable / editable, right-click + long-press menu, Delete/Esc
  keys, per-alert enable/lock. See `docs/ALERT_ARCHITECTURE.md`.
- ✅ Watchlist (add/remove/sort, realtime), symbol search (registry), timeframe switching, theme
  toggle, fullscreen, screenshot export, resizable panels.

## 6. Remaining / missing features
- ✅ **Phase 1 — Realtime Market Data Foundation: COMPLETE (Steps 1–17).** No mock data remains.
- ✅ **Phase 2 — Alert Engine: COMPLETE.** Triggering + toast/browser/sound + Alert Center.
- ✅ **OANDA Integration: COMPLETE.** Forex/metals/indices stream live via OANDA v20 REST
  (pricing poll + historical candles). Fallback to TwelveData. Extension points for Fxcm and
  ICMarkets providers.
- ✅ **Phase 4.4 — Fibonacci Suite: COMPLETE.** Fib retracement + fib extension drawing tools
  with full plugin support. Legacy `fib` tool retained for backward compatibility.
- ✅ **Phase 5 — Left Toolbar / Indicator Engine: COMPLETE.** 9-group toolbar (25+ tools),
  indicator settings dialog (type/length/colour/pane/visibility), hotkey system (1–9 switch,
  Delete, Ctrl+D, Ctrl+A, Ctrl+I, Escape).
- ❌ Real broker/MT5 order routing + Firebase mobile push (Phase 6 — alert dispatch seam ready in
  `services/notifications/notify.ts`).

## 7. Where to continue (Phase 6 — Push Notifications / MT5 Integration)
1. **Phase 6B — MT5 Bridge Integration.** Phase 6A Firebase push notifications are implemented in
   `docs/PHASE6A_PUSH_NOTIFICATIONS.md`. Continue real broker order routing from
   `docs/PHASE6B_MT5_BRIDGE_PLAN.md`.
2. Manual smoke test for Phase 2: open the toolbar **bell**, create `BTCUSDT crosses above <price>`
   and `BTCUSDT > <below-current>` — the latter fires immediately (level), the former on the next
   upward cross; confirm one toast + chime, the alert moves to Triggered, and a History row is added.
   Enable "Browser" to verify the system notification permission flow.

## 8. Known issues / gotchas
- **`framer-motion` is broken** in this install (`motion-dom` export mismatch). It is **not
  imported** anywhere (the context menu uses a CSS pop animation). If you need motion later,
  pin a matching `framer-motion`/`motion-dom` pair; otherwise consider removing it from
  `package.json`.
- **✅ Adapter resolution during drag — FIXED (2026-06-26):** Machine state now stores `drawingTool`
  from `hit.drawing.tool` during cursor-mode drag start. No more fallback to `"trendline"`.
- **✅ Ctrl+D duplicate — FIXED (2026-06-26):** `DuplicateDrawingCommand` generates its own valid
  `uid("dw")` internally — no double-create, no empty-id corruption. `chartStore.addDrawing()` now
  guards against empty/falsy IDs with `id: d.id || uid("dw")`.
- **✅ Drag operations undoable — FIXED (2026-06-26):** `commitMove` wired from `useCommandHistory`
  through to `DrawingInteractionManager.handleUp`, so drags are recorded as `MoveDrawingCommand`
  and Ctrl+Z can undo them.
- **✅ addDrawing deep-copies points — FIXED (2026-06-26):** `chartStore.ts` now does
  `d.points.map(p => ({...p}))` to eliminate shared-reference risk.
- **✅ Hit-test vocabulary — FIXED (2026-06-26):** All 25 drawing tools now return only canonical
  `"p1"`, `"p2"`, `"body"` targets. `HitTestEngine` type + `TARGET_PRIORITY` narrowed.
- **✅ Pointer capture release — ADDED (2026-06-26):** `DrawingInteractionManager` now explicitly
  releases pointer capture via `activePointerIdRef` in `handleUp`, `reset()`, and Escape paths.
  No more leaked captures blocking chart interaction.
- **✅ DrawingContextMenu restored (2026-06-26):** Moved `contextmenu` listener from canvas
  (blocked by `pointerEvents:"none"`) to document capture phase. Right-clicking a drawing now
  opens the drawing-specific context menu (Clone, Delete, Lock, Hide, Bring/Send).
- **Context menu bypasses undo history:** `DrawingContextMenu.tsx` calls store actions directly
  (`removeDrawing`, `duplicateDrawing`, etc.) without creating Command history. Keyboard
  equivalents (Delete, Ctrl+D) DO create history. Inconsistent undo behavior.
- **Drawing tools fully wired:** All drawing tools (line, shape, fib) use the production
  `DrawingToolPlugin` architecture via `ToolRegistry`. `renderDrawing` + `HitTestEngine` delegate
  through adapters. No giant switch statements remain. The old note about "unwired refactor" in
  previous handoffs is obsolete — the subsystem has been fully integrated and extended.
- **Legacy types may be orphaned:** with `services/marketData.ts` deleted, the legacy `Symbol` and
  `Quote` interfaces in `types/market.ts` may now be unused — verify with a grep before removing.
- **⚠ Jotai compat hook + useEffect danger:** The `useXStore(selector)` compatibility hooks
  (e.g. `useAlertStore((s) => s.hydrate)`) create **unstable function references** on every
  render because they recompute the state object from all atoms. Never use them in `useEffect`
  dependency arrays for actions that mutate atoms — it causes infinite re-render loops.
  **Fix:** use `useSetAtom(writeAtom)` directly for actions, as it returns a stable reference.
- **Git on Windows:** `git` is installed but not on PATH — invoke it by full path
  `C:\Program Files\Git\cmd\git.exe`. Repo `origin → github.com/DEVfancybear/tradingview` on
  branch `master`. `.claude/settings.local.json` is gitignored (machine-local).
- **Secrets:** keyed providers (TwelveData) must read from `.env.local` (gitignored). Never
  commit keys/tokens. (`.env`, `.env*.local` are gitignored; `.env.example` is the template.)

## 9. Useful entry points (files)
- Realtime feed: `services/market-data/{MarketDataService,HistoricalDataService,CandleEngine,
  symbols}.ts`, `services/market-data/providers/*`, `store/marketDataStore.ts`.
- Chart bridge / data: `hooks/useMarketData.ts` (chart), `hooks/useMarketDataBootstrap.ts`
  (watchlist feed), `hooks/{useCandles,useQuote,useConnectionStatus}.ts`, `store/chartStore.ts`.
- Chart: `components/chart/PriceChart.tsx`, `ChartContext.tsx`, `ChartArea.tsx`.
- Drawing subsystem: `components/chart/DrawingLayer.tsx`,
  `components/chart/drawing/drawingRenderer.ts`,
  `components/chart/drawing/hittest/HitTestEngine.ts`,
  `components/chart/drawing/tools/{ToolRegistry,adapters}.ts`,
  `components/chart/drawing/tools/plugins/{FibRetracement,FibExtension}Tool.ts` (Phase 4.4).
- Left toolbar + indicators (Phase 5): `components/toolbar/DrawingToolbar.tsx`,
  `components/toolbar/IndicatorMenu.tsx`, `components/toolbar/IndicatorSettingsDialog.tsx`,
  `components/chart/IndicatorPane.tsx`, `hooks/useHotkeys.ts`.
- Visibility gate: `hooks/useVisibleCandles.ts`.
- Watchlist: `components/watchlist/Watchlist.tsx`, `store/watchlistStore.ts`.
- Runtime loops: `components/layout/GlobalRuntime.tsx`.
- Replay MTF real-data path: `hooks/useMtfSnapshotSeries.ts` → `services/replayEngine.ts`
  (`mtfSnapshot`) → `components/replay/ReplayDashboard.tsx`.
- Alerts (Phase 2): `store/alertStore.ts`, `services/alertEngine.ts`, `hooks/useAlertEngine.ts`,
  `components/alerts/AlertCenter.tsx`, `store/toastStore.ts` + `components/notifications/Toaster.tsx`,
  `services/notifications/{notify,sound,browser}.ts`. Architecture: `docs/ALERT_ARCHITECTURE.md`.
- Interactive chart alerts (Phase 2.1): `components/chart/AlertOverlay.tsx` (canvas + DOM hit strips;
  replaces the deleted `AlertLines.tsx`), `components/chart/AlertContextMenu.tsx`,
  `components/alerts/AlertEditDialog.tsx`. Audit: `docs/PHASE2_REVIEW.md` / `docs/PHASE2_GAPS.md`.
