# NEXT TASKS

## Current status

- **✅ Phase 1 — Realtime Market Data Foundation: COMPLETE (Steps 1–17).**
- **✅ Phase 2 — Alert Engine: COMPLETE** (engine + notifications + Alert Center + audit + Phase 2.1
  interactive chart alerts).
- **✅ OANDA Integration: COMPLETE** (forex/metals/indices via OANDA v20 REST; fallback to
  TwelveData; extension points for FxcmProvider + ICMarketsProvider).
- **✅ Phase 3 — TradingView UI Parity: COMPLETE** (90% visual, 85% interaction).
  16 files modified, 2 created. See `docs/TRADINGVIEW_PARITY_REPORT.md`.
- **✅ Phase 4.1 — Drawing Engine Foundation: COMPLETE.**
- **✅ Phase 4.2 — Trend Line Suite: COMPLETE** (8 line tools + DrawingContextMenu + styles).
- **✅ Phase 4.2.1 — Tool Activation: COMPLETE** (state machine, cursor system, live preview).
- **✅ Phase 4.2.2 — Tool Group System: COMPLETE** (4 grouped icons + flyout portal fix).
- **✅ Phase 4.3 — Shape Tools Suite: COMPLETE** (8 shapes + fill + supply/demand zones).
- **✅ Phase 4.4 — Fibonacci Suite: COMPLETE** (fibRetracement + fibExtension,
  plugin architecture, 2-point creation, auto-levels with labels, full hitTest/movePoints/boundingBox).
- **✅ Phase 5 — Left Toolbar / Indicator Engine: COMPLETE** (see below).
- **✅ Jotai migration — COMPLETE** (all 11 stores converted to atoms, Zustand removed).

## Completed — Phase 5 (Left Toolbar / Indicator Engine)

1. Full 17+ tool TradingView left toolbar with 9 visual groups and separators.
2. Indicator settings dialogs with parameter customization (SMA/EMA length, RSI period, etc.).
3. Indicator style customization (colors, line width, overlay vs. pane).
4. Hotkey system for drawing tools and indicators (1–9 switch tools, Delete, Ctrl+D, Ctrl+A, Ctrl+I, etc.).

---

## Next milestone - Phase 6

Detailed code plan: `docs/PHASE6_IMPLEMENTATION_PLAN.md`.

- **Phase 6A - Push Notifications:** Firebase Cloud Messaging as the next alert delivery channel,
  including closed-browser delivery through `npm run push-worker`. Implemented in
  `docs/PHASE6A_PUSH_NOTIFICATIONS.md`.
- **Phase 6A extension - Telegram/Discord Alert Channels:** server-side external message delivery
  for browser-open and closed-browser alerts. Implemented in
  `docs/PHASE6A_TELEGRAM_DISCORD_PLAN.md`.
- **Phase 6B - MT5 Bridge Integration:** feature-flagged scaffold implemented: MT5 protocol types,
  WebSocket client, store/runtime hook, mock bridge, execution-mode UI, order routing, MT5
  positions/logs, and simulator fallback. FTMO dry-run bridge is now implemented via
  `npm run ftmo-mt5-bridge`; it validates/audits order intents and simulates bridge-confirmed fills
  while live execution remains blocked until a real MT5 adapter is added. Next: connect the FTMO
  bridge to MT5 terminal snapshots and MT5 `order_check`, then demo execution. For Exness,
  IC Markets, and other MT5 brokers, use `docs/PHASE6B_MULTI_BROKER_MT5_COPY_TRADING_PLAN.md`.

---

## Later phases (from PHASE3_11_PLAN.md)

- **Phase 6 - Push Notifications + MT5 Integration:** see `docs/PHASE6_IMPLEMENTATION_PLAN.md`.
- **Phase 8 — Trading Panel:** TradingView-style order panel.
- **Phase 9 — Position Visualization:** interactive entry/SL/TP lines.
- **Phase 10 — Polish & Optimization:** performance, memory, mobile, accessibility.
