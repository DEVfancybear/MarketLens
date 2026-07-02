/**
 * RotatedRectTool — TradingView-style 3-point rotated rectangle.
 *
 *   points[0]→points[1] define one edge (any angle).
 *   points[2] sets the perpendicular width (and therefore the rotation).
 *
 * The rectangle corners are A=p0, B=p1, C=B+offset, D=A+offset, where `offset`
 * is the projection of (p2−p1) onto the unit normal of the base edge.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  type Anchor,
  registerTool,
  defaultMovePoints,
  HANDLE_RADIUS,
  TOL,
  pointDist,
  distToSegment,
} from "../ToolRegistry";
import { handle, applyStyle, renderShapeText } from "./shared";

type XY = { x: number; y: number };

/** Compute the 4 screen-space corners from the 3 control points (or null). */
function corners(
  d: Drawing,
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
): { a: XY; b: XY; c: XY; e: XY } | null {
  const p0 = d.points[0],
    p1 = d.points[1],
    p2 = d.points[2];
  if (!p0 || !p1) return null;
  const ax = toX(p0.time),
    ay = toY(p0.price);
  const bx = toX(p1.time),
    by = toY(p1.price);
  if (ax == null || ay == null || bx == null || by == null) return null;
  const a: XY = { x: ax, y: ay };
  const b: XY = { x: bx, y: by };
  // Unit normal of the base edge a→b.
  let nx = -(by - ay),
    ny = bx - ax;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  // Perpendicular offset from the 3rd point (0 while still 2-point preview).
  let off = 0;
  if (p2) {
    const cx = toX(p2.time),
      cy = toY(p2.price);
    if (cx != null && cy != null) off = (cx - bx) * nx + (cy - by) * ny;
  }
  const ox = nx * off,
    oy = ny * off;
  return {
    a,
    b,
    c: { x: bx + ox, y: by + oy }, // corner opposite b
    e: { x: ax + ox, y: ay + oy }, // corner opposite a
  };
}

/** Even-odd point-in-polygon test. */
function inPoly(px: number, py: number, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y,
      xj = poly[j].x,
      yj = poly[j].y;
    if (
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

const plugin: DrawingToolPlugin = {
  tool: "rotatedRect",
  minPoints: 2,
  maxPoints: 3,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const c = corners(d, proj.toX, proj.toY);
    if (!c) return;
    g.save();
    applyStyle(g, d.lineStyle);
    g.beginPath();
    g.moveTo(c.a.x, c.a.y);
    g.lineTo(c.b.x, c.b.y);
    g.lineTo(c.c.x, c.c.y);
    g.lineTo(c.e.x, c.e.y);
    g.closePath();
    if (d.fillColor && d.fillColor !== "none") {
      g.globalAlpha = d.opacity ?? 0.3;
      g.fillStyle = d.fillColor;
      g.fill();
      g.globalAlpha = 1;
    }
    g.stroke();
    g.restore();
    // Axis-aligned bounding box of the (possibly rotated) quad — text stays
    // upright rather than rotating with the rectangle, matching how the
    // engine renders every other shape's inner label.
    const cxs = [c.a.x, c.b.x, c.c.x, c.e.x];
    const cys = [c.a.y, c.b.y, c.c.y, c.e.y];
    renderShapeText(
      g,
      d,
      Math.min(...cxs),
      Math.min(...cys),
      Math.max(...cxs) - Math.min(...cxs),
      Math.max(...cys) - Math.min(...cys),
    );
    if (selected) {
      handle(g, c.a.x, c.a.y, d.color);
      handle(g, c.b.x, c.b.y, d.color);
      if (d.points[2]) handle(g, c.c.x, c.c.y, d.color);
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
    const c = corners(d, toX, toY);
    if (!c) return results;
    // Handles map to the control points: a=p0, b=p1, width corner=p2.
    const dA = pointDist(px, py, c.a.x, c.a.y);
    const dB = pointDist(px, py, c.b.x, c.b.y);
    const dC = pointDist(px, py, c.c.x, c.c.y);
    if (dA <= HANDLE_RADIUS)
      results.push({ drawing: d, target: "p0", distance: dA });
    if (dB <= HANDLE_RADIUS)
      results.push({ drawing: d, target: "p1", distance: dB });
    if (d.points[2] && dC <= HANDLE_RADIUS)
      results.push({ drawing: d, target: "p2", distance: dC });
    // Body: inside the quad, or near any edge.
    const quad = [c.a, c.b, c.c, c.e];
    let edge = Infinity;
    for (let i = 0; i < quad.length; i++) {
      const n = quad[(i + 1) % quad.length];
      edge = Math.min(edge, distToSegment(px, py, quad[i].x, quad[i].y, n.x, n.y));
    }
    if (edge < TOL || inPoly(px, py, quad))
      results.push({ drawing: d, target: "body", distance: Math.max(2, edge) });
    return results;
  },
  movePoints: defaultMovePoints,
  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector): Anchor[] {
    const c = corners(d, toX, toY);
    if (!c) return [];
    const anchors: Anchor[] = [
      { index: 0, x: c.a.x, y: c.a.y, target: "p0" },
      { index: 1, x: c.b.x, y: c.b.y, target: "p1" },
    ];
    if (d.points[2])
      anchors.push({ index: 2, x: c.c.x, y: c.c.y, target: "p2" });
    return anchors;
  },
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const c = corners(d, toX, toY);
    if (!c) return null;
    const xs = [c.a.x, c.b.x, c.c.x, c.e.x];
    const ys = [c.a.y, c.b.y, c.c.y, c.e.y];
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
};

registerTool(plugin);
