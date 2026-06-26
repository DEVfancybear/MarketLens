# CURRENT PROGRESS

_Last updated: 2026-06-26 (drawing engine stabilized)_

## Current phase / milestone
- **✅ Phase 1 — Realtime Market Data Foundation — COMPLETE (Steps 1–17).**
- **✅ Phase 2 — Alert Engine — COMPLETE** (+ audit + Phase 2.1 interactive chart alerts).
- **✅ OANDA Integration — COMPLETE** (forex/metals/indices realtime + historical data).
- **✅ Phase 3 — TradingView UI Parity — COMPLETE** (visual ~95%, interaction ~87%).
- **✅ Phase 4.3 — SHAPE TOOLS SUITE — COMPLETE.**
- **✅ Phase 4.2.2 — TOOL GROUP SYSTEM — COMPLETE** (flyout portal fix).
- **✅ Phase 4.4 — FIBONACCI SUITE — COMPLETE.**
- **✅ Drawing engine stabilization — COMPLETE** (see below).
- **Next milestone: Phase 5 — Left Toolbar / Indicator Engine.**

## Completed this session

### Drawing engine stabilization (2026-06-26)

1. **Ctrl+D duplicate bug (critical):** `DuplicateDrawingCommand` generates valid `uid("dw")` internally.
   `chartStore.addDrawing()` guards empty/falsy IDs. Eliminates cross-contamination from empty-id drawings.

2. **Store safety:** `addDrawing` deep-copies points, generates uid fallback for missing IDs.

3. **Right-click drag fix:** Added `e.button === 0` guard to cursor-mode `handleDown`. Right-clicks
   select drawings and open context menus without starting drag operations.

4. **DrawingContextMenu restored:** Moved `contextmenu` listener from canvas (blocked by
   `pointerEvents:"none"`) to document capture phase. Right-clicking a drawing now opens the
   drawing-specific menu (Clone, Delete, Lock, Hide, Bring, Send).

5. **Pointer capture release:** `activePointerIdRef` tracks captured pointer for explicit
   `releasePointerCapture()` on drag completion, Escape, and cancel paths.

6. **Adapter resolution:** Machine state stores `drawingTool` from `hit.drawing.tool` during
   drag start, eliminating `?? "trendline"` fallback.

7. **Undoable drags:** `commitMove` wired through to `handleUp`, recording `MoveDrawingCommand`.

8. **Render loop crash fix:** `CanvasRenderer` now checks `pr.length >= getTool(tool)?.minPoints`
   before injecting preview drawing. Prevents all 15 multi-point tools from crashing on partial
   previews (accessing `points[1]` when only 1 anchor exists).

9. **Drawing cancellation fix:** `handleUp`'s `releaseCapture`+`reset` moved back inside the
   `MovingDrawing`/`ResizingHandle` guard. Prevents cursor-mode pointerup from cancelling
   active drawing operations.

### Summary of files changed (this session)
- `CommandManager.ts` — DuplicateDrawingCommand fix
- `chartStore.ts` — empty-id guard, deep-copy points
- `DrawingLayer.tsx` — Ctrl+D fix, commitMove wiring
- `DrawingInteractionManager.ts` — button check, contextmenu fix, capture release, adapter fix, handleUp fix
- `CanvasRenderer.ts` — minPoints preview guard
- `useCommandHistory.ts` — ESLint fix
- `TrendLineTool.ts` — unchanged (bug was in renderer, not tool)
- `docs/` — CURRENT_PROGRESS.md, HANDOFF.md updated

## Build & quality status
- `npm run type-check` → ✅ PASS
- `npm run lint` → ✅ PASS (0 warnings)
- `npm run build` → ✅ PASS (Windows race intermittent)
- TODO/FIXME/HACK in `src/` → **0**

## Remaining known issues
- Context menu bypasses undo history (DrawingContextMenu calls store directly)
- Left toolbar unwired (Phase 5)
- Indicator settings dialogs (Phase 5)
- `framer-motion` broken (unused)

## Not started (later phases)
- Phase 5 — Left Toolbar / Indicator Engine
- Phase 6 — Push Notifications / MT5 Integration
