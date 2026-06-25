/**
 * DrawingHitTest — pure hit-testing for drawing objects.
 *
 * Given a set of drawings and a (time,price) point, returns the topmost
 * drawing under the cursor. Used by DrawingLayer for selection and by
 * DrawingContextMenu for right-click targeting.
 *
 * Covers all tool types. No React, no state — pure function.
 */
import type { Drawing, Point } from "@/types";

export type HitTestProjector = (v: number) => number | null;

const TOL = 8;

export function hitTest(
  drawings: Drawing[],
  p: Point,
  toX: HitTestProjector,
  toY: HitTestProjector,
): Drawing | null {
  const px = toX(p.time);
  const py = toY(p.price);
  if (px == null || py == null) return null;

  const sorted = [...drawings].sort(
    (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
  );
  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = sorted[i];
    if (d.visible === false) continue;
    if (isHit(d, px, py, toX, toY)) return d;
  }
  return null;
}

function isHit(
  d: Drawing,
  px: number,
  py: number,
  toX: HitTestProjector,
  toY: HitTestProjector,
): boolean {
  const pts = d.points;

  switch (d.tool) {
    case "horizontal":
    case "horizRay": {
      const y = toY(pts[0].price);
      return y != null && Math.abs(y - py) < TOL;
    }
    case "vertical":
    case "crossLine": {
      const x = toX(pts[0].time);
      return x != null && Math.abs(x - px) < TOL;
    }
    case "text":
    case "emoji": {
      const x = toX(pts[0].time);
      const y = toY(pts[0].price);
      return (
        x != null && y != null && Math.abs(x - px) < 40 && Math.abs(y - py) < 14
      );
    }
    case "long":
    case "short": {
      const yE = toY(pts[0].price);
      if (yE != null && Math.abs(yE - py) < TOL) return true;
      const xL = toX(pts[0].time);
      const xR = pts[1] ? toX(pts[1].time) : null;
      if (xL == null) return false;
      const right = xR ?? xL + 130;
      const yS = d.stop != null ? toY(d.stop) : null;
      const yT = d.target != null ? toY(d.target) : null;
      const inX =
        px >= Math.min(xL, right) - TOL && px <= Math.max(xL, right) + TOL;
      const inY =
        (yS != null && py >= yS - TOL && py <= yS + TOL) ||
        (yT != null && py >= yT - TOL && py <= yT + TOL);
      return inX && (inY || (yE != null && Math.abs(yE - py) < TOL));
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
          return true;
      }
      return false;
    }
  }

  // Two-point tools.
  if (pts.length < 2) return false;
  const x1 = toX(pts[0].time),
    y1 = toY(pts[0].price);
  const x2 = toX(pts[1].time),
    y2 = toY(pts[1].price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return false;

  switch (d.tool) {
    case "trendline":
    case "ray":
    case "extendedLine":
    case "infoLine":
    case "channel":
      return distToSegment(px, py, x1, y1, x2, y2) < TOL;
    case "rectangle":
    case "rotatedRect":
    case "fib":
      return (
        px >= Math.min(x1, x2) - TOL &&
        px <= Math.max(x1, x2) + TOL &&
        py >= Math.min(y1, y2) - TOL &&
        py <= Math.max(y1, y2) + TOL
      );
    case "circle": {
      const r = Math.hypot(x2 - x1, y2 - y1);
      return (
        Math.abs(Math.hypot(px - x1, py - y1) - r) < TOL ||
        Math.hypot(px - x1, py - y1) <= r + TOL
      );
    }
    case "ellipse": {
      // Hit inside the bounding box as approximation.
      return (
        px >= Math.min(x1, x2) - TOL &&
        px <= Math.max(x1, x2) + TOL &&
        py >= Math.min(y1, y2) - TOL &&
        py <= Math.max(y1, y2) + TOL
      );
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
          return true;
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
          return true;
      }
      return false;
    }
  }
  return false;
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
