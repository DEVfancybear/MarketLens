/**
 * CurveTool - renders and hit-tests a multi-point quadratic curve.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
} from "../ToolRegistry";
import { handle } from "./shared";
import {
  anchorHits,
  anchorsFromProjected,
  boundsFromPoints,
  curveBodyHits,
  projectPoints,
  sampleSmoothCurve,
  strokeHitTolerance,
  visiblePoints,
} from "./shapeGeometry";

const plugin: DrawingToolPlugin = {
  tool: "curve",
  minPoints: 3,
  freeform: true,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const pts = d.points;
    if (pts.length < 3) return;
    const projPts = visiblePoints(projectPoints(pts, proj.toX, proj.toY));
    if (projPts.length < 3) return;
    g.beginPath();
    g.moveTo(projPts[0].x, projPts[0].y);
    for (let i = 1; i < projPts.length - 1; i++) {
      const cp2x = (projPts[i].x + projPts[i + 1].x) / 2;
      const cp2y = (projPts[i].y + projPts[i + 1].y) / 2;
      g.quadraticCurveTo(projPts[i].x, projPts[i].y, cp2x, cp2y);
    }
    g.stroke();
    if (selected) projPts.forEach((p) => handle(g, p.x, p.y, d.color));
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const projected = projectPoints(d.points, toX, toY);
    const samples = sampleSmoothCurve(visiblePoints(projected));
    return [
      ...anchorHits(d, projected, px, py),
      ...curveBodyHits(d, samples, px, py, strokeHitTolerance(d.lineWidth)),
    ];
  },
  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return anchorsFromProjected(projectPoints(d.points, toX, toY));
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return boundsFromPoints(
      sampleSmoothCurve(visiblePoints(projectPoints(d.points, toX, toY))),
      Math.max(1, (d.lineWidth ?? 1.5) / 2),
    );
  },
};

registerTool(plugin);
