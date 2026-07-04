/**
 * TriangleTool - renders and hit-tests a 3-point triangle.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { handle, renderShapeText } from "./shared";
import {
  anchorHits,
  anchorsFromProjected,
  boundsFromPoints,
  polygonBodyHits,
  projectPoints,
  visiblePoints,
} from "./shapeGeometry";

const plugin: DrawingToolPlugin = {
  tool: "triangle",
  minPoints: 3,
  maxPoints: 3,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const pts = d.points.slice(0, 3);
    const projPts = projectPoints(pts, proj.toX, proj.toY);
    if (projPts.some((p) => !p)) return;
    g.beginPath();
    g.moveTo(projPts[0]!.x, projPts[0]!.y);
    for (let i = 1; i < projPts.length; i++)
      g.lineTo(projPts[i]!.x, projPts[i]!.y);
    g.closePath();
    if (d.fillColor && d.fillColor !== "none") {
      g.save();
      g.globalAlpha = d.opacity ?? 0.15;
      g.fillStyle = d.fillColor;
      g.fill();
      g.restore();
    }
    g.stroke();
    const xs = projPts.map((p) => p!.x);
    const ys = projPts.map((p) => p!.y);
    renderShapeText(
      g,
      d,
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    );
    if (selected) projPts.forEach((p) => handle(g, p!.x, p!.y, d.color));
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const projected = projectPoints(d.points.slice(0, 3), toX, toY);
    const polygon = visiblePoints(projected);
    return [
      ...anchorHits(d, projected, px, py),
      ...(polygon.length === 3 ? polygonBodyHits(d, polygon, px, py) : []),
    ];
  },
  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return anchorsFromProjected(projectPoints(d.points.slice(0, 3), toX, toY));
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return boundsFromPoints(
      visiblePoints(projectPoints(d.points.slice(0, 3), toX, toY)),
    );
  },
};

registerTool(plugin);
