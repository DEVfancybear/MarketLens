/**
 * DrawingHitTest — pure hit-testing for drawing objects.
 *
 * Given a set of drawings and a (time,price) point, returns the best
 * hit candidate with target discrimination and pixel distance.
 * Used by DrawingLayer for selection + drag and by DrawingContextMenu
 * for right-click targeting.
 *
 * Architecture:
 *   1. Each tool's resolver computes all viable hit candidates for that drawing.
 *   2. Endpoints (p1/p2) have priority over segments, segments over body/label.
 *   3. Within a target category, the closest candidate (by pixel distance) wins.
 *   4. Across drawings, higher zIndex wins.
 *   5. Add new tools by adding a case in resolveAllHits() only.
 *
 * No React, no state — pure function.
 */
import type { Drawing, Point } from "@/types";

export type HitTestProjector = (v: number) => number | null;

/** Part of the drawing that was hit + pixel distance from pointer. */
export type HitResult = {
  drawing: Drawing;
  target: "body" | "p1" | "p2" | "segment" | "label";
  /** Pixel distance from the pointer to the hit target. */
  distance: number;
};

const TOL = 8;
const HANDLE_RADIUS = 10;

// ---- Distance helpers ----

function pointDist(px: number, py: number, x: number, y: number): number {
  return Math.hypot(px - x, py - y);
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

function distToRect(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const left = Math.min(x1, x2),
    right = Math.max(x1, x2);
  const top = Math.min(y1, y2),
    bottom = Math.max(y1, y2);
  if (px >= left && px <= right && py >= top && py <= bottom) return 0;
  const dx = Math.max(left - px, 0, px - right);
  const dy = Math.max(top - py, 0, py - bottom);
  return Math.hypot(dx, dy);
}

function distToCircle(
  px: number,
  py: number,
  cx: number,
  cy: number,
  r: number,
): number {
  return Math.abs(Math.hypot(px - cx, py - cy) - r);
}

// ---- Candidate collector ----

/** Priority ordering: lower = more important. */
const TARGET_PRIORITY: Record<HitResult["target"], number> = {
  p1: 0,
  p2: 0, // endpoints are equal priority — distance breaks tie
  segment: 1,
  label: 2,
  body: 3,
};

// ---- Public API ----

export function hitTest(
  drawings: Drawing[],
  p: Point,
  toX: HitTestProjector,
  toY: HitTestProjector,
): HitResult | null {
  const px = toX(p.time);
  const py = toY(p.price);
  if (px == null || py == null) return null;

  // Collect all viable hits across all visible drawings.
  const all: { drawing: Drawing; candidates: HitResult[] }[] = [];
  for (const d of drawings) {
    if (d.visible === false) continue;
    const candidates = resolveAllHits(d, px, py, toX, toY);
    if (candidates.length > 0) all.push({ drawing: d, candidates });
  }

  if (all.length === 0) return null;

  // Pick the best candidate: highest zIndex first, then within a drawing
  // pick by target priority then by distance.
  all.sort((a, b) => (a.drawing.zIndex ?? 0) - (b.drawing.zIndex ?? 0));

  let best: HitResult | null = null;
  for (const { drawing, candidates } of all) {
    let bestForDrawing: HitResult | null = null;
    for (const c of candidates) {
      if (
        !bestForDrawing ||
        TARGET_PRIORITY[c.target] < TARGET_PRIORITY[bestForDrawing.target] ||
        (TARGET_PRIORITY[c.target] === TARGET_PRIORITY[bestForDrawing.target] &&
          c.distance < bestForDrawing.distance)
      ) {
        bestForDrawing = c;
      }
    }
    if (bestForDrawing) {
      // Higher z-index drawing wins; replace any previous best.
      if (!best || (drawing.zIndex ?? 0) > (best.drawing.zIndex ?? 0)) {
        best = bestForDrawing;
      }
    }
  }

  return best;
}

// ---- Per-tool hit resolution ----
// Each returns an array of HitResult candidates. The caller picks the best.

function resolveAllHits(
  d: Drawing,
  px: number,
  py: number,
  toX: HitTestProjector,
  toY: HitTestProjector,
): HitResult[] {
  const pts = d.points;
  const results: HitResult[] = [];

  // ---- Single-point tools ----
  switch (d.tool) {
    case "horizontal":
    case "horizRay": {
      const y = toY(pts[0].price);
      if (y != null && Math.abs(y - py) < TOL) {
        results.push({
          drawing: d,
          target: "body",
          distance: Math.abs(y - py),
        });
      }
      return results;
    }
    case "vertical":
    case "crossLine": {
      const x = toX(pts[0].time);
      if (x != null && Math.abs(x - px) < TOL) {
        results.push({
          drawing: d,
          target: "body",
          distance: Math.abs(x - px),
        });
      }
      return results;
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
        results.push({
          drawing: d,
          target: "label",
          distance: Math.max(Math.abs(x - px), Math.abs(y - py)),
        });
      }
      return results;
    }
    case "long":
    case "short": {
      const yE = toY(pts[0].price);
      if (yE != null && Math.abs(yE - py) < TOL) {
        results.push({
          drawing: d,
          target: "body",
          distance: Math.abs(yE - py),
        });
      }
      const xL = toX(pts[0].time);
      const xR = pts[1] ? toX(pts[1].time) : null;
      if (xL != null) {
        const right = xR ?? xL + 130;
        const inX =
          px >= Math.min(xL, right) - TOL && px <= Math.max(xL, right) + TOL;
        const yS = d.stop != null ? toY(d.stop) : null;
        const yT = d.target != null ? toY(d.target) : null;
        const inY =
          (yS != null && py >= yS - TOL && py <= yS + TOL) ||
          (yT != null && py >= yT - TOL && py <= yT + TOL);
        if (inX && (inY || (yE != null && Math.abs(yE - py) < TOL))) {
          const dist =
            yS != null ? Math.abs(yS - py) : yT != null ? Math.abs(yT - py) : 0;
          results.push({ drawing: d, target: "body", distance: dist });
        }
      }
      return results;
    }
    case "brush": {
      for (let j = 0; j < pts.length - 1; j++) {
        const a = toX(pts[j].time),
          b = toY(pts[j].price);
        const c = toX(pts[j + 1].time),
          d2 = toY(pts[j + 1].price);
        if (a != null && b != null && c != null && d2 != null) {
          const dist = distToSegment(px, py, a, b, c, d2);
          if (dist < TOL)
            results.push({ drawing: d, target: "segment", distance: dist });
        }
      }
      return results;
    }
  }

  // ---- Multi-point tools ----
  if (pts.length < 2) return results;

  // Collect converted coordinates for all points.
  const projected = pts.map((pt) => ({ x: toX(pt.time), y: toY(pt.price) }));
  // Check endpoints: p1 and p2 (first and last anchor).
  for (let idx = 0; idx < projected.length; idx++) {
    const pt = projected[idx];
    if (pt.x == null || pt.y == null) continue;
    const dist = pointDist(px, py, pt.x, pt.y);
    if (dist <= HANDLE_RADIUS) {
      const target =
        idx === 0
          ? ("p1" as const)
          : idx === projected.length - 1
            ? ("p2" as const)
            : ("body" as const);
      results.push({ drawing: d, target, distance: dist });
    }
  }

  // ---- Body / segment hit tests per tool type ----
  const x1 = projected[0].x!,
    y1 = projected[0].y!;
  const x2 = projected[projected.length - 1].x!,
    y2 = projected[projected.length - 1].y!;
  if (x1 == null || y1 == null || x2 == null || y2 == null) return results;

  switch (d.tool) {
    case "trendline":
    case "ray":
    case "extendedLine":
    case "infoLine":
    case "channel": {
      const dist = distToSegment(px, py, x1, y1, x2, y2);
      if (dist < TOL)
        results.push({ drawing: d, target: "segment", distance: dist });
      break;
    }
    case "rectangle":
    case "rotatedRect": {
      const dist = distToRect(px, py, x1, y1, x2, y2);
      if (dist < TOL)
        results.push({ drawing: d, target: "body", distance: dist });
      break;
    }
    case "fib": {
      const dist = distToRect(px, py, x1, y1, x2, y2);
      if (dist < TOL)
        results.push({ drawing: d, target: "body", distance: dist });
      break;
    }
    case "circle": {
      const r = pointDist(x2, y2, x1, y1);
      const dCenter = pointDist(px, py, x1, y1);
      if (dCenter <= r + TOL) {
        const edgeDist = distToCircle(px, py, x1, y1, r);
        results.push({
          drawing: d,
          target: "body",
          distance: Math.min(dCenter, edgeDist),
        });
      }
      break;
    }
    case "ellipse": {
      const dist = distToRect(px, py, x1, y1, x2, y2);
      if (dist < TOL)
        results.push({ drawing: d, target: "body", distance: dist });
      break;
    }
    case "triangle":
    case "polyline":
    case "curve":
    case "path": {
      // Hit each segment.
      for (let j = 0; j < projected.length - 1; j++) {
        const a = projected[j],
          b = projected[j + 1];
        if (a.x == null || a.y == null || b.x == null || b.y == null) continue;
        const dist = distToSegment(px, py, a.x, a.y, b.x, b.y);
        if (dist < TOL * 1.5)
          results.push({ drawing: d, target: "segment", distance: dist });
      }
      // Also bounding box.
      const xs = projected
        .map((p) => p.x)
        .filter((v): v is number => v != null);
      const ys = projected
        .map((p) => p.y)
        .filter((v): v is number => v != null);
      if (xs.length > 1 && ys.length > 1) {
        const dist = distToRect(
          px,
          py,
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        );
        if (dist < TOL)
          results.push({ drawing: d, target: "body", distance: dist });
      }
      break;
    }
  }

  return results;
}
