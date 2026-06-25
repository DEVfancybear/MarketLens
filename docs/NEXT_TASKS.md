# NEXT TASKS

## Current status

- **✅ Phase 1 — Realtime Market Data Foundation: COMPLETE (Steps 1–17).**
- **✅ Phase 2 — Alert Engine: COMPLETE** (engine + notifications + Alert Center + audit + Phase 2.1
  interactive chart alerts).
- **✅ OANDA Integration: COMPLETE** (forex/metals/indices via OANDA v20 REST; fallback to
  TwelveData; extension points for FxcmProvider + ICMarketsProvider).
- **✅ Phase 3–11 Master Plan: COMPLETE** — `docs/PHASE3_11_PLAN.md`.
- **▶ Phase 3.1 — TradingView UI Parity (Layout System): NEXT.**

## Immediate tasks — Phase 3.1 (Layout System)

Per the updated roadmap; see `docs/PHASE3_11_PLAN.md` for full detail.

1. **Tighten toolbar dimensions** — top toolbar `h-9` (36px), left rail `40px`, panel header `h-8` (32px).
2. **Upgrade BottomPanel tabs** — TradingView-style tab strip with accent underline indicator.
3. **Add loading overlay** — chart area already has `Loader2` spinner when `chartStore.loading` is true.
4. **Responsive pass** — verify layout at 375px, 768px, 1024px breakpoints.

## Phase 3.2 — Chart Styling

1. **Dynamic bar spacing** — per-timeframe spacing (1m: 4, 5m: 6, 15m: 8, 1H: 10, 4H: 12, 1D+: 14).
2. **Thinner wicks** — set `wickWidth` on candlestick series.
3. **Solid last-price line** — change `priceLineStyle` from 2 (dashed) to 0 (solid).
4. **Refine grid opacity** — match TradingView's `#1e222d` grid.

## Phase 3.3 — Price Scale UX

1. **Symbol+TF overlay** — top-left chart overlay showing "SYMBOL, TF".
2. **Bar countdown timer** — countdown to next bar close.
3. **Price label color** — red/green by candle direction.

## Phase 3.4 — Watchlist Upgrade

1. **Hover states** — `hover:bg-terminal-hover` on rows.
2. **Active row indicator** — left-border accent + highlight.
3. **Watchlist context menu** — right-click: Remove, Create Alert.
4. **Compact rows** — `h-7` (28px) to match TradingView.

## Phase 3.5 — Context Menus

1. **Chart context menu polish** — separators between action groups.
2. **WatchlistContextMenu** — created in 3.4.

## Phase 3.6 — Keyboard Shortcuts

1. **Ctrl+A** — select all drawings (Phase 4 scope, add handler now).
2. **Alt+A** — toggle alert center.
3. **`?`** — show keyboard shortcuts overlay (optional).

---

## Later phases (from PHASE3_11_PLAN.md)

- **Phase 4 — Drawing Engine:** wire `drawingRenderer.ts`, expand toolbar to 17 tools, hit-test,
  DrawingContextMenu, hotkeys.
- **Phase 5 — Left Toolbar:** full 17-tool TradingView toolbar with visual grouping.
- **Phase 6 — Indicator Engine:** settings dialogs, parameter customization.
- **Phase 7 — Push Notifications:** Firebase Cloud Messaging.
- **Phase 8 — MT5 Integration:** MT5 Bridge Service.
- **Phase 9 — Trading Panel:** TradingView-style order panel.
- **Phase 10 — Position Visualization:** interactive entry/SL/TP lines.
- **Phase 11 — Polish & Optimization:** performance, memory, mobile, accessibility.
