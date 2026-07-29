import type { Drawing, Point } from "@/types";
import type {
  HitResult,
  HitTestProjector,
} from "../hittest/HitTestEngine";
import {
  HANDLE_RADIUS,
  type Anchor,
} from "./ToolRegistry";

export const ELLIPSE_AXIS_HANDLES = {
  TIME_MIN: 0,
  PRICE_MAX: 1,
  TIME_MAX: 2,
  PRICE_MIN: 3,
} as const;

export function ellipseSelectionAnchors(
  drawing: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): Anchor[] {
  const first = drawing.points[0];
  const second = drawing.points[1];
  if (!first || !second) return [];
  const timeMin = Math.min(first.time, second.time);
  const timeMax = Math.max(first.time, second.time);
  const priceMin = Math.min(first.price, second.price);
  const priceMax = Math.max(first.price, second.price);
  const centerTime = (timeMin + timeMax) / 2;
  const centerPrice = (priceMin + priceMax) / 2;
  const points = [
    { time: timeMin, price: centerPrice },
    { time: centerTime, price: priceMax },
    { time: timeMax, price: centerPrice },
    { time: centerTime, price: priceMin },
  ];
  return points.map((point, index) => ({
    index,
    x: toX(point.time),
    y: toY(point.price),
    target: `p${index}` as Exclude<HitResult["target"], "body">,
  }));
}

export function ellipseSelectionAnchorHits(
  drawing: Drawing,
  px: number,
  py: number,
  toX: HitTestProjector,
  toY: HitTestProjector,
): HitResult[] {
  return ellipseSelectionAnchors(drawing, toX, toY).flatMap((anchor) => {
    if (anchor.x == null || anchor.y == null) return [];
    const distance = Math.hypot(px - anchor.x, py - anchor.y);
    return distance <= HANDLE_RADIUS
      ? [{
          drawing,
          target: anchor.target,
          anchorIndex: anchor.index,
          distance,
        }]
      : [];
  });
}

export function moveEllipseSelectionAnchor(
  originalPoints: Point[],
  anchorIndex: number,
  pointer: Point,
): Point[] {
  const first = originalPoints[0];
  const second = originalPoints[1];
  if (!first || !second) {
    return originalPoints.map((point) => ({ ...point }));
  }
  let timeMin = Math.min(first.time, second.time);
  let timeMax = Math.max(first.time, second.time);
  let priceMin = Math.min(first.price, second.price);
  let priceMax = Math.max(first.price, second.price);

  switch (anchorIndex) {
    case ELLIPSE_AXIS_HANDLES.TIME_MIN:
      timeMin = pointer.time;
      break;
    case ELLIPSE_AXIS_HANDLES.PRICE_MAX:
      priceMax = pointer.price;
      break;
    case ELLIPSE_AXIS_HANDLES.TIME_MAX:
      timeMax = pointer.time;
      break;
    case ELLIPSE_AXIS_HANDLES.PRICE_MIN:
      priceMin = pointer.price;
      break;
    default:
      return originalPoints.map((point) => ({ ...point }));
  }

  return [
    {
      ...first,
      time: Math.min(timeMin, timeMax),
      price: Math.max(priceMin, priceMax),
    },
    {
      ...second,
      time: Math.max(timeMin, timeMax),
      price: Math.min(priceMin, priceMax),
    },
    ...originalPoints.slice(2).map((point) => ({ ...point })),
  ];
}
