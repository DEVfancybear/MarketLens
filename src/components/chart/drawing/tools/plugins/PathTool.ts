/**
 * PathTool — TradingView "Path": a series of connected straight segments with a
 * single arrowhead at the final point. Open (not closed) and never filled.
 */
import type { Drawing, Point as Pt } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
  HANDLE_RADIUS, TOL, pointDist, distToSegment,
} from "../ToolRegistry";
import { handle, arrowHead } from "./shared";

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
  freeform: true,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const pts = d.points;
    if (pts.length < 2) return;
    const projPts = pts.map((p) => project(p, proj.toX, proj.toY));
    if (projPts.some((p) => !p)) return;
    // Open connected segments (no closePath, no fill).
    g.beginPath();
    g.moveTo(projPts[0]!.x, projPts[0]!.y);
    for (let i = 1; i < projPts.length; i++) {
      g.lineTo(projPts[i]!.x, projPts[i]!.y);
    }
    g.stroke();
    // Single arrowhead at the terminal point, aimed along the last segment.
    const tip = projPts[projPts.length - 1]!;
    const prev = projPts[projPts.length - 2]!;
    const size = Math.max(10, (d.lineWidth || 1.5) * 4);
    arrowHead(g, prev.x, prev.y, tip.x, tip.y, d.color, size);
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
    // Segment bodies (so the path line itself can be grabbed / moved).
    for (let j = 0; j < projected.length - 1; j++) {
      const a = projected[j],
        b = projected[j + 1];
      if (a.x == null || a.y == null || b.x == null || b.y == null) continue;
      const segDist = distToSegment(px, py, a.x, a.y, b.x, b.y);
      if (segDist < TOL * 1.5)
        results.push({ drawing: d, target: "body", distance: segDist });
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
