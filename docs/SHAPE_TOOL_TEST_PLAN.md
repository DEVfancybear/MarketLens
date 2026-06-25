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
| Drag center handle | Radius changes |
| Bounding box hit-test | Click inside circle to select |
| Persistence | Survives refresh |

## Ellipse

| Test | Expected |
|---|---|
| Create (3 clicks: center + rx + ry) | Ellipse appears |
| Drag handles | Axes resize |
| Bounding box hit-test | Click inside to select |

## Triangle

| Test | Expected |
|---|---|
| Create (3 clicks) | Triangle appears with fill |
| Drag any corner | Geometry updates |
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
| Persistence | Survives refresh |

## Path

| Test | Expected |
|---|---|
| Create (multiple clicks) | Closed path with fill |
| Drag a vertex | Geometry updates |
| Fill display | Filled area shown |
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
