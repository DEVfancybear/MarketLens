# PHASE 4 — DRAWING ENGINE FOUNDATION ROADMAP

_Date: 2026-06-25. Architectural plan for TradingView-style drawing engine._

> Status: **historical roadmap, superseded by the current drawing engine**. Use
> `DRAWING_ENGINE_ARCHITECTURE.md`, `TOOL_REGISTRY.md`, `TOOL_GROUP_ARCHITECTURE.md`,
> `SHAPE_TOOLS_ARCHITECTURE.md`, `LINE_TOOLS_ARCHITECTURE.md`, and
> `POSITION_TOOL_ARCHITECTURE.md` for active maintenance. The audit tables below describe the
> pre-plugin state and are preserved only as implementation history.

## 1. Current state audit

### What already exists (✅ SHIPPED)

| Layer | Location | Status |
|---|---|---|
| **Drawing types** | `types/drawing.ts` | ✅ 17 tools defined, `Drawing` interface with `zIndex/locked/visible/stop/target` |
| **Store** | `store/chartStore.ts` | ✅ Full CRUD + `duplicate/lock/hide/bringToFront/sendToBack/toggleLockAll/toggleHideAll` |
| **Renderer (canonical)** | `components/chart/drawing/drawingRenderer.ts` | Historical pre-plugin renderer note; this roadmap is superseded by the current tool plugin architecture. |
| **Renderer (inline)** | `components/chart/DrawingLayer.tsx` | ✅ Active code. Handles 7 tools (trendline, horizontal, vertical, rectangle, text, fib, cursor). Has its own inline `renderDrawing()`, `hitTest()`, drag support. |
| **Toolbar** | `components/toolbar/DrawingToolbar.tsx` | ✅ 7 tools with icons, color picker, clear-all button |
| **Persistence** | `store/chartStore.ts` → `localStorage` | ✅ Drawings persisted per symbol via `drawings:<symbol>` key |
| **Interaction** | `DrawingLayer.tsx` | ✅ Canvas pointer events: create (single/double click), drag-move, Delete/Esc keys |

### What is dead code (🟡 unwired)

| Component | File | Notes |
|---|---|---|
| `renderDrawing` (17-tool version) | `drawingRenderer.ts` | Handles channel, brush, measure, emoji, long, short in addition to the 7 active tools. NOT imported by DrawingLayer. |
| `duplicateDrawing` | `chartStore.ts` | Action exists, no UI calls it |
| `lockDrawing` | `chartStore.ts` | Action exists, no UI calls it |
| `hideDrawing` | `chartStore.ts` | Action exists, no UI calls it |
| `bringToFront` / `sendToBack` | `chartStore.ts` | Actions exist, no UI calls them |
| `toggleLockAll` / `toggleHideAll` | `chartStore.ts` | Actions exist, no UI calls them |
| `drawingsLocked` / `drawingsHidden` | `chartStore.ts` | State exists, not read by DrawingLayer |

### What is missing (❌ not built)

| Component | Priority | Notes |
|---|---|---|
| DrawingContextMenu | 🔴 High | Right-click → Edit, Clone, Lock, Hide, Delete, Z-order |
| Drawing hit-test (modular) | 🔴 High | Currently inline in DrawingLayer; needs extraction for context menu + hotkeys |
| Drawing hotkeys (Ctrl+D, Ctrl+L) | 🟡 Medium | Delete/Esc exist; duplicate/lock missing |
| DrawingToolbar expansion | 🔴 High | 7 → 17 tools with visual groups |
| Drawing edit dialog | 🟡 Medium | For text/emoji/color/lineWidth editing |
| Touch/long-press support | 🟡 Medium | Pattern exists in AlertOverlay |
| New tool creation flows | 🟡 Medium | Channel (3-point), brush (freehand), measure (transient), long/short (entry+SL/TP) |

## 2. Architecture diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DRAWING ENGINE                                │
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────┐  │
│  │ Drawing Model │   │ Drawing Store│   │  Drawing Renderer       │  │
│  │ (types/draw-  │   │ (chartStore) │   │  (drawingRenderer.ts)   │  │
│  │  ing.ts)      │   │              │   │  Pure canvas, 17 tools   │  │
│  │              │   │ CRUD         │   │  Projects (time,price)   │  │
│  │ 17 tool types│   │ lock/hide    │   │  → pixels                │  │
│  │ zIndex/lock  │   │ z-order      │   │  Handles selection/      │  │
│  │ visible/stop │   │ persist/load │   │  hover styling           │  │
│  └──────┬───────┘   └──────┬───────┘   └────────────┬────────────┘  │
│         │                  │                          │               │
│         │         ┌────────┴────────┐                 │               │
│         │         │  Drawing Layer  │ ← reads drawings│               │
│         │         │  (DrawingLayer) │ ← calls store  │               │
│         │         │                 │ ← calls renderer│              │
│         │         │  pointer events │                 │               │
│         │         │  hit-test       │                 │               │
│         │         │  drag support   │                 │               │
│         │         └───────┬─────────┘                 │               │
│         │                 │                           │               │
│  ┌──────┴─────────────────┴───────────────────────────┴───────────┐  │
│  │                    Interaction Layer                            │  │
│  │                                                                  │  │
│  │  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │  │
│  │  │ DrawingToolbar │  │ DrawContextMenu│  │ Drawing Hotkeys  │  │  │
│  │  │ (17 tools)     │  │ (right-click)  │  │ (Del/Esc/Ctrl+D) │  │  │
│  │  │ tool selection │  │ edit/clone/    │  │                  │  │  │
│  │  │ color picker   │  │ lock/hide/     │  │                  │  │  │
│  │  │ mode toggles   │  │ delete/z-order │  │                  │  │  │
│  │  └────────────────┘  └────────────────┘  └──────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                      Tool Creation Flows                          │ │
│  │                                                                  │ │
│  │  Single-click tools: horizontal, vertical, text, emoji, long, short│ │
│  │  Two-point tools:   trendline, rectangle, fib                     │ │
│  │  Three-point tools: channel (2 main + offset)                     │ │
│  │  Freehand:          brush (pointer-move path recording)           │ │
│  │  Mode tools:        cursor (select/drag), crosshair, eraser,      │ │
│  │                     measure (transient readout)                   │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                      Persistence Layer                            │ │
│  │                                                                  │ │
│  │  localStorage key: drawings:<symbol>                              │ │
│  │  Schema: Drawing[] (JSON)                                         │ │
│  │  Triggers: addDrawing / updateDrawing / removeDrawing / clear     │ │
│  │  Hydrate: on chartStore.setSymbol() → load from localStorage      │ │
│  │  Symbol isolation: drawings keyed per symbol, never cross-loaded  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Tool categories

| Category | Tools | Creation pattern | Complexity |
|---|---|---|---|
| **Modes** (non-persisted) | cursor, crosshair, eraser, measure | Interaction mode only | Low |
| **Lines** | trendline, horizontal, vertical | Single or two-click | Low |
| **Channels** | channel | Three-click (2 main + offset) | Medium |
| **Shapes** | rectangle, fib | Two-click | Low |
| **Annotations** | text, emoji | Single-click + prompt/picker | Low |
| **Positions** | long, short | Single-click (entry), drag SL/TP | Medium |
| **Freehand** | brush | Pointer-move path recording | Medium |

## 4. Implementation phases

### Phase 4.1 — Wire the canonical renderer (~30 min)

**Goal:** Replace DrawingLayer's inline `renderDrawing()` (7 tools) with `drawingRenderer.ts` (17 tools). No behavior change.

**Steps:**
1. Import `renderDrawing` from `drawingRenderer.ts` into `DrawingLayer.tsx`
2. Build a `Projector` adapter: `{ toX, toY, width, height }` from existing helpers
3. Replace the inline renderDrawing function call with the imported one
4. Verify all 7 existing tools render identically (trendline, horizontal, vertical, rectangle, text, fib)
5. Delete the inline `renderDrawing` function (L173-286) and helper functions (`distToSegment`, etc.)
6. Keep the inline `hitTest` function (it's separate and not part of the renderer)

**Files:** `DrawingLayer.tsx` only. `drawingRenderer.ts` already works (import, no changes).

### Phase 4.2 — Wire drawing actions (~15 min)

**Goal:** Connect `duplicateDrawing`, `lockDrawing`, `hideDrawing`, `bringToFront`, `sendToBack` to the UI.

**Steps:**
1. Add selectors for all actions in `DrawingLayer.tsx`
2. Wire Delete key to respect `drawingsLocked` (don't delete locked drawings)
3. Wire drag to respect `drawingsLocked` (don't move locked drawings)
4. Wire rendering to respect `drawingsHidden` (don't render hidden drawings)

**Files:** `DrawingLayer.tsx`

### Phase 4.3 — DrawingContextMenu (~45 min)

**Goal:** Right-click on a drawing → context menu with actions. Pattern from `AlertContextMenu.tsx`.

**Steps:**
1. Create `components/chart/DrawingContextMenu.tsx`
2. Portal rendering, viewport clamping, Esc close, outside-click close
3. Items: Edit, Clone, Lock/Unlock, Hide/Show, Bring to Front, Send to Back, Delete
4. Conditional items: Lock→Unlock based on current `drawing.locked`, Hide→Show based on `drawing.visible`
5. Separator between edit/clone and lock/hide/z-order/delete
6. Wire into DrawingLayer: right-click → hitTest → open menu at cursor position
7. Touch: long-press (~500ms) for mobile — exact pattern from AlertOverlay

**Files:** New `DrawingContextMenu.tsx`, modified `DrawingLayer.tsx`

### Phase 4.4 — Hit-test module (~20 min)

**Goal:** Extract hit-test from DrawingLayer's inline function into a standalone module.

**Steps:**
1. Create `components/chart/drawing/drawingHitTest.ts`
2. Export `hitTest(drawings, point, proj): Drawing | null`
3. Support all 17 tools (not just the 7 currently handled)
4. Respect `visible`, `locked`, `zIndex` ordering
5. Import into DrawingLayer and DrawingContextMenu

**Files:** New `drawingHitTest.ts`, modified `DrawingLayer.tsx`

### Phase 4.5 — Drawing hotkeys (~15 min)

**Goal:** Keyboard shortcuts for drawing manipulation.

**Steps:**
1. `Ctrl+D` → duplicate selected drawing
2. `Ctrl+L` → lock/unlock selected drawing
3. `Delete`/`Backspace` → delete selected (if not locked)
4. `Esc` → deselect (existing), cancel pending creation
5. Add to existing keyboard handler in `DrawingLayer.tsx`

**Files:** `DrawingLayer.tsx`

### Phase 4.6 — Expand toolbar to 17 tools (~1h)

**Goal:** Full TradingView tool set with visual grouping.

**Steps:**
1. Icons: lucide-react already has all needed icons
   - Crosshair: `Crosshair`, Channel: `GitBranch`, Arrow: `ArrowUp`
   - Brush: `PenTool`, Measure: `Ruler`, Eraser: `Eraser`
   - Long: `ArrowUpToLine`, Short: `ArrowDownToLine`, Emoji: `Smile`
2. Add to `TOOLS` array with visual category separators:
   ```
   MODES:     cursor | crosshair | eraser | measure
   LINES:     trendline | horizontal | vertical
   CHANNELS:  channel
   SHAPES:    rectangle | fib
   ANNOTATIONS: text | emoji
   POSITIONS: long | short
   FREEHAND:  brush
   ```
3. Active-state style: left-border accent bar (`border-l-[3px] border-l-brand`) on active tool
4. Color picker: refine to click-to-open popover (not hover-reveal)
5. Clear-all with confirmation or moved to context menu

**Files:** `DrawingToolbar.tsx`

### Phase 4.7 — New tool creation flows (~45 min)

**Goal:** Implement creation interactions for the 10 new tools.

**Steps:**
1. **Channel** (3-point): click 1 → first anchor. Click 2 → second anchor. Click 3 → offset width. Render preview after click 2.
2. **Brush** (freehand): pointer-down starts path, pointer-move appends points, pointer-up finalizes. Render live preview while drawing.
3. **Measure** (transient): click-drag shows distance overlay. Does NOT persist. Uses `renderMeasure()` from drawingRenderer.
4. **Long/Short** (position): click places entry, then two additional clicks/drags for SL and TP.
5. **Emoji** (annotation): click opens emoji picker or uses default, places at click position.
6. **Eraser** (mode): hover highlights nearest drawing, click deletes it. Does NOT change activeTool.
7. **Crosshair** (mode): draws full-chart crosshair. Does NOT persist.

**Files:** `DrawingLayer.tsx` (creation logic)

## 5. Dependencies

```
Phase 4.1 (wire renderer) ──── independent, no deps
  ↓
Phase 4.2 (wire actions) ──── depends on 4.1 (renderer must respect locked/visible)
  ↓
Phase 4.4 (hit-test module) ─ independent, can run parallel to 4.2
  ↓
Phase 4.3 (context menu) ──── depends on 4.4 (hit-test for right-click)
  ↓
Phase 4.5 (hotkeys) ───────── depends on 4.2 (actions wired)
  ↓
Phase 4.6 (expand toolbar) ── independent (can start after 4.1)
  ↓
Phase 4.7 (new tool flows) ── depends on 4.1 + 4.6
```

## 6. Estimated complexity

| Phase | Effort | Risk |
|---|---|---|
| 4.1 Wire renderer | 30 min | Low — drop-in replacement |
| 4.2 Wire actions | 15 min | Low — actions already exist in store |
| 4.3 Context menu | 45 min | Low — copy AlertContextMenu pattern |
| 4.4 Hit-test module | 20 min | Low — extract existing code |
| 4.5 Hotkeys | 15 min | Low |
| 4.6 Expand toolbar | 1h | Low — UI only |
| 4.7 New tool flows | 45 min | Medium — new interaction patterns |
| **Total** | **~3.5h** | |

## 7. Mobile support plan

All interaction patterns already have touch support via the `AlertOverlay` pattern:
- **Pointer events** (not mouse events) — `onPointerDown/Move/Up` works on touch
- **Long-press** (~500ms) — `setTimeout` on pointer-down, cleared on pointer-up/move
- **Touch-action: none** — prevent browser scroll/zoom on drawing canvas
- **Pointer capture** — `setPointerCapture` for drag operations

No additional mobile architecture needed — the existing patterns cover it.

## 8. Files inventory

| File | Phase | Action |
|---|---|---|
| `components/chart/drawing/drawingRenderer.ts` | 4.1 | Import into DrawingLayer (no changes to file) |
| `components/chart/DrawingLayer.tsx` | 4.1, 4.2, 4.4, 4.5, 4.7 | Major refactor: wire renderer, actions, new tool flows |
| `components/chart/DrawingContextMenu.tsx` | 4.3 | **New** — right-click context menu |
| `components/chart/drawing/drawingHitTest.ts` | 4.4 | **New** — extracted hit-test module |
| `components/toolbar/DrawingToolbar.tsx` | 4.6 | Major refactor: 7→17 tools with visual groups |
| `hooks/useHotkeys.ts` | 4.5 | Add Ctrl+D, Ctrl+L |
| `store/chartStore.ts` | — | No changes needed (actions already exist) |
| `types/drawing.ts` | — | No changes needed (types already complete) |
