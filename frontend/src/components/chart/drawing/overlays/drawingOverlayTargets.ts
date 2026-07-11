import type { Drawing } from "../../../../types/drawing";
import { getDrawingToolManifestEntry } from "../../../../types/drawingToolManifest";
import { getTool } from "../tools/ToolRegistry";

export type OverlayProjector = (value: number) => number | null;

export interface SelectionTextOverlayTarget {
  drawing: Drawing;
  x: number;
  y: number;
  width: number;
  angle: number;
}

export function resolveSelectionTextOverlay(
  drawings: readonly Drawing[],
  drawingId: string | null | undefined,
  editorKind: "shape-center" | "line-midpoint",
  toX: OverlayProjector,
  toY: OverlayProjector,
): SelectionTextOverlayTarget | null {
  if (!drawingId) return null;
  const drawing = drawings.find(
    (candidate) =>
      candidate.id === drawingId &&
      getDrawingToolManifestEntry(candidate.tool).selectionTextEditor === editorKind,
  );
  if (!drawing) return null;

  if (editorKind === "shape-center") {
    const box = getTool(drawing.tool)?.boundingBox(drawing, toX, toY);
    return box
      ? {
          drawing,
          x: box.x + box.w / 2,
          y: box.y + box.h / 2,
          width: box.w,
          angle: 0,
        }
      : null;
  }

  const [p0, p1] = drawing.points;
  if (!p0 || !p1) return null;
  const x1 = toX(p0.time);
  const y1 = toY(p0.price);
  const x2 = toX(p1.time);
  const y2 = toY(p1.price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
  let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  return {
    drawing,
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
    width: Math.hypot(x2 - x1, y2 - y1),
    angle,
  };
}
