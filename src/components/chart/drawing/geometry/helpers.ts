/**
 * Geometry helpers — shared math functions used by tool plugins.
 *
 * All functions are pure (no state, no side effects).
 * Every tool plugin imports from here rather than duplicating math.
 */
import type { Point } from "@/types";

export const HANDLE_RADIUS = 10;
export const TOL = 8;

/** Euclidean distance between two pixel points. */
export function pointDist(px: number, py: number, x: number, y: number): number {
  return Math.hypot(px - x, py - y);
}

/** Shortest distance from pixel point to line segment. */
export function distToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Distance from pixel point to axis-aligned rectangle (0 if inside). */
export function distToRect(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const left = Math.min(x1, x2), right = Math.max(x1, x2);
  const top = Math.min(y1, y2), bottom = Math.max(y1, y2);
  if (px >= left && px <= right && py >= top && py <= bottom) return 0;
  return Math.hypot(
    Math.max(left - px, 0, px - right),
    Math.max(top - py, 0, py - bottom),
  );
}

/** Project a (time,price) point to pixel coordinates. */
export function projectPoint(
  pt: Point,
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
): { x: number; y: number } | null {
  const x = toX(pt.time), y = toY(pt.price);
  return x != null && y != null ? { x, y } : null;
}

/** Default movePoints logic (works for most 2-point tools). */
export function defaultMovePoints(
  origPoints: Point[], pointer: Point,
  dragTarget: "p1" | "p2" | "body", dragStart: Point,
): Point[] {
  const next = origPoints.map((pt) => ({ ...pt }));
  if (dragTarget === "p1") {
    next[0] = { time: pointer.time, price: pointer.price };
  } else if (dragTarget === "p2" && next.length > 1) {
    next[1] = { time: pointer.time, price: pointer.price };
  } else {
    const dt = pointer.time - dragStart.time;
    const dp = pointer.price - dragStart.price;
    for (let i = 0; i < next.length; i++) {
      next[i] = { time: origPoints[i].time + dt, price: origPoints[i].price + dp };
    }
  }
  return next;
}
