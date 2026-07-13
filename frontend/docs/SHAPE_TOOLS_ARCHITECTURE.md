# Shape Tools Architecture

_Date: 2026-06-25. Updated 2026-07-13 for the plugin/family geometry contract._

## Scope

The Shapes group includes stable rectangle, rotated rectangle, circle, ellipse,
triangle, polyline, arc, curve, double-curve, and path tools, alongside marker,
arrow, Brush, and Highlighter entries owned by adjacent family adapters. The
manifest is authoritative for the exact current group/order and creation
topology; this document does not duplicate that catalog as a hand-maintained
type list.

| Tool family | Creation | Geometry notes |
| --- | --- | --- |
| Rectangle | two opposite corners | Closed fill/border; optional extension and inner text |
| Rotated Rectangle | base plus width handle | Closed oriented polygon; three stored handles |
| Circle | center plus radius | Circular stroke/fill and center/radius handles |
| Ellipse | opposite box corners | Ellipse-specific body selection, not box-interior selection |
| Triangle | three fixed points | Closed edges/fill and three indexed handles |
| Polyline/Path | click-freeform | Open segments; Path adds a terminal arrowhead |
| Arc/Curve/Double Curve | fixed/freeform control points | Sampled curves share render/hit/bounds geometry |

## Plugin architecture

Shape rendering and interaction are adapter-owned:

```text
drawingToolManifest.ts
  -> creation/settings/default capabilities
tools/adapters.ts
  -> shape plugin registration
tools/plugins/*Tool.ts
  -> render + hitTest + boundingBox + anchors + transforms
tools/plugins/shapeGeometry.ts
  -> shared projection, curve sampling, polygon/ellipse hits and bounds
DrawingInteractionManager / TransformSession
  -> generic pointer arbitration and anchor-index transforms
```

There is no `drawingHitTest.ts`, renderer switch, or shape dispatcher in
`DrawingLayer`. Adding a shape must not add concrete shape-id branches to the
shared interaction engine.

## Geometry contract

Shapes reuse `shapeGeometry.ts` for projection, explicit anchor hits,
segment/body hits, polygon-inside checks, ellipse body checks, sampled
quadratic/cubic curves, and sampled bounds. The central invariant is:

```text
rendered outline/fill <-> hit-test outline/fill <-> spatial bounds <-> handles
```

- Ellipse body selection follows the actual ellipse.
- Filled polygons are selectable from both closed edges and their interior.
- Curves are selectable from sampled curve geometry, and those same samples
  determine culling bounds.
- Polyline and Path keep every vertex identity even when later vertices share
  the visual `p0` target label.
- Rectangle extensions must be included in hit-test and bounds, not only paint.
- Every visible shape handle returns an explicit `anchorIndex`; Circle, Ellipse,
  Rectangle, and Rotated Rectangle are covered by the full adapter contract.

## Fill and inner text

```ts
interface Drawing {
  fillColor?: string;
  opacity?: number;
}
```

- Explicit `fillColor` uses the configured opacity.
- Without a fill color, legacy stroke-derived low-opacity fill behavior is
  preserved where the adapter supports fill.
- Selection handles remain solid.

Fillable shapes can expose the manifest `selectionTextEditor: "shape-center"`
capability. `DrawingLayer` projects the adapter bounding-box center for the
shared inline editor; adapters render stored text through the shared shape text
helper. This is an overlay capability, not a hard-coded list in the interaction
manager.

Rectangle remains the primary supply/demand-zone shape. Stroke, fill, opacity,
line style, optional middle line, extension, and attached text all use the
shared settings schema and versioned drawing payload.

## Tests

- `tests/drawing/shapeGeometry.test.ts` covers indexed anchors, ellipse body
  selection, polygon fill/edge selection, and sampled curve hit/bounds.
- `tests/drawing/adapterBehavior.test.ts` covers production shape behavior.
- `tests/drawing/drawingOverlayTargets.test.ts` covers selected shape text
  projection.
- `tests/drawing/allToolAdapterContract.test.ts` runs every persistent shape
  adapter with realistic fixtures and rejects detached handles or invalid bounds.
- `tests/drawing/drawingCodec.test.ts` and persistence tests cover round trips.

Run the integrated suite with `npm run test:drawing`. See
`DRAWING_TOOLS_POST_PHASE8_MAINTENANCE_2026-07-13.md` for the catalog-wide audit.
