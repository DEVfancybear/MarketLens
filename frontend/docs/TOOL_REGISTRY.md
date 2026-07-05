# TOOL REGISTRY

_Date: 2026-06-25. Rewritten 2026-06-27 — a formal adapter registry was implemented; this
doc previously (and incorrectly) said the engine used decentralized `switch` statements._

## Current architecture

The drawing engine **does** use a formal tool registry. Every tool is a self-registering
**plugin** implementing the `DrawingAdapter` interface; the renderer, hit-tester, and
interaction manager all delegate to it polymorphically. There are **no `switch(d.tool)`
statements** anywhere in the engine.

| Concern | Location |
|---|---|
| Tool identifiers (union type) | `types/drawing.ts` → `DrawingTool` |
| Tool list (for toolbar) | `types/drawing.ts` → `DRAWING_TOOLS` + `MODE_TOOLS` |
| Adapter interface + registry | `drawing/tools/ToolRegistry.ts` → `DrawingAdapter`, `registerTool`, `getTool` |
| Per-tool implementation | `drawing/tools/plugins/*Tool.ts` (one file per tool) |
| Registration | `drawing/tools/adapters.ts` (side-effect `import`s) |
| Rendering per tool | `drawingRenderer.ts` → `getTool(d.tool).render()` |
| Hit-test per tool | `hittest/HitTestEngine.ts` → `getTool(d.tool).hitTest()` |
| Creation/move/resize | `interaction/DrawingInteractionManager.ts` → `getTool(...).move()/moveAnchor()` |
| Toolbar icons per tool | `DrawingToolbar.tsx` → `TOOLS` array |

## The `DrawingAdapter` interface

Each plugin implements (see `ToolRegistry.ts` for the full signature):

| Method | Purpose |
|---|---|
| `tool`, `minPoints` | identity + how many points before the object is committed |
| `render(g, d, proj, selected)` | draw the object (+ handles when selected) |
| `hitTest(d, px, py, toX, toY)` | return candidate hits — anchors (`p1`/`p2`/…) **and** `body` |
| `movePoints(...)` / `move()` / `moveAnchor()` | translate the object / drag one anchor |
| `boundingBox(d, toX, toY)` | pixel bbox for the spatial index / viewport cull |
| `getAnchors(d, toX, toY)` | handle positions (defaults to one per point) |

`registerTool()` accepts either a full adapter or a "simple" plugin and auto-wraps the
latter with default `move` / `moveAnchor` / `getAnchors`, so most tools implement only the
core methods. Adding a tool therefore means writing one plugin file and importing it in
`adapters.ts` — no engine file changes. See `DRAWING_ENGINE_ARCHITECTURE.md` → Extensibility.

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
