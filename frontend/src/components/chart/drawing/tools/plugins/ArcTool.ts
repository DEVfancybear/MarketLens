/**
 * ArcTool - TradingView-style 3-point arc.
 *
 *   points[0] = start, points[1] = end, points[2] = peak the curve passes through.
 *
 * Rendered as a quadratic Bezier whose control point is positioned so the curve
 * passes exactly through the peak at t = 0.5.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { handle, applyStyle } from "./shared";
import {
  anchorHits,
  anchorsFromProjected,
  boundsFromPoints,
  curveBodyHits,
  polygonBodyHits,
  projectPoints,
  quadControlThroughPoint,
  sampleQuadratic,
  strokeHitTolerance,
  type XY,
} from "./shapeGeometry";

function arcSamples(points: Array<XY | null>): XY[] {
  const a = points[0];
  const b = points[1];
  if (!a || !b) return [];
  const peak = points[2];
  if (!peak) return [a, b];
  return sampleQuadratic(a, quadControlThroughPoint(a, b, peak), b);
}

const plugin: DrawingToolPlugin = {
  tool: "arc",
  minPoints: 2,
  maxPoints: 3,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const projected = projectPoints(d.points, proj.toX, proj.toY);
    const a = projected[0];
    const b = projected[1];
    const peak = projected[2];
    if (!a || !b) return;
    g.save();
    applyStyle(g, d.lineStyle);
    g.beginPath();
    g.moveTo(a.x, a.y);
    if (peak) {
      const control = quadControlThroughPoint(a, b, peak);
      g.quadraticCurveTo(control.x, control.y, b.x, b.y);
    }
    else g.lineTo(b.x, b.y);
    if (d.fillColor && d.fillColor !== "none") {
      g.lineTo(a.x, a.y);
      g.closePath();
      g.save();
      g.fillStyle = d.fillColor;
      g.globalAlpha = d.opacity ?? 0.2;
      g.fill();
      g.restore();
      g.beginPath();
      g.moveTo(a.x, a.y);
      if (peak) {
        const control = quadControlThroughPoint(a, b, peak);
        g.quadraticCurveTo(control.x, control.y, b.x, b.y);
      } else {
        g.lineTo(b.x, b.y);
      }
    }
    g.stroke();
    g.restore();
    if (selected) {
      handle(g, a.x, a.y, d.color);
      handle(g, b.x, b.y, d.color);
      if (peak) handle(g, peak.x, peak.y, d.color);
    }
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const projected = projectPoints(d.points, toX, toY);
    const samples = arcSamples(projected);
    return [
      ...anchorHits(d, projected, px, py),
      ...curveBodyHits(d, samples, px, py, strokeHitTolerance(d.lineWidth)),
      ...(d.fillColor && d.fillColor !== "none" && (d.opacity ?? 0.2) > 0
        ? polygonBodyHits(d, samples, px, py)
        : []),
    ];
  },
  movePoints: defaultMovePoints,
  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return anchorsFromProjected(projectPoints(d.points, toX, toY));
  },
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return boundsFromPoints(
      arcSamples(projectPoints(d.points, toX, toY)),
      Math.max(1, (d.lineWidth ?? 1.5) / 2),
    );
  },
};

registerTool(plugin);
