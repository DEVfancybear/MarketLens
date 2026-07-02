/**
 * PolylineTool — renders and hit-tests a multi-point polyline.
 */
import type { Drawing, Point as Pt } from "@/types";
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

function vertexTarget(index: number, lastIndex: number): HitResult["target"] {
  if (index === 0) return "p1";
  if (index === lastIndex) return "p2";
  return "p0";
}

const plugin: DrawingToolPlugin = {
  tool: "polyline",
  minPoints: 2,
  freeform: true,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const pts = d.points;
    if (pts.length < 2) return;
    const projPts = pts.map((p) => project(p, proj.toX, proj.toY));
    if (projPts.some((p) => !p)) return;
    g.beginPath();
    g.moveTo(projPts[0]!.x, projPts[0]!.y);
    for (let i = 1; i < projPts.length; i++) {
      if (projPts[i]) g.lineTo(projPts[i]!.x, projPts[i]!.y);
    }
    g.stroke();
    if (selected)
      projPts.forEach((p) => {
        if (p) handle(g, p.x, p.y, d.color);
      });
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
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
          target: vertexTarget(i, projected.length - 1),
          anchorIndex: i,
          distance: dist,
        });
    }
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
  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const lastIndex = d.points.length - 1;
    return d.points.map((pt, i) => ({
      index: i,
      x: toX(pt.time),
      y: toY(pt.price),
      target: vertexTarget(i, lastIndex),
    }));
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
