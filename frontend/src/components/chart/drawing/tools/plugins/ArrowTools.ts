/**
 * TradingView-style arrow tools.
 *
 * Arrow Marker / Arrow are two-point tools: first click sets the tail, second
 * click sets the arrow tip and direction. Arrow Mark Up/Down/Left/Right are
 * one-point markers that stay a fixed pixel size while anchored to a
 * time/price point.
 */
import type { Drawing } from "@/types";
import type { DrawingTool } from "@/types";
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
import { arrowHead, handle, line, renderLineText } from "./shared";

type TwoPointArrowTool = Extract<DrawingTool, "arrowMarker" | "arrow">;
type ArrowMarkTool = Extract<
  DrawingTool,
  "arrowMarkUp" | "arrowMarkDown" | "arrowMarkLeft" | "arrowMarkRight"
>;

const MARK_SIZE = 22;
const MARK_HIT_RADIUS = 18;

function markerVector(tool: ArrowMarkTool): { dx: number; dy: number } {
  switch (tool) {
    case "arrowMarkDown":
      return { dx: 0, dy: 1 };
    case "arrowMarkLeft":
      return { dx: -1, dy: 0 };
    case "arrowMarkRight":
      return { dx: 1, dy: 0 };
    case "arrowMarkUp":
    default:
      return { dx: 0, dy: -1 };
  }
}

function drawArrowSegment(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  size: number,
) {
  line(g, x1, y1, x2, y2);
  arrowHead(g, x1, y1, x2, y2, color, size);
}

function makeTwoPointArrow(tool: TwoPointArrowTool): DrawingToolPlugin {
  const marker = tool === "arrowMarker";
  return {
    tool,
    minPoints: 2,
    render(g, d, proj, selected) {
      const [a, b] = d.points;
      const x1 = proj.toX(a.time);
      const y1 = proj.toY(a.price);
      const x2 = proj.toX(b.time);
      const y2 = proj.toY(b.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return;
      g.save();
      g.lineCap = "round";
      g.lineJoin = "round";
      if (marker) g.lineWidth = Math.max(g.lineWidth, 2.2);
      drawArrowSegment(g, x1, y1, x2, y2, d.color, marker ? 15 : 12);
      g.restore();
      if (marker) renderLineText(g, d, x1, y1, x2, y2, selected);
      if (selected) {
        handle(g, x1, y1, d.color);
        handle(g, x2, y2, d.color);
      }
    },
    hitTest(d, px, py, toX, toY): HitResult[] {
      const results: HitResult[] = [];
      const [a, b] = d.points;
      const x1 = toX(a.time);
      const y1 = toY(a.price);
      const x2 = toX(b.time);
      const y2 = toY(b.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
      const d1 = pointDist(px, py, x1, y1);
      const d2 = pointDist(px, py, x2, y2);
      const body = distToSegment(px, py, x1, y1, x2, y2);
      if (d1 <= HANDLE_RADIUS) results.push({ drawing: d, target: "p1", distance: d1 });
      if (d2 <= HANDLE_RADIUS) results.push({ drawing: d, target: "p2", distance: d2 });
      if (body < TOL) results.push({ drawing: d, target: "body", distance: body });
      return results;
    },
    movePoints: defaultMovePoints,
    boundingBox(d, toX, toY) {
      const [a, b] = d.points;
      const x1 = toX(a.time);
      const y1 = toY(a.price);
      const x2 = toX(b.time);
      const y2 = toY(b.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
      return {
        x: Math.min(x1, x2) - TOL,
        y: Math.min(y1, y2) - TOL,
        w: Math.abs(x2 - x1) + TOL * 2,
        h: Math.abs(y2 - y1) + TOL * 2,
      };
    },
  };
}

function makeArrowMark(tool: ArrowMarkTool): DrawingToolPlugin {
  return {
    tool,
    minPoints: 1,
    render(g, d, proj, selected) {
      const anchor = d.points[0];
      const x = proj.toX(anchor.time);
      const y = proj.toY(anchor.price);
      if (x == null || y == null) return;
      const { dx, dy } = markerVector(tool);
      const half = MARK_SIZE / 2;
      const x1 = x - dx * half;
      const y1 = y - dy * half;
      const x2 = x + dx * half;
      const y2 = y + dy * half;
      g.save();
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = Math.max(g.lineWidth, d.lineWidth ?? 2);
      drawArrowSegment(g, x1, y1, x2, y2, d.color, 11);
      g.restore();
      if (selected) handle(g, x, y, d.color);
    },
    hitTest(d, px, py, toX, toY): HitResult[] {
      const x = toX(d.points[0].time);
      const y = toY(d.points[0].price);
      if (x == null || y == null) return [];
      const distance = pointDist(px, py, x, y);
      if (distance <= MARK_HIT_RADIUS) return [{ drawing: d, target: "p1", distance }];
      return [];
    },
    movePoints: defaultMovePoints,
    boundingBox(d, toX, toY) {
      const x = toX(d.points[0].time);
      const y = toY(d.points[0].price);
      if (x == null || y == null) return null;
      return {
        x: x - MARK_HIT_RADIUS,
        y: y - MARK_HIT_RADIUS,
        w: MARK_HIT_RADIUS * 2,
        h: MARK_HIT_RADIUS * 2,
      };
    },
  };
}

registerTool(makeTwoPointArrow("arrowMarker"));
registerTool(makeTwoPointArrow("arrow"));
registerTool(makeArrowMark("arrowMarkUp"));
registerTool(makeArrowMark("arrowMarkDown"));
registerTool(makeArrowMark("arrowMarkLeft"));
registerTool(makeArrowMark("arrowMarkRight"));

