# Drawing Toolbar — Remaining TradingView Buttons (PLAN)

_Plan only — not yet implemented. Created 2026-06-29._

Target: bring the floating `DrawingSettingsToolbar` to full TradingView parity by
adding four controls seen in TV's object toolbar:

1. ⬡ **Settings** (hexagon) — open the object's full settings dialog.
2. ▦ **Templates** — save / apply a reusable style preset.
3. ⚓ **Anchor** — toggle how the drawing is pinned to the chart.
4. ⋯ **More** — overflow menu (front/back, hide, copy style, etc.).

Shared file for all four: `src/components/chart/DrawingSettingsToolbar.tsx`
(add buttons + popovers). Existing helpers to reuse: `ToolbarButton`, `Popover`,
`Sep`, `setEditingDrawingAtom`, `DrawingContextMenu`.

Priority order (low risk → high): **More (4) → Settings (1) → Anchor (3) →
Templates (2)**.

---

## 1. ⬡ Settings (hexagon) — generic object settings dialog

**Current state.** A gear button already exists but only for `long`/`short`
(`hasSettings`), opening `PositionSettingsDialog` via `setEditingDrawingAtom`
(`editingDrawingIdAtom`). All other tools have **no** settings dialog.

**Goal.** Show the hexagon for *every* drawing; open a settings dialog whose
tabs depend on the tool.

**Approach.**
- Rename/generalize `PositionSettingsDialog.tsx` → `ObjectSettingsDialog.tsx`
  (keep the position logic as one branch). It already reads `editingDrawingIdAtom`,
  so the atom plumbing is done.
- Pick the dialog body by tool family:
  - **Line/shape tools** → tabs: _Style_ (line color, width, style, fill +
    opacity) and _Coordinates_ (price/time of each point) and _Visibility_.
  - **Text/emoji** → _Style_ (text color, font size, future: bold/italic/align)
    + _Visibility_.
  - **long/short** → existing Inputs/Style/Visibility (unchanged).
- Reuse the existing `NumberField`, `Row`, `SectionTitle`, `Tab` helpers.
- Toolbar: replace `hasSettings` gate with "always show", icon = `Hexagon`
  (lucide) to match TV; `onClick={() => setEditingDrawing(drawing.id)}`.

**Data model.** None new (everything already on `BaseDrawing`).

**Risk.** Low–medium. The dialog already exists; the work is fanning out tab
content per tool. No interaction/hit-test changes. Keep position branch byte-identical
to avoid regressing the position tool.

**Effort.** ~M (mostly form UI).

---

## 2. ▦ Templates — style presets

**Current state.** None. No preset storage exists.

**Goal.** "Save drawing template" from the current object's style, and apply a
saved template to the selected object (TV's template dropdown).

**Approach.**
- **Model:** a `DrawingTemplate` = subset of style fields
  `{ name, color, lineWidth, lineStyle, fillColor, opacity, fontSize, showLabels }`
  (NOT points). Store per-tool-family.
- **Persistence:** reuse the existing `localStore` wrapper used by
  `drawingsAtom` (see `chartStore.ts` `localStore.set(drawingsKey(...))`). Add
  `drawingTemplatesAtom` + a `templatesKey()` and load/save the same way.
- **Atoms (new):** `drawingTemplatesAtom`, `saveTemplateAtom(name)`,
  `applyTemplateAtom({id, template})`, `deleteTemplateAtom(name)`.
  `apply` = `updateDrawingAtom` with the style subset only.
- **UI:** `▦` button opens a `Popover` listing saved templates + "Save as
  template…" (prompt for name) + "Apply default". Filter list by the selected
  tool's family so a text template isn't offered for a trendline.
- Icon: `LayoutTemplate` or `Shapes` (lucide).

**Risk.** Medium — new persistence surface. Keep it style-only (never touch
`points`/`id`) so a bad template can't move/duplicate objects.

**Effort.** ~M–L (atoms + persistence + popover UI).

---

## 3. ⚓ Anchor — pin mode

**Current state.** All drawings are time/price anchored (points are
`{time, price}`); there is no alternative anchoring or a toggle.

**Goal.** TV's anchor toggles whether the object stays fixed to chart
coordinates (date/price) vs. fixed to the screen/pixels (stays put on pan/zoom).
For text this is "stay in fixed screen position".

**Approach (phased).**
- **Model:** `anchorMode?: "chart" | "screen"` on `BaseDrawing` (default
  `"chart"` = today's behavior).
- **Render:** when `anchorMode === "screen"`, store/interpret `points` as
  fractional viewport coordinates instead of `{time, price}`. This touches every
  consumer of `points` (renderer, hit-test, drag, persistence) → **largest blast
  radius of the four.**
- **Phase 1 (cheap, ship first):** implement only for **text/emoji** (single
  point). Add a `screenPos?: {xFrac, yFrac}` field used only when
  `anchorMode === "screen"`; `TextTool.render/hitTest/boundingBox` branch on it.
  No change to the generic point pipeline.
- **Phase 2 (optional):** generalize to line/shape tools later if needed.
- **UI:** `⚓` button toggles `anchorMode`; active state styled like the lock
  button. Icon: `Anchor` (lucide).

**Risk.** High if generalized; **Low** if scoped to text-only (Phase 1).
Recommend Phase 1 only unless a real need appears.

**Effort.** Phase 1 ~S–M; Phase 2 ~L.

---

## 4. ⋯ More — overflow menu

**Current state.** `DrawingContextMenu.tsx` (right-click) already has Clone,
Lock/Unlock, Show/Hide, Bring to Front, Send to Back, Delete — fully wired to
atoms.

**Goal.** A `⋯` button that opens the **same** menu as right-click, anchored
under the toolbar.

**Approach.**
- Smallest change: the `⋯` button sets the existing `ctxMenu` state used by
  `DrawingLayer` (`setCtxMenu({ id, x, y })`) positioned under the button, so it
  renders the existing `DrawingContextMenu` — **zero new menu code**. Needs the
  toolbar to receive a `setCtxMenu`/onMore callback from `DrawingLayer`, OR
  factor the `items` array out of `DrawingContextMenu` into a shared
  `useDrawingActions(drawing)` hook reused by both the menu and a toolbar popover.
- Recommended: extract `useDrawingActions(drawing)` → returns the `items[]`;
  `DrawingContextMenu` and a new toolbar `Popover` both render it. Avoids prop
  drilling and keeps one source of truth.
- Optional new items later: "Copy style" / "Paste style" (pairs well with
  Templates), "Reset to default style".
- Icon: `MoreHorizontal` (lucide).

**Risk.** Low — reuses existing, tested actions.

**Effort.** ~S (refactor to shared hook + render in popover).

---

## Cross-cutting notes

- **Repaint:** any new style field that affects rendering MUST be added to
  `CanvasRenderer.drawingsHash()` (see how `text`/`fontSize` are appended), else
  the memo guard skips the repaint.
- **Hit-test union:** no new `HitResult["target"]` values needed for these four.
- **`isOverDrawingUI`:** new popovers render inside `[data-drawing-toolbar]`, so
  clicks are already ignored by the canvas interaction manager — no extra guard.
- **Persistence key:** mirror `drawingsKey(symbol)` for templates;
  templates should be **global**, not per-symbol (decide before coding §2).
- **Icons (lucide):** `Hexagon`, `LayoutTemplate`/`Shapes`, `Anchor`,
  `MoreHorizontal`.
