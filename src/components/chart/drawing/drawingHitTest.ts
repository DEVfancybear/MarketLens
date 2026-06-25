/**
 * DrawingHitTest — pure hit-testing for drawing objects.
 *
 * Given a set of drawings and a (time,price) point, returns the topmost
 * drawing under the cursor. Used by DrawingLayer for selection and by
 * DrawingContextMenu (Phase 4.3) for right-click targeting.
 *
 * All coordinates are in chart (time,price) space; callers must provide
 * projector functions that convert to pixel space.
 *
 * Covers all 17 tool types. No React, no state — pure function.
 */
import type { Drawing, Point } from '@/types';

export type HitTestProjector = (v: number) => number | null;

const TOL = 8; // pixel tolerance

/**
 * Hit-test all drawings. Iterates in reverse z-index order so the
 * topmost drawing wins. Returns the first drawing whose geometry
 * contains the cursor position within `TOL` pixels.
 */
export function hitTest(
  drawings: Drawing[],
  p: Point,
  toX: HitTestProjector,
  toY: HitTestProjector,
): Drawing | null {
  const px = toX(p.time);
  const py = toY(p.price);
  if (px == null || py == null) return null;

  // Sort by zIndex ascending so higher-zIndex drawings at the end
  // are tested first (reverse iteration).
  const sorted = [...drawings].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = sorted[i];
    if (d.visible === false) continue;

    if (isHit(d, px, py, toX, toY)) return d;
  }
  return null;
}

/** Check whether a single drawing contains the cursor at (px, py). */
function isHit(
  d: Drawing,
  px: number,
  py: number,
  toX: HitTestProjector,
  toY: HitTestProjector,
): boolean {
  const pts = d.points;

  switch (d.tool) {
    case 'horizontal': {
      const y = toY(pts[0].price);
      return y != null && Math.abs(y - py) < TOL;
    }
    case 'vertical': {
      const x = toX(pts[0].time);
      return x != null && Math.abs(x - px) < TOL;
    }
    case 'text':
    case 'emoji': {
      const x = toX(pts[0].time);
      const y = toY(pts[0].price);
      return x != null && y != null && Math.abs(x - px) < 40 && Math.abs(y - py) < 14;
    }
    case 'long':
    case 'short': {
      // Hit the entry price line or the risk/reward box.
      const yE = toY(pts[0].price);
      if (yE != null && Math.abs(yE - py) < TOL) return true;
      const xL = toX(pts[0].time);
      const xR = pts[1] ? toX(pts[1].time) : null;
      if (xL == null) return false;
      const right = xR ?? xL + 130;
      const yS = d.stop != null ? toY(d.stop) : null;
      const yT = d.target != null ? toY(d.target) : null;
      const inX = px >= Math.min(xL, right) - TOL && px <= Math.max(xL, right) + TOL;
      const inY = (yS != null && py >= yS - TOL && py <= yS + TOL) ||
                  (yT != null && py >= yT - TOL && py <= yT + TOL);
      return inX && (inY || (yE != null && Math.abs(yE - py) < TOL));
    }
    case 'brush': {
      // Hit any point along the freehand path.
      for (let j = 0; j < pts.length - 1; j++) {
        const a = toX(pts[j].time);
        const b = toY(pts[j].price);
        const c = toX(pts[j + 1].time);
        const d2 = toY(pts[j + 1].price);
        if (a != null && b != null && c != null && d2 != null && distToSegment(px, py, a, b, c, d2) < TOL) return true;
      }
      return false;
    }
  }

  // Multi-point tools: must have at least 2 points.
  if (pts.length < 2) return false;

  const x1 = toX(pts[0].time);
  const y1 = toY(pts[0].price);
  const x2 = toX(pts[1].time);
  const y2 = toY(pts[1].price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return false;

  switch (d.tool) {
    case 'trendline':
    case 'channel':
      return distToSegment(px, py, x1, y1, x2, y2) < TOL;
    case 'rectangle':
    case 'fib':
      return px >= Math.min(x1, x2) - TOL && px <= Math.max(x1, x2) + TOL &&
             py >= Math.min(y1, y2) - TOL && py <= Math.max(y1, y2) + TOL;
  }

  return false;
}

/** Minimum distance from point (px,py) to line segment (x1,y1)→(x2,y2). */
function distToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
