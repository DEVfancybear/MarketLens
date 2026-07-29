# Tool Registry

_Date: 2026-06-25. Updated 2026-07-28 after the requested TradingView catalog
parity follow-up._

## Current catalog

The drawing engine is manifest- and adapter-based. There is no renderer or
hit-test `switch(d.tool)`. The current manifest contains 94 stable ids:

- seven non-persistent modes: Cross, Dot, Arrow, Demonstration, Magic, Eraser,
  and Measure; and
- 87 persistent drawing ids, each backed by exactly one registered adapter.

A plugin file may register one tool or a cohesive family. “One adapter per id”
is the runtime invariant; “one source file per id” is not.

| Concern | Owner |
| --- | --- |
| Stable ids, type, ordering, groups, labels, icons | `types/drawingToolManifest.ts` |
| Creation topology and persistent/mode split | Manifest `creationMode`, `minPoints`, `maxPoints`, `persistent` |
| Cross-cutting capabilities | Manifest defaults/settings/shortcuts/magnets/overlays/lifecycle/snapshot/content/position/alerts/culling fields |
| Adapter interface and runtime registry | `drawing/tools/ToolRegistry.ts` |
| Tool/family implementations | `drawing/tools/plugins/*Tool.ts` and cohesive family files |
| Side-effect registration | `drawing/tools/adapters.ts` |
| Rendering dispatch | `drawingRenderer.ts` -> `getTool(d.tool).render()` |
| Hit-test dispatch | `hittest/HitTestEngine.ts` -> `getTool(d.tool).hitTest()` |
| Creation and transforms | `interaction/CreationSession.ts`, `TransformSession.ts`, and `DrawingInteractionManager.ts` |
| Capability-aware fixtures | `drawing/testing/toolFixtures.ts` |
| Full registry contract | `tests/drawing/allToolAdapterContract.test.ts` |

`DrawingTool`, `DRAWING_TOOLS`, `MODE_TOOLS`, toolbar groups, favorites,
shortcut lookup, and creation metadata are derived from the manifest. Do not
maintain a parallel id union/list in a component.

## Manifest capability boundary

Shared consumers ask the manifest what a tool can do; they do not ask whether
the id equals a known concrete tool. Important capabilities include:

- creation mode and point topology;
- style family, settings profile/features, and default properties;
- normalized keyboard shortcuts;
- magnet and angle-constraint eligibility;
- text/settings overlay and lifecycle extensions;
- immutable candle snapshot and rich-content kind;
- Position side;
- fixed-price alert projection; and
- spatial versus always-render viewport culling.

Manifest bootstrap rejects duplicate ids and duplicate shortcut chords.
`registerTool()` rejects persistent adapters whose creation topology disagrees
with the corresponding manifest entry.

## `DrawingAdapter` contract

See `ToolRegistry.ts` for the exact TypeScript signature.

| Member | Contract |
| --- | --- |
| `tool`, `minPoints`, optional creation flags | Identity/topology; must agree with manifest |
| `render(g, drawing, projector, selected)` | Paint all visible geometry and selected affordances |
| `hitTest(drawing, px, py, toX, toY)` | Return selectable anchor/body candidates for the same visible geometry |
| `boundingBox(drawing, toX, toY)` | Return finite bounds covering everything painted/selectable |
| `getAnchors(drawing, toX, toY)` | Return visible resize handles with unique integer ids |
| `move(points, pointer, start, context?)` | Translate body geometry without mutating the input |
| `moveAnchor(points, index, pointer, context?)` | Resize the exact stored/virtual handle identity |
| `movePoints(...)` | Compatibility surface for simple two-anchor adapters |

`registerTool()` accepts a full adapter or a `SimpleTool`. A simple tool is
wrapped with immutable translate-all, move-one-point, and point-anchor defaults.
The default anchor mapping is point 0 -> `p1`, point 1 -> `p2`, and later points
-> `p0`, always with the actual point index.

## Pure runtime context

Adapters must not import chart or Jotai stores. The composition root supplies
read-only runtime inputs explicitly:

- `Projector.barIntervalSeconds` for interval-derived render labels;
- `Projector.market` for candles and symbol tick/precision/point-value inputs;
  and
- `DrawingAdapterInteractionContext` for transform constraints such as symbol
  tick size.

Snapshot tools render analytical data from persisted `Drawing.dataSnapshot`;
rich-content tools render validated `Drawing.content`. Explicit live market
context does not make persisted geometry depend on an ambient store.

## Geometry and handle invariants

Rendered pixels, hit candidates, bounds, and selected handles must describe the
same projected geometry. If rendering adds an extension, fill, leader, wick,
deviation band, or angular sweep, hit-test and bounds must include it too.
Repeated projections must share one bounded iteration contract.

`HitResult.target` is a visual/priority label (`body`, `p0` ... `p5`).
`anchorIndex` is the authoritative resize identity. Every non-body candidate
must carry the same integer id exposed by `getAnchors()`. Body-only tools return
no handles. `TransformSession` passes that identity to `moveAnchor()`.

## Adding a persistent tool

1. Add the stable id and manifest entry with complete capabilities.
2. Implement/register an adapter, preferably reusing family projection helpers.
3. Import its plugin/family module from `tools/adapters.ts`.
4. Add a realistic fixture, including snapshot/content data when declared.
5. Add focused family behavior tests and persistence expectations.
6. Run `npm run test:drawing`; the all-adapter contract automatically checks
   registration, render, bounds, anchors, movement, resize, and hit identity.
7. Document intentional TradingView differences and bounded work limits.

The audited fixes and complete verification matrix are recorded in
`DRAWING_TOOLS_POST_PHASE8_MAINTENANCE_2026-07-13.md`.
