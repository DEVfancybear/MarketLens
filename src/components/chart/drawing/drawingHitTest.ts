/**
 * DrawingHitTest — pure hit-testing for drawing objects.
 *
 * Given a set of drawings and a (time,price) point, returns the topmost
 * hit with target discrimination (endpoint vs body). Used by DrawingLayer
 * for selection + drag and by DrawingContextMenu for right-click targeting.
 *
 * Covers all tool types. No React, no state — pure function.
 */
import type { Drawing, Point } from "@/types";

export type HitTestProjector = (v: number) => number | null;

/** Which part of a drawing was hit — drives drag behaviour. */
export type HitResult = {
  drawing: Drawing;
  target: "p1" | "p2" | "body";
};

const TOL = 8;
const HANDLE_RADIUS = 10;

function nearPoint(px: number, py: number, x: number, y: number): boolean {
  return Math.hypot(px - x, py - y) <= HANDLE_RADIUS;
}

export function hitTest(
  drawings: Drawing[],
  p: Point,
  toX: HitTestProjector,
  toY: HitTestProjector,
): HitResult | null {
  const px = toX(p.time);
  const py = toY(p.price);
  if (px == null || py == null) return null;

  const sorted = [...drawings].sort(
    (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
  );
  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = sorted[i];
    if (d.visible === false) continue;
    const result = resolveHit(d, px, py, toX, toY);
    if (result) return result;
  }
  return null;
}

function resolveHit(
  d: Drawing,
  px: number,
  py: number,
  toX: HitTestProjector,
  toY: HitTestProjector,
): HitResult | null {
  const pts = d.points;

  switch (d.tool) {
    case "horizontal":
    case "horizRay": {
      const y = toY(pts[0].price);
      if (y != null && Math.abs(y - py) < TOL) {
        return { drawing: d, target: "body" };
      }
      return null;
    }
    case "vertical":
    case "crossLine": {
      const x = toX(pts[0].time);
      if (x != null && Math.abs(x - px) < TOL) {
        return { drawing: d, target: "body" };
      }
      return null;
    }
    case "text":
    case "emoji": {
      const x = toX(pts[0].time);
      const y = toY(pts[0].price);
      if (
        x != null &&
        y != null &&
        Math.abs(x - px) < 40 &&
        Math.abs(y - py) < 14
      ) {
        return { drawing: d, target: "body" };
      }
      return null;
    }
    case "long":
    case "short": {
      const yE = toY(pts[0].price);
      if (yE != null && Math.abs(yE - py) < TOL) {
        return { drawing: d, target: "body" };
      }
      const xL = toX(pts[0].time);
      const xR = pts[1] ? toX(pts[1].time) : null;
      if (xL == null) return null;
      const right = xR ?? xL + 130;
      const yS = d.stop != null ? toY(d.stop) : null;
      const yT = d.target != null ? toY(d.target) : null;
      const inX =
        px >= Math.min(xL, right) - TOL && px <= Math.max(xL, right) + TOL;
      const inY =
        (yS != null && py >= yS - TOL && py <= yS + TOL) ||
        (yT != null && py >= yT - TOL && py <= yT + TOL);
      if (inX && (inY || (yE != null && Math.abs(yE - py) < TOL))) {
        return { drawing: d, target: "body" };
      }
      return null;
    }
    case "brush": {
      for (let j = 0; j < pts.length - 1; j++) {
        const a = toX(pts[j].time),
          b = toY(pts[j].price);
        const c = toX(pts[j + 1].time),
          d2 = toY(pts[j + 1].price);
        if (
          a != null &&
          b != null &&
          c != null &&
          d2 != null &&
          distToSegment(px, py, a, b, c, d2) < TOL
        )
          return { drawing: d, target: "body" };
      }
      return null;
    }
  }

  // Two-point tools.
  if (pts.length < 2) return null;
  const x1 = toX(pts[0].time),
    y1 = toY(pts[0].price);
  const x2 = toX(pts[1].time),
    y2 = toY(pts[1].price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return null;

  // ---- All 2-point tools — endpoint priority: p1 → p2 → body ----
  if (nearPoint(px, py, x1, y1)) return { drawing: d, target: "p1" };
  if (nearPoint(px, py, x2, y2)) return { drawing: d, target: "p2" };

  switch (d.tool) {
    case "trendline":
    case "ray":
    case "extendedLine":
    case "infoLine":
    case "channel":
      if (distToSegment(px, py, x1, y1, x2, y2) < TOL)
        return { drawing: d, target: "body" };
      return null;
    case "rectangle":
    case "rotatedRect":
    case "fib":
      if (
        px >= Math.min(x1, x2) - TOL &&
        px <= Math.max(x1, x2) + TOL &&
        py >= Math.min(y1, y2) - TOL &&
        py <= Math.max(y1, y2) + TOL
      )
        return { drawing: d, target: "body" };
      return null;
    case "circle": {
      const r = Math.hypot(x2 - x1, y2 - y1);
      if (
        Math.abs(Math.hypot(px - x1, py - y1) - r) < TOL ||
        Math.hypot(px - x1, py - y1) <= r + TOL
      )
        return { drawing: d, target: "body" };
      return null;
    }
    case "ellipse": {
      if (
        px >= Math.min(x1, x2) - TOL &&
        px <= Math.max(x1, x2) + TOL &&
        py >= Math.min(y1, y2) - TOL &&
        py <= Math.max(y1, y2) + TOL
      )
        return { drawing: d, target: "body" };
      return null;
    }
    case "triangle":
    case "polyline":
    case "curve":
    case "path": {
      for (let j = 0; j < pts.length - 1; j++) {
        const a = toX(pts[j].time),
          b = toY(pts[j].price);
        const c = toX(pts[j + 1].time),
          d2 = toY(pts[j + 1].price);
        if (
          a != null &&
          b != null &&
          c != null &&
          d2 != null &&
          distToSegment(px, py, a, b, c, d2) < TOL * 1.5
        )
          return { drawing: d, target: "body" };
      }
      // Also check bounding box of all points.
      const xs = pts
        .map((p) => toX(p.time))
        .filter((v): v is number => v != null);
      const ys = pts
        .map((p) => toY(p.price))
        .filter((v): v is number => v != null);
      if (xs.length && ys.length) {
        const minX = Math.min(...xs),
          maxX = Math.max(...xs);
        const minY = Math.min(...ys),
          maxY = Math.max(...ys);
        if (
          px >= minX - TOL &&
          px <= maxX + TOL &&
          py >= minY - TOL &&
          py <= maxY + TOL
        )
          return { drawing: d, target: "body" };
      }
      return null;
    }
  }
  return null;
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1,
    dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
