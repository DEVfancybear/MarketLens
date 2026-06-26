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
