/**
 * BrushTool — renders and hit-tests a freehand brush stroke.
 */
import type { Drawing, Point as Pt } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
  TOL, distToSegment,
} from "../ToolRegistry";

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
  tool: "brush",
  minPoints: 2,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const pts = d.points;
    if (pts.length < 2) return;
    g.beginPath();
    const p0 = project(pts[0], proj.toX, proj.toY);
    if (!p0) return;
    g.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const a = project(pts[i], proj.toX, proj.toY);
      const b = project(pts[i + 1], proj.toX, proj.toY);
      if (!a || !b) continue;
      g.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    const last = project(pts[pts.length - 1], proj.toX, proj.toY);
    if (last) g.lineTo(last.x, last.y);
    g.stroke();
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const results: HitResult[] = [];
    const projected = d.points.map((pt) => ({
      x: toX(pt.time),
      y: toY(pt.price),
    }));
    for (let j = 0; j < projected.length - 1; j++) {
      const a = projected[j],
        b = projected[j + 1];
      if (a.x == null || a.y == null || b.x == null || b.y == null) continue;
      const segDist = distToSegment(px, py, a.x, a.y, b.x, b.y);
      if (segDist < TOL)
        results.push({ drawing: d, target: "segment", distance: segDist });
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
