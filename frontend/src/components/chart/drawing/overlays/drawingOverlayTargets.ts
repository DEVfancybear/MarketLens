import type { Drawing } from "../../../../types/drawing";
import { getDrawingToolManifestEntry } from "../../../../types/drawingToolManifest";
import { getTool } from "../tools/ToolRegistry";
import {
  priceAxisLabelRect,
  timeAxisLabelRect,
} from "../tools/plugins/axisLabels";

export type OverlayProjector = (value: number) => number | null;

export interface SelectionTextOverlayTarget {
  drawing: Drawing;
  x: number;
  y: number;
  width: number;
  height?: number;
  angle: number;
}

export interface SelectionTextOverlayViewport {
  width: number;
  height: number;
  market?: {
    symbol: string;
    candles: readonly { time: number; close: number; high: number; low: number }[];
    tickSize?: number;
    pricePrecision?: number;
    pointValue?: number;
  };
}

export function resolveSelectionTextOverlay(
  drawings: readonly Drawing[],
  drawingId: string | null | undefined,
  editorKind: "shape-center" | "line-midpoint" | "axis-price" | "axis-time",
  toX: OverlayProjector,
  toY: OverlayProjector,
  viewport?: SelectionTextOverlayViewport,
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

  if (editorKind === "axis-price" || editorKind === "axis-time") {
    if (!viewport || !drawing.points[0]) return null;
    // A committed attached text remains editable from the direct axis target
    // even when the optional numeric/date badge is hidden in Style settings.
    // Empty lines keep the target hidden with their badge to avoid an
    // invisible click trap.
    if (
      editorKind === "axis-price" &&
      drawing.showPriceLabels === false &&
      !drawing.text?.trim()
    ) return null;
    if (
      editorKind === "axis-time" &&
      drawing.showTimeLabel === false &&
      !drawing.text?.trim()
    ) return null;
    const x = toX(drawing.points[0].time);
    const y = toY(drawing.points[0].price);
    if (editorKind === "axis-price") {
      if (y == null) return null;
      const rect = priceAxisLabelRect(
        drawing,
        viewport,
        y,
      );
      return {
        drawing,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        width: rect.width,
        height: rect.height,
        angle: 0,
      };
    }
    if (x == null) return null;
    const rect = timeAxisLabelRect(drawing, viewport, x);
    return {
      drawing,
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      width: rect.width,
      height: rect.height,
      angle: 0,
    };
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
