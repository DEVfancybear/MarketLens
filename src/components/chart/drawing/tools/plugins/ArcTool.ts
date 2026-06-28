/**
 * ArcTool — TradingView-style 3-point arc.
 *
 *   points[0] = start, points[1] = end, points[2] = peak the curve passes through.
 *
 * Rendered as a quadratic Bézier whose control point is positioned so the curve
 * passes exactly through the peak at t = 0.5.
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

/** Quadratic control so the curve passes through `peak` at t = 0.5. */
function control(a: XY, b: XY, peak: XY): XY {
  return { x: 2 * peak.x - 0.5 * (a.x + b.x), y: 2 * peak.y - 0.5 * (a.y + b.y) };
}

function sample(a: XY, c: XY, b: XY, n = 20): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      mt = 1 - t;
    out.push({
      x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
      y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y,
    });
  }
  return out;
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
    const a = d.points[0] && pj(d.points[0], proj.toX, proj.toY);
    const b = d.points[1] && pj(d.points[1], proj.toX, proj.toY);
    if (!a || !b) return;
    const peak = d.points[2] && pj(d.points[2], proj.toX, proj.toY);
    g.save();
    applyStyle(g, d.lineStyle);
    g.beginPath();
    g.moveTo(a.x, a.y);
    if (peak) g.quadraticCurveTo(control(a, b, peak).x, control(a, b, peak).y, b.x, b.y);
    else g.lineTo(b.x, b.y);
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
    const results: HitResult[] = [];
    const a = d.points[0] && pj(d.points[0], toX, toY);
    const b = d.points[1] && pj(d.points[1], toX, toY);
    if (!a || !b) return results;
    const peak = d.points[2] && pj(d.points[2], toX, toY);
    if (pointDist(px, py, a.x, a.y) <= HANDLE_RADIUS)
      results.push({ drawing: d, target: "p0", distance: pointDist(px, py, a.x, a.y) });
    if (pointDist(px, py, b.x, b.y) <= HANDLE_RADIUS)
      results.push({ drawing: d, target: "p1", distance: pointDist(px, py, b.x, b.y) });
    if (peak && pointDist(px, py, peak.x, peak.y) <= HANDLE_RADIUS)
      results.push({ drawing: d, target: "p2", distance: pointDist(px, py, peak.x, peak.y) });
    // Body: distance to the sampled curve (or the straight base before the peak).
    const pts = peak ? sample(a, control(a, b, peak), b) : [a, b];
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++)
      best = Math.min(best, distToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y));
    if (best < TOL) results.push({ drawing: d, target: "body", distance: best });
    return results;
  },
  movePoints: defaultMovePoints,
  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return d.points
      .map((pt, i) => {
        const x = toX(pt.time),
          y = toY(pt.price);
        const target = (i === 0 ? "p0" : i === 1 ? "p1" : "p2") as
          | "p0"
          | "p1"
          | "p2";
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
