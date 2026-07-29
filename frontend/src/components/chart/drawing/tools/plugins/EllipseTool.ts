/**
 * EllipseTool - bounding-box ellipse.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
} from "../ToolRegistry";
import { handle, renderShapeText } from "./shared";
import { ellipseBodyHit } from "./shapeGeometry";
import {
  ellipseSelectionAnchorHits,
  ellipseSelectionAnchors,
  moveEllipseSelectionAnchor,
} from "../ellipseSelectionHandles";

const plugin: DrawingToolPlugin = {
  tool: "ellipse",
  minPoints: 2,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const x1 = proj.toX(d.points[0].time), y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time), y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    if (d.fillColor && d.fillColor !== "none") {
      g.save();
      g.fillStyle = d.fillColor;
      g.globalAlpha = d.opacity ?? 0.3;
      g.fill();
      g.globalAlpha = 1;
      g.restore();
    }
    g.stroke();
    renderShapeText(g, d, cx - rx, cy - ry, rx * 2, ry * 2);
    if (selected) {
      ellipseSelectionAnchors(d, proj.toX, proj.toY).forEach((anchor) => {
        if (anchor.x != null && anchor.y != null) {
          handle(g, anchor.x, anchor.y, d.color);
        }
      });
    }
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time), y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time), y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    results.push(...ellipseSelectionAnchorHits(d, px, py, toX, toY));
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
    results.push(...ellipseBodyHit(d, px, py, cx, cy, rx, ry));
    return results;
  },
  movePoints: defaultMovePoints,
  moveAnchor: moveEllipseSelectionAnchor,
  getAnchors: ellipseSelectionAnchors,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const x1 = toX(d.points[0].time), y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time), y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  },
};

registerTool(plugin);
