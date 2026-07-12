/**
 * TrendLineTool - finite two-point trend line.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { arrowHead, chip, line, handle, renderLineText } from "./shared";
import {
  finiteSegmentBodyHits,
  projectTwoPoints,
  twoPointAnchorHits,
  twoPointAnchors,
  twoPointBounds,
} from "./lineGeometry";

const plugin: DrawingToolPlugin = {
  tool: "trendline",
  minPoints: 2,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const segment = projectTwoPoints(d, proj.toX, proj.toY);
    if (!segment) return;
    line(g, segment.a.x, segment.a.y, segment.b.x, segment.b.y);
    const arrowSize = Math.max(10, (d.lineWidth ?? 1.5) * 4);
    if (d.lineStart === "arrow") {
      arrowHead(g, segment.b.x, segment.b.y, segment.a.x, segment.a.y, d.color, arrowSize);
    }
    if (d.lineEnd === "arrow") {
      arrowHead(g, segment.a.x, segment.a.y, segment.b.x, segment.b.y, d.color, arrowSize);
    }
    renderLineText(
      g,
      d,
      segment.a.x,
      segment.a.y,
      segment.b.x,
      segment.b.y,
      selected,
    );
    if (selected) {
      handle(g, segment.a.x, segment.a.y, d.color);
      handle(g, segment.b.x, segment.b.y, d.color);
      if (d.showMidpoint !== false) {
        handle(g, (segment.a.x + segment.b.x) / 2, (segment.a.y + segment.b.y) / 2, d.color);
      }
    }
    if (d.showPriceLabels) {
      chip(g, d.points[0].price.toLocaleString(), segment.a.x + 6, segment.a.y - 18, d.color);
      chip(g, d.points[1].price.toLocaleString(), segment.b.x + 6, segment.b.y - 18, d.color);
    }
    if (d.showStats) {
      const delta = d.points[1].price - d.points[0].price;
      const percent = d.points[0].price === 0 ? 0 : (delta / d.points[0].price) * 100;
      chip(
        g,
        `${delta >= 0 ? "+" : ""}${delta.toLocaleString(undefined, { maximumFractionDigits: 6 })} (${percent.toFixed(2)}%)`,
        (segment.a.x + segment.b.x) / 2 + 6,
        (segment.a.y + segment.b.y) / 2 + 5,
        d.color,
      );
    }
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const segment = projectTwoPoints(d, toX, toY);
    return [
      ...twoPointAnchorHits(d, segment, px, py),
      ...finiteSegmentBodyHits(d, segment, px, py),
    ];
  },
  getAnchors: twoPointAnchors,
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return twoPointBounds(projectTwoPoints(d, toX, toY));
  },
};

registerTool(plugin);
