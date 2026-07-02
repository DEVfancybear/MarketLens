/**
 * CircleTool — center + radius anchor circle.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
  HANDLE_RADIUS, TOL, pointDist,
} from "../ToolRegistry";
import { handle, renderShapeText } from "./shared";

const plugin: DrawingToolPlugin = {
  tool: "circle",
  minPoints: 2,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const x1 = proj.toX(d.points[0].time), y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time), y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    const r = Math.hypot(x2 - x1, y2 - y1);
    g.beginPath();
    g.arc(x1, y1, r, 0, Math.PI * 2);
    if (d.fillColor && d.fillColor !== "none") {
      g.save();
      g.fillStyle = d.fillColor;
      g.globalAlpha = d.opacity ?? 0.3;
      g.fill();
      g.globalAlpha = 1;
      g.restore();
    }
    g.stroke();
    renderShapeText(g, d, x1 - r, y1 - r, r * 2, r * 2);
    if (selected) { handle(g, x1, y1, d.color); handle(g, x2, y2, d.color); }
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time), y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time), y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS) results.push({ drawing: d, target: "p1", distance: pointDist(px, py, x1, y1) });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS) results.push({ drawing: d, target: "p2", distance: pointDist(px, py, x2, y2) });
    const r = pointDist(x2, y2, x1, y1);
    const dCenter = pointDist(px, py, x1, y1);
    if (dCenter <= r + TOL) results.push({ drawing: d, target: "body", distance: dCenter });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const x1 = toX(d.points[0].time), y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time), y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    const r = Math.hypot(x2 - x1, y2 - y1);
    return { x: x1 - r, y: y1 - r, w: r * 2, h: r * 2 };
  },
};

registerTool(plugin);
