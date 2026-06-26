/**
 * TrendLineTool — renders and hit-tests a two-point trend line.
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
  tool: "trendline",
  minPoints: 2,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const pts = d.points;
    // Guard: during preview only 1 anchor may be placed — draw a dot.
    if (pts.length < 2) {
      const x = proj.toX(pts[0].time),
        y = proj.toY(pts[0].price);
      if (x != null && y != null) handle(g, x, y, d.color);
      return;
    }
    const x1 = proj.toX(pts[0].time),
      y1 = proj.toY(pts[0].price);
    const x2 = proj.toX(pts[1].time),
      y2 = proj.toY(pts[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    line(g, x1, y1, x2, y2);
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
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return {
      x: Math.min(x1, x2) - TOL,
      y: Math.min(y1, y2) - TOL,
      w: Math.abs(x2 - x1) + TOL * 2,
      h: Math.abs(y2 - y1) + TOL * 2,
    };
  },
};

registerTool(plugin);
