import type { Drawing } from "@/types";
import type { Projector } from "../../drawingRenderer";
import type { Segment } from "./lineGeometry";
import { arrowHead, chip, handle, renderLineText } from "./shared";
import { drawPriceAxisValueLabel } from "./axisLabels";
import { lineStatItems, lineStatsAnchor } from "./lineStats";

/** Shared visual controls documented for Trendline, Ray, and Extended Line. */
export function renderTwoPointLineParity(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  anchors: Segment,
  rendered: Segment,
  selected: boolean,
  proj: Projector,
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
    drawPriceAxisValueLabel(
      g,
      drawing.points[0].price,
      drawing.color,
      proj,
      anchors.a.y,
    );
    drawPriceAxisValueLabel(
      g,
      drawing.points[1].price,
      drawing.color,
      proj,
      anchors.b.y,
    );
  }
  const stats = lineStatItems(drawing, anchors, proj);
  const always = drawing.alwaysShowLineStats ?? drawing.showStats === true;
  if (stats.length > 0 && (selected || always)) {
    const origin = lineStatsAnchor(
      anchors,
      drawing.lineStatsPosition ?? "auto",
      proj.width,
    );
    stats.forEach((stat, index) => {
      chip(
        g,
        stat.text,
        origin.x,
        origin.y + index * 18,
        drawing.color,
      );
    });
  }
}
