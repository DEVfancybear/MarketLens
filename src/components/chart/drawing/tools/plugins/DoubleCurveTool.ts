/**
 * DoubleCurveTool — TradingView-style 4-point double (S) curve.
 *
 *   points[0] = start, points[1] & points[2] = control points, points[3] = end.
 *
 * Rendered as a cubic Bézier — the two control points create the characteristic
 * S-shape. Before all 4 points are placed it previews as a polyline.
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
import { handle, applyStyle } from "./shared";

type XY = { x: number; y: number };

function pj(
  pt: Pt,
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
): XY | null {
  const x = toX(pt.time),
    y = toY(pt.price);
  return x != null && y != null ? { x, y } : null;
}

function cubic(p0: XY, p1: XY, p2: XY, p3: XY, n = 24): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      mt = 1 - t;
    const a = mt * mt * mt,
      b = 3 * mt * mt * t,
      c = 3 * mt * t * t,
      e = t * t * t;
    out.push({
      x: a * p0.x + b * p1.x + c * p2.x + e * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + e * p3.y,
    });
  }
  return out;
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
    const pts = d.points
      .map((p) => pj(p, proj.toX, proj.toY))
      .filter((p): p is XY => p != null);
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
    const results: HitResult[] = [];
    const pts = d.points.map((p) => pj(p, toX, toY));
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p) continue;
      const dist = pointDist(px, py, p.x, p.y);
      const target = (i === 0 ? "p0" : i === 1 ? "p1" : i === 2 ? "p2" : "p3") as
        | "p0"
        | "p1"
        | "p2"
        | "p3";
      if (dist <= HANDLE_RADIUS) results.push({ drawing: d, target, distance: dist });
    }
    const valid = pts.filter((p): p is XY => p != null);
    const curve =
      valid.length >= 4
        ? cubic(valid[0], valid[1], valid[2], valid[3])
        : valid;
    let best = Infinity;
    for (let i = 0; i < curve.length - 1; i++)
      best = Math.min(best, distToSegment(px, py, curve[i].x, curve[i].y, curve[i + 1].x, curve[i + 1].y));
    if (best < TOL) results.push({ drawing: d, target: "body", distance: best });
    return results;
  },
  movePoints: defaultMovePoints,
  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return d.points
      .map((pt, i) => {
        const x = toX(pt.time),
          y = toY(pt.price);
        const target = (i === 0 ? "p0" : i === 1 ? "p1" : i === 2 ? "p2" : "body") as
          | "p0"
          | "p1"
          | "p2"
          | "body";
        return { index: i, x, y, target };
      })
      .filter((a) => a.x != null && a.y != null);
  },
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const xs = d.points.map((pt) => toX(pt.time)).filter((v): v is number => v != null);
    const ys = d.points.map((pt) => toY(pt.price)).filter((v): v is number => v != null);
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
