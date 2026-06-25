# TOOL REGISTRY

_Date: 2026-06-25._

## Current architecture

The drawing engine does NOT use a formal tool registry pattern. Instead, tools are decentralized:

| Concern | Location |
|---|---|
| Tool identifiers (union type) | `types/drawing.ts` → `DrawingTool` |
| Tool list (for toolbar) | `types/drawing.ts` → `DRAWING_TOOLS` + `MODE_TOOLS` |
| Rendering per tool | `drawingRenderer.ts` → `switch(d.tool)` |
| Hit-test per tool | `drawingHitTest.ts` → `switch(d.tool)` |
| Creation flow per tool | `DrawingLayer.tsx` → `if/else` on `activeTool` |
| Toolbar icons per tool | `DrawingToolbar.tsx` → `TOOLS` array |

## Why no formal registry

For the current 17-tool set, the decentralized approach is simpler and avoids premature abstraction. Each concern (rendering, hit-test, creation) is a simple `switch` statement — adding a tool means adding a `case` in 3 files. This is maintainable at the current scale.

## Formal registry design (if needed in future)

If the tool set grows beyond ~30 tools, or if tools need per-type state (e.g., a tool-specific settings panel), a formal registry could be introduced:

```ts
interface ToolDefinition {
  id: DrawingTool;
  category: 'mode' | 'line' | 'shape' | 'annotation' | 'position' | 'freehand';
  icon: React.ReactNode;
  label: string;
  createOnSingleClick: boolean;
  persistable: boolean;
  minPoints: number;
  maxPoints: number;
  defaultColor: string;
  defaultLineWidth: number;
}

const TOOL_REGISTRY: Record<DrawingTool, ToolDefinition> = {
  trendline: {
    id: 'trendline',
    category: 'line',
    icon: <TrendingUp size={18} />,
    label: 'Trend Line',
    createOnSingleClick: false, // two-click
    persistable: true,
    minPoints: 2,
    maxPoints: 2,
    defaultColor: '#2962ff',
    defaultLineWidth: 1.5,
  },
  // ...
};
```

This is NOT implemented — the decentralized approach is sufficient for Phase 4.

## Tool categories (for toolbar grouping)

| Category | Tools |
|---|---|
| **Modes** | cursor, crosshair, eraser, measure |
| **Lines** | trendline, horizontal, vertical |
| **Channels** | channel |
| **Shapes** | rectangle, fib |
| **Annotations** | text, emoji |
| **Positions** | long, short |
| **Freehand** | brush |

Categories drive toolbar visual grouping (separator lines between groups) but do not affect engine behavior.
