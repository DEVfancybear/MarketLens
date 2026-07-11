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
| Tool catalog and identifiers | `types/drawingToolManifest.ts` → `DRAWING_TOOL_MANIFEST`, `DrawingTool` |
| Compatibility lists | Derived manifest exports `DRAWING_TOOLS`, `MODE_TOOLS`, and `SHAPE_TOOLS` |
| Adapter interface + registry | `drawing/tools/ToolRegistry.ts` → `DrawingAdapter`, `DrawingToolDefinition`, `registerTool`, `getTool` |
| Per-tool implementation | `drawing/tools/plugins/*Tool.ts` (one file per tool) |
| Registration | `drawing/tools/adapters.ts` (side-effect `import`s) |
| Rendering per tool | `drawingRenderer.ts` → `getTool(d.tool).render()` |
| Hit-test per tool | `hittest/HitTestEngine.ts` → `getTool(d.tool).hitTest()` |
| Creation/move/resize | `interaction/DrawingInteractionManager.ts` → `getTool(...).move()/moveAnchor()` |
| Toolbar groups/icons | Manifest group and `iconKey` metadata; `DrawingToolbar.tsx` only maps icon keys to React icons |

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
latter with default `move` / `moveAnchor` / `getAnchors`. Registration combines the adapter
with its manifest entry into one `DrawingToolDefinition`; duplicate ids and creation-contract
drift fail at bootstrap. Adding a persistent tool requires one manifest entry, its adapter,
fixture, and tests, without edits to shared toolbar or interaction metadata.

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
