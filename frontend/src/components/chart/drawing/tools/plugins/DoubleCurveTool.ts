/**
 * DoubleCurveTool - TradingView-style 4-point double (S) curve.
 *
 *   points[0] = start, points[1] & points[2] = control points, points[3] = end.
 *
 * Rendered as a cubic Bezier. The two control points create the characteristic
 * S-shape. Before all 4 points are placed it previews as a polyline.
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
  projectPoints,
  sampleCubic,
  strokeHitTolerance,
  visiblePoints,
  type XY,
} from "./shapeGeometry";

function doubleCurveSamples(points: XY[]): XY[] {
  if (points.length >= 4) return sampleCubic(points[0], points[1], points[2], points[3]);
  return points;
}

const plugin: DrawingToolPlugin = {
  tool: "doubleCurve",
  minPoints: 2,
  maxPoints: 4,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const pts = visiblePoints(projectPoints(d.points, proj.toX, proj.toY));
    if (pts.length < 2) return;
    g.save();
    applyStyle(g, d.lineStyle);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    if (pts.length >= 4)
      g.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
    else for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();
    g.restore();
    if (selected) pts.forEach((p) => handle(g, p.x, p.y, d.color));
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const projected = projectPoints(d.points, toX, toY);
    const curve = doubleCurveSamples(visiblePoints(projected));
    return [
      ...anchorHits(d, projected, px, py),
      ...curveBodyHits(d, curve, px, py, strokeHitTolerance(d.lineWidth)),
    ];
  },
  movePoints: defaultMovePoints,
  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return anchorsFromProjected(projectPoints(d.points, toX, toY));
  },
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return boundsFromPoints(
      doubleCurveSamples(visiblePoints(projectPoints(d.points, toX, toY))),
      Math.max(1, (d.lineWidth ?? 1.5) / 2),
    );
  },
};

registerTool(plugin);
