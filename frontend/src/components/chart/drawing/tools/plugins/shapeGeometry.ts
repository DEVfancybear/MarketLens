/**
 * Shared geometry helpers for shape-like drawing tools.
 *
 * These helpers keep TradingView-style shape behavior consistent across
 * Rectangle / Ellipse / Triangle / Polyline / Path / Arc / Curve tools:
 * anchors are always draggable, bodies are selectable from visible stroke/fill,
 * and bounding boxes include the full sampled curve rather than only raw
 * control points.
 */
import type { Point } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import { HANDLE_RADIUS, TOL, distToSegment, pointDist } from "../ToolRegistry";

export type XY = { x: number; y: number };

export function projectPoint(
  pt: Point,
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
): XY | null {
  const x = toX(pt.time);
  const y = toY(pt.price);
  return x != null && y != null ? { x, y } : null;
}

export function projectPoints(
  points: Point[],
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
): Array<XY | null> {
  return points.map((pt) => projectPoint(pt, toX, toY));
}

export function visiblePoints(points: Array<XY | null>): XY[] {
  return points.filter((pt): pt is XY => pt != null);
}

export function boundsFromPoints(points: XY[], pad = 0) {
  if (points.length === 0) return null;
  const xs = points.map((pt) => pt.x);
  const ys = points.map((pt) => pt.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    x: left - pad,
    y: top - pad,
    w: right - left + pad * 2,
    h: bottom - top + pad * 2,
  };
}

export function vertexTarget(index: number, lastIndex: number): HitResult["target"] {
  if (index === 0) return "p1";
  if (index === lastIndex) return "p2";
  return "p0";
}

export function anchorHits(
  drawing: HitResult["drawing"],
  projected: Array<XY | null>,
  px: number,
  py: number,
): HitResult[] {
  const lastIndex = projected.length - 1;
  const hits: HitResult[] = [];
  for (let i = 0; i < projected.length; i++) {
    const pt = projected[i];
    if (!pt) continue;
    const distance = pointDist(px, py, pt.x, pt.y);
    if (distance <= HANDLE_RADIUS) {
      hits.push({
        drawing,
        target: vertexTarget(i, lastIndex),
        anchorIndex: i,
        distance,
      });
    }
  }
  return hits;
}

export function anchorsFromProjected(
  projected: Array<XY | null>,
): { index: number; x: number | null; y: number | null; target: HitResult["target"] }[] {
  const lastIndex = projected.length - 1;
  return projected.map((pt, index) => ({
    index,
    x: pt?.x ?? null,
    y: pt?.y ?? null,
    target: vertexTarget(index, lastIndex),
  }));
}

export function segmentBodyHits(
  drawing: HitResult["drawing"],
  projected: Array<XY | null>,
  px: number,
  py: number,
  closed = false,
  tolerance = TOL * 1.5,
): HitResult[] {
  const hits: HitResult[] = [];
  const max = closed ? projected.length : projected.length - 1;
  for (let i = 0; i < max; i++) {
    const a = projected[i];
    const b = projected[(i + 1) % projected.length];
    if (!a || !b) continue;
    const distance = distToSegment(px, py, a.x, a.y, b.x, b.y);
    if (distance < tolerance) hits.push({ drawing, target: "body", distance });
  }
  return hits;
}

export function pointInPolygon(px: number, py: number, polygon: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.y > py !== b.y > py;
    if (crosses && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonBodyHits(
  drawing: HitResult["drawing"],
  polygon: XY[],
  px: number,
  py: number,
  tolerance = TOL * 1.5,
): HitResult[] {
  const edgeHits = segmentBodyHits(drawing, polygon, px, py, true, tolerance);
  if (edgeHits.length > 0) return edgeHits;
  if (pointInPolygon(px, py, polygon)) {
    return [{ drawing, target: "body", distance: tolerance }];
  }
  return [];
}

export function ellipseBodyHit(
  drawing: HitResult["drawing"],
  px: number,
  py: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): HitResult[] {
  if (rx <= 0 || ry <= 0) return [];
  const nx = (px - cx) / rx;
  const ny = (py - cy) / ry;
  const normalized = Math.hypot(nx, ny);
  const approxRadius = (rx + ry) / 2;
  const edgeDistance = Math.abs(normalized - 1) * approxRadius;
  if (normalized <= 1 || edgeDistance < TOL) {
    return [{ drawing, target: "body", distance: Math.min(edgeDistance, TOL) }];
  }
  return [];
}

export function quadControlThroughPoint(a: XY, b: XY, peak: XY): XY {
  return {
    x: 2 * peak.x - 0.5 * (a.x + b.x),
    y: 2 * peak.y - 0.5 * (a.y + b.y),
  };
}

export function sampleQuadratic(a: XY, c: XY, b: XY, n = 32): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    out.push({
      x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
      y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y,
    });
  }
  return out;
}

export function sampleCubic(p0: XY, p1: XY, p2: XY, p3: XY, n = 36): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    out.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
  return out;
}

export function curveBodyHits(
  drawing: HitResult["drawing"],
  samples: XY[],
  px: number,
  py: number,
  tolerance = TOL,
): HitResult[] {
  let best = Infinity;
  for (let i = 0; i < samples.length - 1; i++) {
    best = Math.min(
      best,
      distToSegment(px, py, samples[i].x, samples[i].y, samples[i + 1].x, samples[i + 1].y),
    );
  }
  if (best < tolerance) return [{ drawing, target: "body", distance: best }];
  return [];
}

export function projectedBounds(
  points: Point[],
  toX: HitTestProjector,
  toY: HitTestProjector,
  pad = 0,
) {
  return boundsFromPoints(visiblePoints(projectPoints(points, toX, toY)), pad);
}

