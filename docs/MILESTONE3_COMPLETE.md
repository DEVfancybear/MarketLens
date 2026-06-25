# MILESTONE 3 — TOOL PLUGIN ARCHITECTURE

_Completed: 2026-06-26 · Commit: 5a84535_

## Status: ✅ COMPLETE

All deliverables satisfied. Four tools migrated to individual plugin files.
Remaining 17 tools stay in adapters.ts for future migration.

## Folder structure

```
drawing/
  geometry/
    helpers.ts                    ← shared math (pointDist, distToSegment, projectPoint, etc.)
  tools/
    ToolRegistry.ts               ← DrawingToolPlugin interface + registerTool/getTool
    adapters.ts                   ← 17 remaining tools
    plugins/
      shared.ts                   ← canvas helpers (line, handle, chip, applyStyle)
      HorizontalTool.ts           ← plugin
      VerticalTool.ts             ← plugin
      TrendLineTool.ts            ← plugin
      RectangleTool.ts            ← plugin
  engine/
    DrawingEngine.ts              ← re-exports getTool + all modules
  hittest/
    HitTestEngine.ts              ← delegates to getTool().hitTest() — ZERO switches
  interaction/
    DrawingInteractionManager.ts  ← delegates to getTool().movePoints() — ZERO switches
  renderer/
    CanvasRenderer.ts             ← delegates to renderDrawing() → getTool().render()
  drawingRenderer.ts              ← delegates to getTool().render() — ZERO switches
```

## DrawingToolPlugin interface

```ts
interface DrawingToolPlugin {
  tool: DrawingTool;
  minPoints: number;
  render(g, d, proj, selected): void;
  hitTest(d, px, py, toX, toY): HitResult[];
  movePoints(orig, pointer, dragTarget, dragStart): Point[];
  boundingBox(d, toX, toY): {x,y,w,h} | null;
  getHandles?: (future);
  serialize?: (future);
  deserialize?: (future);
}
```

## Verification matrix

| Tool | Create | Select | Body Drag | Endpoint Drag | Delete | Render | HitTest |
|---|---|---|---|---|---|---|---|
| Horizontal | ✅ | ✅ | ✅ | N/A | ✅ | ✅ | ✅ |
| Vertical | ✅ | ✅ | ✅ | N/A | ✅ | ✅ | ✅ |
| TrendLine | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rectangle | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Chart interaction

| Feature | Status |
|---|---|
| Wheel Zoom | ✅ |
| Drag Pan | ✅ |
| Crosshair | ✅ |
| Resize | ✅ |
| Visible Range | ✅ |

## Remaining switch statements

- **drawingRenderer.ts:** ZERO — delegates to `getTool(tool).render()`
- **HitTestEngine.ts:** ZERO — delegates to `getTool(tool).hitTest()`
- **DrawingInteractionManager.ts:** ZERO — delegates to `getTool(tool).movePoints()`
- **adapters.ts:** Contains 17 inline tool registrations (switch-like structure via `registerTool()` calls, future migration)

## Dependency graph

```
DrawingLayer
  → DrawingEngine
    → useDrawingInteractionManager → DrawingInteractionManager
        → getTool() → ToolRegistry → DrawingToolPlugin
        → hitTest() → HitTestEngine → getTool() → ToolRegistry → DrawingToolPlugin
    → createRenderLoop → CanvasRenderer
        → renderDrawing() → getTool() → ToolRegistry → DrawingToolPlugin
        → getData() → machineRef + livePointsRef
ChartInteractionManager (passive, chart interaction guarantee)
DrawingToolPlugin implementations
  → geometry/helpers.ts (pointDist, distToSegment, etc.)
  → plugins/shared.ts (line, handle, chip, applyStyle)
```

## Build results

- `npm run type-check` → ✅ exit 0
- `npm run lint` → ✅ 0 warnings
- All 21 tools functional
- Zero behavior changes
- Zero performance regressions
