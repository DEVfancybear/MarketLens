import type { Drawing } from "@/types";
import type { Segment } from "./lineGeometry";
import { arrowHead, chip, handle, renderLineText } from "./shared";

/** Shared visual controls documented for Trendline, Ray, and Extended Line. */
export function renderTwoPointLineParity(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  anchors: Segment,
  rendered: Segment,
  selected: boolean,
) {
  const arrowSize = Math.max(10, (drawing.lineWidth ?? 1.5) * 4);
  if (drawing.lineStart === "arrow") {
    arrowHead(g, rendered.b.x, rendered.b.y, rendered.a.x, rendered.a.y, drawing.color, arrowSize);
  }
  if (drawing.lineEnd === "arrow") {
    arrowHead(g, rendered.a.x, rendered.a.y, rendered.b.x, rendered.b.y, drawing.color, arrowSize);
  }

  renderLineText(g, drawing, anchors.a.x, anchors.a.y, anchors.b.x, anchors.b.y, selected);
  if (selected) {
    handle(g, anchors.a.x, anchors.a.y, drawing.color);
    handle(g, anchors.b.x, anchors.b.y, drawing.color);
    if (drawing.showMidpoint !== false) {
      handle(g, (anchors.a.x + anchors.b.x) / 2, (anchors.a.y + anchors.b.y) / 2, drawing.color);
    }
  }
  if (drawing.showPriceLabels) {
    chip(g, drawing.points[0].price.toLocaleString(), anchors.a.x + 6, anchors.a.y - 18, drawing.color);
    chip(g, drawing.points[1].price.toLocaleString(), anchors.b.x + 6, anchors.b.y - 18, drawing.color);
  }
  if (drawing.showStats) {
    const delta = drawing.points[1].price - drawing.points[0].price;
    const percent = drawing.points[0].price === 0 ? 0 : (delta / drawing.points[0].price) * 100;
    chip(
      g,
      `${delta >= 0 ? "+" : ""}${delta.toLocaleString(undefined, { maximumFractionDigits: 6 })} (${percent.toFixed(2)}%)`,
      (anchors.a.x + anchors.b.x) / 2 + 6,
      (anchors.a.y + anchors.b.y) / 2 + 5,
      drawing.color,
    );
  }
}
