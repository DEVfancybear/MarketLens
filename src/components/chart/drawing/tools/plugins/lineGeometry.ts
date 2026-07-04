/**
 * Shared geometry helpers for TradingView-style line drawing tools.
 *
 * Line tools have three different geometry contracts:
 * - finite two-point segments: Trendline, Info line, Trend angle
 * - infinite/one-way extensions: Extended line, Ray
 * - axis-aligned one-point tools: Horizontal line/ray, Vertical line, Crossline
 *
 * Keeping those contracts here prevents each plugin from inventing slightly
 * different anchor, body hit-test, drag, and viewport-culling behavior.
 */
import type { Drawing, Point } from "@/types";
import type { Projector } from "../../drawingRenderer";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Anchor } from "../ToolRegistry";
import {
  HANDLE_RADIUS,
  TOL,
  defaultMove,
  defaultMoveAnchor,
  distToSegment,
  pointDist,
} from "../ToolRegistry";

export type XY = { x: number; y: number };
export type Segment = { a: XY; b: XY };

const HUGE_SPAN = 100000;

export function projectPoint(
  pt: Point,
  toX: (time: number) => number | null,
  toY: (price: number) => number | null,
): XY | null {
  const x = toX(pt.time);
  const y = toY(pt.price);
  return x == null || y == null ? null : { x, y };
}

export function projectOnePoint(
  d: Drawing,
  toX: (time: number) => number | null,
  toY: (price: number) => number | null,
): XY | null {
  const pt = d.points[0];
  return pt ? projectPoint(pt, toX, toY) : null;
}

export function projectTwoPoints(
  d: Drawing,
  toX: (time: number) => number | null,
  toY: (price: number) => number | null,
): Segment | null {
  const a = d.points[0] ? projectPoint(d.points[0], toX, toY) : null;
  const b = d.points[1] ? projectPoint(d.points[1], toX, toY) : null;
  return a && b ? { a, b } : null;
}

export function onePointAnchorHits(
  drawing: Drawing,
  pt: XY | null,
  px: number,
  py: number,
): HitResult[] {
  if (!pt) return [];
  const distance = pointDist(px, py, pt.x, pt.y);
  return distance <= HANDLE_RADIUS
    ? [{ drawing, target: "p1", anchorIndex: 0, distance }]
    : [];
}

export function twoPointAnchorHits(
  drawing: Drawing,
  segment: Segment | null,
  px: number,
  py: number,
): HitResult[] {
  if (!segment) return [];
  const d1 = pointDist(px, py, segment.a.x, segment.a.y);
  const d2 = pointDist(px, py, segment.b.x, segment.b.y);
  const hits: HitResult[] = [];
  if (d1 <= HANDLE_RADIUS) {
    hits.push({ drawing, target: "p1", anchorIndex: 0, distance: d1 });
  }
  if (d2 <= HANDLE_RADIUS) {
    hits.push({ drawing, target: "p2", anchorIndex: 1, distance: d2 });
  }
  return hits;
}

export function onePointAnchors(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): Anchor[] {
  const pt = d.points[0];
  const projected = pt ? projectPoint(pt, toX, toY) : null;
  return [
    {
      index: 0,
      x: projected?.x ?? null,
      y: projected?.y ?? null,
      target: "p1",
    },
  ];
}

export function twoPointAnchors(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): Anchor[] {
  const a = d.points[0] ? projectPoint(d.points[0], toX, toY) : null;
  const b = d.points[1] ? projectPoint(d.points[1], toX, toY) : null;
  return [
    { index: 0, x: a?.x ?? null, y: a?.y ?? null, target: "p1" },
    { index: 1, x: b?.x ?? null, y: b?.y ?? null, target: "p2" },
  ];
}

function unitVector(segment: Segment): XY | null {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.0001) return null;
  return { x: dx / len, y: dy / len };
}

function renderSpan(segment: Segment, proj: Projector): number {
  return (
    Math.max(
      proj.width,
      proj.height,
      Math.abs(segment.a.x),
      Math.abs(segment.a.y),
      Math.abs(segment.b.x),
      Math.abs(segment.b.y),
    ) + 2000
  );
}

export function finiteSegmentBodyHits(
  drawing: Drawing,
  segment: Segment | null,
  px: number,
  py: number,
  tolerance = TOL,
): HitResult[] {
  if (!segment) return [];
  const distance = distToSegment(
    px,
    py,
    segment.a.x,
    segment.a.y,
    segment.b.x,
    segment.b.y,
  );
  return distance < tolerance ? [{ drawing, target: "body", distance }] : [];
}

export function raySegment(segment: Segment, span = HUGE_SPAN): Segment {
  const dir = unitVector(segment);
  if (!dir) return segment;
  return {
    a: segment.a,
    b: {
      x: segment.a.x + dir.x * span,
      y: segment.a.y + dir.y * span,
    },
  };
}

export function extendedLineSegment(segment: Segment, span = HUGE_SPAN): Segment {
  const dir = unitVector(segment);
  if (!dir) return segment;
  return {
    a: {
      x: segment.a.x - dir.x * span,
      y: segment.a.y - dir.y * span,
    },
    b: {
      x: segment.a.x + dir.x * span,
      y: segment.a.y + dir.y * span,
    },
  };
}

export function rayRenderSegment(segment: Segment, proj: Projector): Segment {
  return raySegment(segment, renderSpan(segment, proj));
}

export function extendedRenderSegment(
  segment: Segment,
  proj: Projector,
): Segment {
  return extendedLineSegment(segment, renderSpan(segment, proj));
}

export function rayBodyHits(
  drawing: Drawing,
  segment: Segment | null,
  px: number,
  py: number,
): HitResult[] {
  return segment
    ? finiteSegmentBodyHits(drawing, raySegment(segment), px, py)
    : [];
}

export function extendedLineBodyHits(
  drawing: Drawing,
  segment: Segment | null,
  px: number,
  py: number,
): HitResult[] {
  return segment
    ? finiteSegmentBodyHits(drawing, extendedLineSegment(segment), px, py)
    : [];
}

export function horizontalLineBodyHits(
  drawing: Drawing,
  y: number | null,
  py: number,
): HitResult[] {
  if (y == null) return [];
  const distance = Math.abs(y - py);
  return distance < TOL ? [{ drawing, target: "body", distance }] : [];
}

export function horizontalRayBodyHits(
  drawing: Drawing,
  start: XY | null,
  px: number,
  py: number,
): HitResult[] {
  if (!start || px < start.x - TOL) return [];
  const distance = Math.abs(start.y - py);
  return distance < TOL ? [{ drawing, target: "body", distance }] : [];
}

export function verticalLineBodyHits(
  drawing: Drawing,
  x: number | null,
  px: number,
): HitResult[] {
  if (x == null) return [];
  const distance = Math.abs(x - px);
  return distance < TOL ? [{ drawing, target: "body", distance }] : [];
}

export function twoPointBounds(segment: Segment | null, pad = TOL) {
  if (!segment) return null;
  return {
    x: Math.min(segment.a.x, segment.b.x) - pad,
    y: Math.min(segment.a.y, segment.b.y) - pad,
    w: Math.abs(segment.b.x - segment.a.x) + pad * 2,
    h: Math.abs(segment.b.y - segment.a.y) + pad * 2,
  };
}

export function horizontalBounds(y: number | null) {
  if (y == null) return null;
  return { x: -HUGE_SPAN / 2, y: y - TOL, w: HUGE_SPAN, h: TOL * 2 };
}

export function horizontalRayBounds(start: XY | null) {
  if (!start) return null;
  return { x: start.x - TOL, y: start.y - TOL, w: HUGE_SPAN, h: TOL * 2 };
}

export function verticalBounds(x: number | null) {
  if (x == null) return null;
  return { x: x - TOL, y: -HUGE_SPAN / 2, w: TOL * 2, h: HUGE_SPAN };
}

export function fullViewportBounds() {
  return {
    x: -HUGE_SPAN / 2,
    y: -HUGE_SPAN / 2,
    w: HUGE_SPAN,
    h: HUGE_SPAN,
  };
}

export function moveHorizontalLine(origPoints: Point[], pointer: Point): Point[] {
  return origPoints.map((pt) => ({ ...pt, price: pointer.price }));
}

export function moveVerticalLine(origPoints: Point[], pointer: Point): Point[] {
  return origPoints.map((pt) => ({ ...pt, time: pointer.time }));
}

export function moveDefaultLine(
  origPoints: Point[],
  pointer: Point,
  dragStart: Point,
): Point[] {
  return defaultMove(origPoints, pointer, dragStart);
}

export function moveDefaultLineAnchor(
  origPoints: Point[],
  index: number,
  pointer: Point,
): Point[] {
  return defaultMoveAnchor(origPoints, index, pointer);
}
