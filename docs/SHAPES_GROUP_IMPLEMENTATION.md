# Shapes (Rectangle) Group — TradingView Parity

_Implemented 2026-06-29. Scope: the SHAPES toolbar group ("rectangle group")._

## Goal

Make the Shapes group match TradingView's SHAPES flyout in **UI and function**:
Rectangle · Rotated rectangle · Path · Circle · Ellipse · Polyline · Triangle ·
Arc · Curve · Double curve.

## Problem found

The drawing engine (`DrawingInteractionManager`) only supported two creation
patterns:

- **1-point** (`minPoints === 1`): single click creates the drawing.
- **2-point** (`minPoints === 2`): click to start, move to rubber-band, click to
  finish — always exactly 2 points.

There was **no multi-point flow**, so:

- `triangle` & `curve` (`minPoints: 3`) were created with only 2 points →
  `render()` bailed → **invisible**.
- `polyline` & `path` were degraded to a single 2-point segment.
- `rotatedRect` rendered an axis-aligned rectangle (no rotation).
- `arc` / `doubleCurve` didn't exist.

## Solution — additive multi-point engine

Two **optional** fields were added to the tool plugin interface
(`ToolRegistry.ts`):

```ts
maxPoints?: number;   // fixed-count tools (triangle=3, arc=3, doubleCurve=4, rotatedRect=3)
freeform?: boolean;   // unbounded click-to-add tools (polyline, path, curve)
```

A tool is **multi-point** when `freeform` is set, or `maxPoints > 2`, or
`minPoints > 2`. `DrawingInteractionManager` gained a dedicated branch for these,
driven by a new `committedRef` that stores the confirmed click points:

- **First click** → start (`state: "Drawing"`, `committedRef = [p]`).
- **Each later click** → append. Fixed-count tools auto-commit when
  `committedRef.length === maxPoints`.
- **Pointer move** → preview = `[...committed, livePoint]` (rubber-band to cursor).
- **Finish (freeform)** → double-click (`e.detail >= 2`) or right-click, when
  `committed.length >= minPoints`.
- **Cancel** → `Escape` / tool change → `reset()` clears `committedRef`.

The existing **1-point and 2-point code paths are untouched** — only opt-in tools
use the new branch, so the change is additive (low blast radius).

## Tools

| Tool | Points | Notes |
|---|---|---|
| rectangle | 2 | unchanged |
| circle / ellipse | 2 | unchanged |
| rotatedRect | 3 | now a **true rotated rectangle**: p0→p1 = one edge, p2 sets the perpendicular width/rotation |
| triangle | 3 | `maxPoints: 3` — now visible/correct |
| polyline | freeform | true multi-segment |
| path | freeform | true multi-segment |
| curve | freeform | quadratic through points |
| arc | 3 | quadratic Bézier that passes through the 3rd (peak) point |
| doubleCurve | 4 | cubic Bézier (S-curve): p0 start, p1/p2 controls, p3 end |

## Toolbar flyout UI (TradingView-style)

`DrawingToolbar.tsx`:

- Flyout now supports **section headers** (e.g. "SHAPES"), **favorite stars**
  (persisted in `localStorage` under `tv:favTools`), and **hotkey labels**.
- The Shapes group lists the full SHAPES set in TradingView order.
- Rectangle keeps the `Alt+Shift+R` hotkey label.

## Impact / blast radius

- **Engine (`DrawingInteractionManager`)**: additive branch; 1-/2-point tools
  unaffected. Highest-attention file — verified the existing branches are
  byte-identical except the new `isMulti` short-circuit.
- **`ToolRegistry`**: two optional fields; `createAdapter` spreads them through.
  No change to existing tools that omit them.
- **Type union (`drawing.ts`)**: added `arc`, `doubleCurve` to `DrawingTool` and
  `DRAWING_TOOLS`.
- **Renderer/hit-test**: new tools follow the existing plugin contract; no core
  renderer change. (`rotatedRect`/`arc`/`doubleCurve` add no new
  `HitResult["target"]` values.)
- **Persistence**: new tools serialize like any other drawing (points only).

## Deferred (documented, not in this pass)

- **BRUSHES** (Brush exists; Highlighter new) and **ARROWS** (Arrow marker,
  Arrow, Arrow mark up/down) sections from the screenshot — separate groups,
  to be added next using the same flyout-section + favorites infrastructure.
- Per-group "last used becomes the icon" already exists and is unchanged.
