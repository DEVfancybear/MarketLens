Read DEEPSEEK.md, docs/CURRENT_PROGRESS.md, docs/NEXT_TASKS.md, docs/HANDOFF.md and continue development.

# Architecture Rule

Never fix drawing bugs by adding conditional hacks.

If fixing one bug causes another interaction regression,
stop and refactor the interaction architecture.

Never patch around pointer events.

Chart interaction and drawing interaction must remain independent.

TradingView behavior is the reference implementation.

Regression policy:

Before completing any task verify:

- Chart wheel zoom
- Chart pan
- Crosshair
- Drawing creation
- Drawing selection
- Drawing movement
- Endpoint dragging
- Context menu
- Delete
- Duplicate

A task is NOT complete until all regressions pass.

# Investigation Results — Drawing Engine State Corruption (2026-06-26)

## Root cause: Ctrl+D creates drawings with empty id `""`

`DrawingLayer.tsx:234-249` calls both `duplicateDrawing(d.id)` AND
`execute(new DuplicateDrawingCommand({...d, id:""}))` — two copies created.
The command-created copy has `id: ""`.

Since `updateDrawing`/`removeDrawing` match by `d.id === id`, ALL drawings
with `id: ""` respond to the same calls. This causes:

- Dragging one → all empty-id drawings move (cross-contamination)
- Deleting one → all empty-id drawings removed
- Selecting one → all empty-id drawings selected

## Secondary findings

1. **Adapter resolution during drag** (`DrawingInteractionManager.ts:268`):
   `getTool(m.drawingTool ?? "trendline")` — `m.drawingTool` is null during drag.
   Fallback works because all tools share `defaultMovePoints`, but would break
   any custom `movePoints`.

2. **Context menu bypasses undo history** (`DrawingContextMenu.tsx`):
   Delete/Duplicate/Lock/etc. call store directly, no Command history.

3. **Drag operations not undoable**: `commitMove` defined but never called;
   `handleUp` calls `updateDrawing` directly.

4. **Hit-test vocabulary mismatch**: Several line tools return `"segment"`
   from hitTest; interaction manager silently re-maps to `"body"`.
   TrendLineTool fixed; Ray, ExtendedLine, Channel, Brush, Polyline,
   Triangle still return `"segment"`.

5. **`addDrawing` shares `d.points` by reference** (`chartStore.ts:133`):
   `{ ...d }` doesn't deep-copy `points`. Latent risk.

## Fixed

- **TrendLineTool**: hitTest target `"segment"` → `"body"` (vocabulary alignment)

---

# Full Interaction Pipeline Audit (2026-06-26)

## 1. Event Flow Diagram (Current)

```
Browser Pointer/Wheel Event
       |
       v
+-------------------------------------------------------------+
|  DOCUMENT (capture phase)                                   |
|                                                             |
|  +-- Drawing-mode listener (conditional, activeTool!=cursor)|
|  |     pointerdown:  create / continue draw                 |
|  |     pointermove:  preview line during creation           |
|  |                                                          |
|  +-- Cursor-mode listener (PERMANENT, always attached)      |
|        pointerdown:  hitTest -> select / start drag         |
|        pointermove:  drag preview (if MovingDrawing)        |
|        pointerup:    commit drag -> updateDrawing           |
|        pointerleave: commit drag (edge case)                |
|        contextmenu:  show DrawingContextMenu                |
+-------------------------------------------------------------+
       | (if NOT prevented by capture/stopPropagation)
       v
+-------------------------------------------------------------+
|  DrawingLayer Canvas (z:5, pointerEvents:"none")            |
|  -> Transparent to ALL events. Rendering surface only.      |
|  -> setPointerCapture routes events here during drag.       |
+-------------------------------------------------------------+
       | (events pass through -- pointerEvents:none)
       v
+-------------------------------------------------------------+
|  Lightweight Charts Canvas (implicit z-index)               |
|  -> Receives wheel (zoom), pointer (pan/crosshair)          |
|  -> Blocked during active drawing/drag via capture+stopProp |
+-------------------------------------------------------------+
```

## 2. DrawingLayer Responsibilities (9 distinct concerns)

| # | Responsibility | Location | Assessment |
|---|---------------|----------|------------|
| 1 | Canvas rendering + rAF loop | DrawingLayer + CanvasRenderer | Correct |
| 2 | Hit testing | HitTestEngine | Correct |
| 3 | Pointer interaction (create/drag) | DrawingInteractionManager | Correct |
| 4 | Keyboard shortcuts | DrawingLayer.tsx:192-253 | Should be own hook |
| 5 | Context menu | DrawingLayer + DrawingContextMenu | Correct |
| 6 | Command history (undo/redo) | CommandManager + useCommandHistory | Correct |
| 7 | Version/redraw sync | DrawingLayer.tsx:171-181 | Correct |
| 8 | State bridging (refs for rAF) | DrawingLayer.tsx:76-110 | 3 refs, fragile |
| 9 | Chart integration | DrawingLayer.tsx:171-181 | Correct |

## 3. Interaction Conflicts

### Conflict A -- Dual Listener Architecture
Both cursor-mode (permanent) and drawing-mode (conditional) listeners fire
on EVERY pointer event during drawing mode. The cursor handler returns
early via `activeTool !== "cursor"` guard, but both sets process every
event. Overhead: `isOverCanvas()` + `getState()` + `fromEvent()` called
twice per event.

### Conflict B -- No Explicit releasePointerCapture
`setPointerCapture()` called in both handleDown paths. `releasePointerCapture()`
is NEVER called. Capture implicitly released on pointerup/pointercancel per
spec. But if the pointer is lost (window loses focus mid-drag), capture may
persist and block chart interaction until next pointer event.

### Conflict C -- hitTest on Every Idle Pointerdown
In cursor mode, `isOverCanvas()` + `hitTest()` called for EVERY pointerdown
on chart area, even when no drawing is under cursor. Extra computational
overhead on every click.

### Conflict D -- Ctrl+D Duplicate Creates Empty-ID Drawings
`DrawingLayer.tsx:240-248` calls `duplicateDrawing(d.id)` (1 copy, valid uid)
AND `execute(new DuplicateDrawingCommand({...d, id:""}))` (2nd copy, id="").
Multiple empty-id drawings contaminate each other because `updateDrawing(id)`
matches ALL `d.id === id` entries.

### Conflict E -- Adapter Resolution Uses Wrong Tool During Drag
`getTool(m.drawingTool ?? "trendline")` -- `m.drawingTool` is null during
drag (only set during creation). Fallback works because all tools share
`defaultMovePoints`, but any custom `movePoints` would be silently bypassed.

### Conflict F -- HitTest Vocabulary Mismatch (6 tools)

| Tool | hitTest Returns | InteractionManager Expects |
|------|----------------|---------------------------|
| TrendLineTool | `"body"` (fixed) | `"body"` |
| RayTool | `"segment"` | re-mapped to `"body"` |
| ExtendedLineTool | `"segment"` | re-mapped to `"body"` |
| ChannelTool | `"segment"` | re-mapped to `"body"` |
| BrushTool | `"segment"` | re-mapped to `"body"` |
| PolylineTool | `"segment"` | re-mapped to `"body"` |
| TriangleTool | `"segment"` | re-mapped to `"body"` |

## 4. State Ownership

```
chartStore.drawings[]         <- SOLE source of truth
       |
       +--> DrawingLayer (reads via selectors)
       +--> DrawingInteractionManager (reads via getState(), writes via
       |     updateDrawing in handleUp + addDrawing in handleDown)
       +--> CanvasRenderer (reads via getData() -> stateRef.current.drawings)
       +--> CommandManager (reads/writes via store closures)
       +--> DrawingContextMenu (reads via selector, writes via store actions)

Renderer:            READ-ONLY (creates local copy, never mutates store)
Tool Plugins:        READ-ONLY (only read d.points, return new values)
HitTestEngine:       READ-ONLY (pure function, no side effects)
updateDrawing():     SOLE MUTATOR (only place geometry changes)
```

## 5. Root Cause Analysis -- Why Each Symptom Occurs

| Symptom | Root Cause |
|---------|-----------|
| Chart sometimes cannot zoom wheel | No DrawingLayer wheel listener -- issue external. Possible: implicit pointer capture not released on focus loss. |
| Chart cannot pan while drawings exist | Architecture should allow this (pointerEvents:none). Verify state machine not stuck in MovingDrawing from un-released capture. |
| Drawing selection inconsistent | HitTest vocab mismatch -- "segment" silently mapped to "body". TARGET_PRIORITY gives segment(1) priority over body(3), causing inconsistent hit ranking on overlap. |
| Trendline resize incorrect | Fixed (vocabulary alignment). Other tools with "segment" still at risk. |
| Rectangle resize incorrect | RectangleTool returns "body". Likely from empty-id duplicate contamination (Ctrl+D). |
| Fibonacci behaves incorrectly | FibTools return "body". Likely Ctrl+D bug or shared-points ref in Command history. |
| Horizontal line moves unexpectedly | HorizontalTool returns "body". Likely empty-id contamination from Ctrl+D. |
| Dragging feels laggy | hitTest() called on every pointerdown (even misses). transition() triggers React setMachine scheduling re-render, potentially delaying rAF loop. |
| Tools become unusable after fixing another | Ctrl+D bug: empty-id drawings accumulate. updateDrawing("") updates all. removeDrawing("") removes all. Cross-contamination cascades. |

## 6. Minimal Fix Plan

### Priority 1 -- Critical (fixes most symptoms at once)
1. **Fix Ctrl+D double-create** (DrawingLayer.tsx:234-249):
   Remove `execute(new DuplicateDrawingCommand(...))`. Let `duplicateDrawing`
   handle creation. Track duplicate ID for undo via lightweight command.

2. **Guard store against empty IDs** (chartStore.ts:131-133):
   Generate `uid("dw")` if `d.id` is empty or falsy.

### Priority 2 -- High (stability)
3. **Add explicit `releasePointerCapture()`** in both handleUp paths and
   on Escape key to guarantee chart events resume after any interaction.

4. **Fix adapter resolution during drag** (DrawingInteractionManager.ts:268):
   Store `hit.drawing.tool` in machine state and use it instead of
   `m.drawingTool ?? "trendline"`.

### Priority 3 -- Medium (consistency)
5. **Align hitTest vocabulary**: Change remaining 6 tools from `"segment"`
   to `"body"` in their hitTest methods.

6. **Wire `commitMove`** in `handleUp` so drags are undoable.

### Priority 4 -- Low (cleanup)
7. **Extract keyboard handler** from DrawingLayer into `useDrawingKeyboard`.

8. **Deep-copy `d.points` in `addDrawing`** to eliminate shared-reference risk.

## 7. Architecture Verdict

The core architecture (canvas `pointerEvents:"none"` + document capture-phase
listeners) is **sound**. Chart zoom/pan/wheel are NOT blocked by the
DrawingLayer. The primary sources of instability are:

1. **Ctrl+D duplicate bug** -- creates corrupt drawings with empty id
2. **Implicit pointer capture release** -- no explicit release call
3. **HitTest vocabulary inconsistency** -- 6 tools return unhandled targets
4. **Dual listener overhead** -- both handlers fire simultaneously

Fixing Priority 1 items should resolve most reported symptoms without
architectural refactoring.
