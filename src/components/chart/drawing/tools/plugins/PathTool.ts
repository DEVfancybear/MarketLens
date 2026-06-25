/**
 * PathTool — renders and hit-tests a closed polygon path.
 */
import type { Drawing, Point as Pt } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
  HANDLE_RADIUS, TOL, pointDist,
} from "../ToolRegistry";
import { handle } from "./shared";

function project(
  pt: Pt,
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
) {
  const x = toX(pt.time);
  const y = toY(pt.price);
  return x != null && y != null ? { x, y } : null;
}

const plugin: DrawingToolPlugin = {
  tool: "path",
  minPoints: 2,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const pts = d.points;
    if (pts.length < 2) return;
    const projPts = pts.map((p) => project(p, proj.toX, proj.toY));
    if (projPts.some((p) => !p)) return;
    g.beginPath();
    g.moveTo(projPts[0]!.x, projPts[0]!.y);
    for (let i = 1; i < projPts.length; i++) {
      if (projPts[i]) g.lineTo(projPts[i]!.x, projPts[i]!.y);
    }
    g.closePath();
    if (d.fillColor && d.fillColor !== "none") {
      g.save();
      g.globalAlpha = d.opacity ?? 0.15;
      g.fillStyle = d.fillColor;
      g.fill();
      g.restore();
    }
    g.stroke();
    if (selected)
      projPts.forEach((p) => {
        if (p) handle(g, p.x, p.y, d.color);
      });
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const results: HitResult[] = [];
    const projected = d.points.map((pt) => ({
      x: toX(pt.time),
      y: toY(pt.price),
    }));
    for (let i = 0; i < projected.length; i++) {
      const pt = projected[i];
      if (pt.x == null || pt.y == null) continue;
      const dist = pointDist(px, py, pt.x, pt.y);
      if (dist <= HANDLE_RADIUS)
        results.push({
          drawing: d,
          target: i === 0 ? "p1" : i === projected.length - 1 ? "p2" : "body",
          distance: dist,
        });
    }
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const xs = d.points
      .map((pt) => toX(pt.time))
      .filter((v): v is number => v != null);
    const ys = d.points
      .map((pt) => toY(pt.price))
      .filter((v): v is number => v != null);
    if (xs.length === 0 || ys.length === 0) return null;
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
};

registerTool(plugin);
