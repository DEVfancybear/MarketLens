# CURRENT PROGRESS

_Last updated: 2026-06-28 (Zustand → Jotai migration)_

## Current phase / milestone
- **✅ Phase 1 — Realtime Market Data Foundation — COMPLETE (Steps 1–17).**
- **✅ Phase 2 — Alert Engine — COMPLETE** (+ audit + Phase 2.1 interactive chart alerts).
- **✅ OANDA Integration — COMPLETE** (forex/metals/indices realtime + historical data).
- **✅ Phase 3 — TradingView UI Parity — COMPLETE** (visual ~95%, interaction ~87%).
- **✅ Phase 4.3 — SHAPE TOOLS SUITE — COMPLETE.**
- **✅ Phase 4.2.2 — TOOL GROUP SYSTEM — COMPLETE** (flyout portal fix).
- **✅ Phase 4.4 — FIBONACCI SUITE — COMPLETE.**
- **✅ Drawing engine stabilization — COMPLETE** (see below).
- **✅ Phase 5 — Left Toolbar / Indicator Engine — COMPLETE** (see below).
- **✅ Jotai migration — COMPLETE** (all 11 stores converted, Zustand removed).
- **Next milestone: Phase 6 — Push Notifications / MT5 Integration.**

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

### Phase 5 — Left Toolbar / Indicator Engine (2026-06-28)

1. **Indicator Settings Dialog:** `IndicatorSettingsDialog.tsx` — modal for customising indicator
   parameters (type, length/slow/signal, colours, overlay vs separate pane, visible toggle, remove).
   Opened via gear icon on indicator panes or from the Indicator menu.

2. **Hotkey system:** Extended `useHotkeys.ts` with drawing shortcuts: 1–9 for tool switching,
   Delete/Backspace for remove, Ctrl+D duplicate, Ctrl+A select all, Ctrl+Z undo guard,
   Ctrl+I toggle SMA, Escape deselect/cancel. Existing replay/trade shortcuts preserved.

3. **Left toolbar organisation:** Split into 9 tool groups (mode, trend lines, horizontals,
   shapes, freeform, fibonacci, positions, annotations) with proper separators. Added
   missing tools: channel, fib (legacy), emoji, long, short, brush, crosshair, eraser.

4. **IndicatorMenu enhancements:** Shows active indicators list with colour dots and
   settings gear; "Remove all indicators" action; clicking a toggle-open indicator opens
   settings dialog.

5. **IndicatorPane gear icon:** Settings gear next to indicator name opens the settings dialog.

6. **Left rail width:** Increased from 40px to 52px to accommodate the expanded toolbar.

### Summary of files changed (this session)
- `IndicatorSettingsDialog.tsx` — NEW: indicator parameter customisation modal
- `useHotkeys.ts` — extended with drawing + indicator keyboard shortcuts
- `DrawingToolbar.tsx` — 9 groups, 25+ tools, missing tools added
- `IndicatorMenu.tsx` — active indicators list, settings gear, remove all
- `IndicatorPane.tsx` — settings gear icon on indicator header
- `chartStore.ts` — `editingIndicatorId` + `setEditingIndicator` state
- `uiStore.ts` — left panel width 40 → 52px
- `Terminal.tsx` — wired IndicatorSettingsDialog + useHotkeys
- `docs/` — CURRENT_PROGRESS.md updated

## Build & quality status
- `npm run type-check` → ✅ PASS
- `npm run lint` → ✅ PASS (0 warnings)
- `npm run build` → ✅ PASS
- TODO/FIXME/HACK in `src/` → **0**

### Zustand → Jotai migration (2026-06-28)

All 11 Zustand stores replaced with Jotai atoms. ~60 consumer files updated.
Each store now exports individual atoms + write atoms for fine-grained subscriptions.
`zustand` package removed from dependencies.

Key patterns:
- `useStore((s) => s.field)` → `useAtomValue(fieldAtom)`
- `useStore((s) => s.action)` → `useSetAtom(actionAtom)`
- `useStore.getState()` → `getDefaultStore().get/set(atom)`

### Jotai hydration fix (2026-06-28)

**Infinite re-render loop in `GlobalRuntime`:** Fixed by replacing
`useAlertStore((s) => s.hydrate)` with `useSetAtom(hydrateAtom)`. The
compatibility `useXStore(selector)` hook reads all atoms and creates new
function references on every render — in a `useEffect` dependency array,
this causes the effect to re-fire after `hydrate()` mutates atoms, creating
an infinite loop. `useSetAtom` returns a stable function reference that
never changes. Pattern to avoid: never destructure action functions from
`useXStore(selector)` if they're used as `useEffect` dependencies.

## Remaining known issues
- Context menu bypasses undo history (DrawingContextMenu calls store directly)
- `framer-motion` broken (unused)

## Not started (later phases)
- Phase 6 — Push Notifications / MT5 Integration
