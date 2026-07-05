/**
 * ChannelTool — parallel trend channel.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
  HANDLE_RADIUS,
  TOL,
  pointDist,
  distToSegment,
} from "../ToolRegistry";
import { line, handle } from "./shared";
const plugin: DrawingToolPlugin = {
  tool: "channel",
  minPoints: 2,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const x1 = proj.toX(d.points[0].time),
      y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time),
      y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    const dx = x2 - x1,
      dy = y2 - y1;
    const span =
      d.points.length >= 3 ? d.points[2].price - d.points[0].price : 50;
    const t = span / Math.hypot(dx, dy);
    const off = t * Math.hypot(dy, dx);
    const y1b = y2 + off,
      y2b = y1 + off;
    line(g, x1, y1, x2, y2);
    line(g, x1, y1b, x2, y2b);
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const segDist = distToSegment(px, py, x1, y1, x2, y2);
    if (segDist < TOL)
      results.push({ drawing: d, target: "body", distance: segDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    if (x1 == null || y1 == null) return null;
    return { x: x1 - 10, y: 0, w: 9999, h: 9999 };
  },
};
registerTool(plugin);
