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
- **▶ Phase 4.4 — Fibonacci Suite: NEXT.**

## Immediate tasks — Phase 4.4 (Fibonacci Suite)

1. Implement Fibonacci retracement tool (draw from high→low or low→high, auto-levels at
   0, 0.236, 0.382, 0.5, 0.618, 0.786, 1).
2. Implement Fibonacci extension tool (three points, projects beyond 1.0).
3. Each level renders as a horizontal line with label; clickable/draggable for repricing.
4. Extend `types/drawing.ts` (add `fibRetracement`/`fibExtension` to DrawingTool).
5. Add `case` in `drawingRenderer.ts` and `drawingHitTest.ts`.

---

## Later phases (from PHASE3_11_PLAN.md)

- **Phase 5 — Left Toolbar:** full 17-tool TradingView toolbar with visual grouping.
- **Phase 6 — Indicator Engine:** settings dialogs, parameter customization.
- **Phase 7 — Push Notifications:** Firebase Cloud Messaging.
- **Phase 8 — MT5 Integration:** MT5 Bridge Service.
- **Phase 9 — Trading Panel:** TradingView-style order panel.
- **Phase 10 — Position Visualization:** interactive entry/SL/TP lines.
- **Phase 11 — Polish & Optimization:** performance, memory, mobile, accessibility.
