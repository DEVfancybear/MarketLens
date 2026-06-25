# NEXT TASKS

## Current status

- **✅ Phase 1 — Realtime Market Data Foundation: COMPLETE (Steps 1–17).**
- **✅ Phase 2 — Alert Engine: COMPLETE** (engine + notifications + Alert Center + audit + Phase 2.1
  interactive chart alerts).
- **✅ OANDA Integration: COMPLETE** (forex/metals/indices via OANDA v20 REST; fallback to
  TwelveData; extension points for FxcmProvider + ICMarketsProvider).
- **✅ Phase 3 — TradingView UI Parity: COMPLETE** (90% visual, 85% interaction).
  16 files modified, 2 created. See `docs/TRADINGVIEW_PARITY_REPORT.md`.
- **▶ Phase 4 — Drawing Engine: NEXT.** Wire the unwired `drawingRenderer.ts`, expand
  toolbar to 17 tools, add DrawingContextMenu, hit-test module, and drawing hotkeys.
  See `docs/PHASE3_11_PLAN.md` §Phase 4.

## Immediate tasks — Phase 4 (Drawing Engine)

Per `docs/PHASE3_11_PLAN.md` §Phase 4:

1. **Wire the renderer** — replace DrawingLayer's inline renderDrawing() with the
   pre-written `drawingRenderer.ts` (already supports all 17 tools).
2. **Wire drawing actions** — `duplicateDrawing/lockDrawing/hideDrawing/bringToFront/
   sendToBack/toggleLockAll/toggleHideAll`.
3. **Expand toolbar** — from 7 tools to full 17-tool set (channel, brush, measure,
   emoji, eraser, crosshair, long, short).
4. **Create hit-test module** — `drawingHitTest.ts` for per-drawing pointer detection.
5. **Create DrawingContextMenu** — right-click: Edit, Clone, Lock, Hide, Delete, Z-order.
6. **Drawing hotkeys** — Delete (remove), Esc (deselect), Ctrl+D (duplicate).

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
