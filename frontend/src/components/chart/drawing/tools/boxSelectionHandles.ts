import type { Drawing, Point } from "@/types";
import type {
  HitResult,
  HitTestProjector,
} from "../hittest/HitTestEngine";
import {
  HANDLE_RADIUS,
  type Anchor,
} from "./ToolRegistry";

/**
 * Virtual selection handles for a two-point axis-aligned box.
 *
 * The drawing continues to persist only its two opposite construction
 * corners. These ids expose TradingView-style edit affordances without
 * changing the saved payload or the Coordinates tab.
 */
export const BOX_HANDLES = {
  TOP_LEFT: 0,
  TOP_CENTER: 1,
  TOP_RIGHT: 2,
  RIGHT_CENTER: 3,
  BOTTOM_RIGHT: 4,
  BOTTOM_CENTER: 5,
  BOTTOM_LEFT: 6,
  LEFT_CENTER: 7,
} as const;

export type BoxHandleIndex =
  (typeof BOX_HANDLES)[keyof typeof BOX_HANDLES];

const BOX_TARGETS: readonly Exclude<HitResult["target"], "body">[] = [
  "p0",
  "p1",
  "p2",
  "p3",
  "p4",
  "p5",
  "p6",
  "p7",
];

export const BOX_CORNER_HANDLE_IDS: ReadonlySet<number> = new Set([
  BOX_HANDLES.TOP_LEFT,
  BOX_HANDLES.TOP_RIGHT,
  BOX_HANDLES.BOTTOM_RIGHT,
  BOX_HANDLES.BOTTOM_LEFT,
]);

function projectedBox(
  drawing: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): {
  timeMinX: number;
  priceMaxY: number;
  timeMaxX: number;
  priceMinY: number;
} | null {
  const first = drawing.points[0];
  const second = drawing.points[1];
  if (!first || !second) return null;
  const timeMinX = toX(Math.min(first.time, second.time));
  const priceMaxY = toY(Math.max(first.price, second.price));
  const timeMaxX = toX(Math.max(first.time, second.time));
  const priceMinY = toY(Math.min(first.price, second.price));
  if (
    timeMinX == null ||
    priceMaxY == null ||
    timeMaxX == null ||
    priceMinY == null
  ) {
    return null;
  }
  return {
    timeMinX,
    priceMaxY,
    timeMaxX,
    priceMinY,
  };
}

export function boxSelectionAnchors(
  drawing: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): Anchor[] {
  const box = projectedBox(drawing, toX, toY);
  if (!box) return [];
  const centerX = (box.timeMinX + box.timeMaxX) / 2;
  const centerY = (box.priceMaxY + box.priceMinY) / 2;
  const points = [
    { x: box.timeMinX, y: box.priceMaxY },
    { x: centerX, y: box.priceMaxY },
    { x: box.timeMaxX, y: box.priceMaxY },
    { x: box.timeMaxX, y: centerY },
    { x: box.timeMaxX, y: box.priceMinY },
    { x: centerX, y: box.priceMinY },
    { x: box.timeMinX, y: box.priceMinY },
    { x: box.timeMinX, y: centerY },
  ];
  return points.map((point, index) => ({
    index,
    x: point.x,
    y: point.y,
    target: BOX_TARGETS[index],
  }));
}

export function boxSelectionAnchorHits(
  drawing: Drawing,
  px: number,
  py: number,
  toX: HitTestProjector,
  toY: HitTestProjector,
  anchorIds?: ReadonlySet<number>,
): HitResult[] {
  return boxSelectionAnchors(drawing, toX, toY).flatMap((anchor) => {
    if (
      (anchorIds && !anchorIds.has(anchor.index)) ||
      anchor.x == null ||
      anchor.y == null
    ) {
      return [];
    }
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

/**
 * Resize a two-point box through one of its eight virtual handles.
 *
 * Corner handles update time and price. Edge-center handles update exactly one
 * dimension. Crossing the opposite edge flips the normalized box instead of
 * producing a negative or stuck geometry.
 */
export function moveBoxSelectionAnchor(
  originalPoints: Point[],
  anchorIndex: number,
  pointer: Point,
): Point[] {
  const first = originalPoints[0];
  const second = originalPoints[1];
  if (!first || !second || !Number.isFinite(pointer.time) || !Number.isFinite(pointer.price)) {
    return originalPoints.map((point) => ({ ...point }));
  }

  let left = Math.min(first.time, second.time);
  let right = Math.max(first.time, second.time);
  let top = Math.max(first.price, second.price);
  let bottom = Math.min(first.price, second.price);

  switch (anchorIndex as BoxHandleIndex) {
    case BOX_HANDLES.TOP_LEFT:
      left = pointer.time;
      top = pointer.price;
      break;
    case BOX_HANDLES.TOP_CENTER:
      top = pointer.price;
      break;
    case BOX_HANDLES.TOP_RIGHT:
      right = pointer.time;
      top = pointer.price;
      break;
    case BOX_HANDLES.RIGHT_CENTER:
      right = pointer.time;
      break;
    case BOX_HANDLES.BOTTOM_RIGHT:
      right = pointer.time;
      bottom = pointer.price;
      break;
    case BOX_HANDLES.BOTTOM_CENTER:
      bottom = pointer.price;
      break;
    case BOX_HANDLES.BOTTOM_LEFT:
      left = pointer.time;
      bottom = pointer.price;
      break;
    case BOX_HANDLES.LEFT_CENTER:
      left = pointer.time;
      break;
    default:
      return originalPoints.map((point) => ({ ...point }));
  }

  return [
    {
      ...first,
      time: Math.min(left, right),
      price: Math.max(top, bottom),
    },
    {
      ...second,
      time: Math.max(left, right),
      price: Math.min(top, bottom),
    },
    ...originalPoints.slice(2).map((point) => ({ ...point })),
  ];
}
