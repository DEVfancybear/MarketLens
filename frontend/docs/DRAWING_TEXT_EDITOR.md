# Drawing inline text editor

The chart uses one shared DOM editor for standalone text and text attached to
shapes, lines, and axis labels. The editor intentionally looks like direct
canvas editing: it shows only text, selection, and the caret—never a form-field
background, border, radius, ring, or shadow.

## Component flow

1. `DrawingLayer` resolves the active text target through
   `resolveSelectionTextOverlay`.
2. `TextEditor` receives the target anchor plus drawing typography and renders
   a transparent, focused input over the canvas.
3. `resolveCenteredTextEditorPosition` converts the semantic anchor into a
   clamped editor center. It includes rotated bounds and local-Y offsets so line
   labels remain attached to their segment near viewport edges.
4. While editing, `DrawingLayer` gives the render loop a transient clone marked
   with `_textEditing`.
5. `CanvasRenderer` suppresses `fillText` and `strokeText` only for that clone.
   Non-text geometry and selection handles remain visible, preventing duplicate
   glyphs beneath the transparent DOM editor.
6. `TextEditSession` commits or cancels the result through the existing command
   history, preserving undo and redo behavior.

## Presentation contract

- Empty editors display `Add text`.
- Shape editors inherit font size, weight, italic style, text color, horizontal
  alignment, and vertical alignment from the drawing.
- Line editors inherit typography, rotate with the line, and use the same
  perpendicular label offset as the canvas renderer.
- Axis editors reuse the axis badge width and typography.
- Standalone text preserves its click point as the left text anchor.
- Every editor is clamped inside the chart-local viewport, including rotated
  visual bounds.

New text-capable drawing tools should use the manifest's
`selectionTextEditor` capability and the shared overlay/editor path. Do not add
tool-specific form inputs or opaque backgrounds.

## Regression coverage

- `tests/drawing/textEditorGeometry.test.ts` covers center anchoring, rotation,
  offset projection, and viewport clamping.
- `tests/browser/drawingInteractions.spec.ts` verifies transparent styling,
  center alignment, text commit, undo, and redo.
- `tests/browser/drawingSnapshotMatrix.spec.ts` uses the shared
  `data-inline-text-editor` contract for text-capable snapshot cases.
