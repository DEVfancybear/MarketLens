# SHAPE TOOL TEST PLAN — Phase 4.3

_Date: 2026-06-25._

## Rectangle

| Test | Steps | Expected |
|---|---|---|
| Create | Draw rectangle (two clicks) | Rectangle appears with fill + border |
| Move | Select, drag | Rectangle moves |
| Delete | Select, Delete | Removed |
| Duplicate | Select, Ctrl+D | Copy appears |
| Persist | Refresh page | Rectangle still there |
| Symbol switch | Draw on BTCUSDT, switch to ETHUSDT, switch back | BTCUSDT rectangle still there |
| Zoom/pan | Zoom in/out, scroll | Rectangle stays pinned to data |
| Lock | Right-click → Lock | Cannot select or delete |
| Fill | Set fillColor property | Custom fill shown |

## Circle

| Test | Expected |
|---|---|
| Create (2 clicks: center + radius) | Circle appears |
| Drag radius handle | Radius changes |
| Bounding box hit-test | Click inside circle to select |
| Persistence | Survives refresh |

## Ellipse

| Test | Expected |
|---|---|
| Create (2 clicks: opposite bounds corners) | Ellipse appears |
| Drag handles | Axes resize |
| Ellipse body hit-test | Click inside the ellipse to select |
| Outside bounding box corner | Click inside the bounding rectangle but outside the ellipse does not select |

## Triangle

| Test | Expected |
|---|---|
| Create (3 clicks) | Triangle appears with fill |
| Drag any corner | Geometry updates |
| Closed-edge hit-test | All three edges select the triangle |
| Interior hit-test | Filled triangle body can be selected from the interior |
| Persistence | Survives refresh |

## Polyline

| Test | Expected |
|---|---|
| Create (multiple clicks) | Open polyline renders |
| Drag a vertex | That vertex moves |
| Add vertex | Future: right-click → Add Point |
| Persistence | Survives refresh |

## Curve

| Test | Expected |
|---|---|
| Create (3+ clicks) | Bezier curve renders |
| Drag control point | Curve adjusts |
| Body hit-test | Curve can be selected and moved by dragging the rendered curve body |
| Persistence | Survives refresh |

## Path

| Test | Expected |
|---|---|
| Create (multiple clicks) | Open connected path renders with a single terminal arrowhead |
| Finish with double-click / right-click / Esc | Drawing commits and remains open |
| Drag any vertex | Only that vertex moves |
| Drag the body/segment | Whole path moves |
| Persistence | Survives refresh |

## Cross-device verification

| Symbol | rectangle | circle | triangle | polyline | curve | path |
|---|---|---|---|---|---|---|
| BTCUSDT | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ETHUSDT | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| EURUSD | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Context menu (all tools)

| Action | Works? |
|---|---|
| Clone | ✅ |
| Lock/Unlock | ✅ |
| Show/Hide | ✅ |
| Bring to Front | ✅ |
| Send to Back | ✅ |
| Delete | ✅ |

## Automated coverage

Run the shared drawing geometry suite:

```bash
npm run test:drawing
```

This covers the common `shapeGeometry.ts` contract used by Path, Polyline,
Triangle, Ellipse, Arc, Curve, and Double Curve, plus the `lineGeometry.ts`
contract used by the TradingView-style Lines flyout tools.
