import type { Point } from "@/types";
import { levelFromTicks, roundToTick, safeTickSize } from "./positionMetrics";

/**
 * Virtual anchor ids for the Long / Short Position tool.
 *
 * The drawing persists only three points:
 *   points[0] = left edge + entry price
 *   points[1] = right edge + target price
 *   points[2] = right edge + stop price
 *
 * TradingView still exposes six selected handles.  These ids describe those
 * virtual handles without changing the persisted point model.
 */
export const POSITION_ANCHORS = {
  TARGET_LEFT: 0,
  ENTRY_LEFT: 1,
  STOP_LEFT: 2,
  TARGET_RIGHT: 3,
  ENTRY_RIGHT: 4,
  STOP_RIGHT: 5,
} as const;

export type PositionAnchorIndex =
  (typeof POSITION_ANCHORS)[keyof typeof POSITION_ANCHORS];

const MIN_TIME_SPAN = 1;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function positionSideFromPoints(
  points: readonly Point[],
): "long" | "short" {
  const entry = points[0]?.price ?? 0;
  const target = points[1]?.price ?? entry;
  const stop = points[2]?.price ?? entry;

  // Normal Long: target above entry, stop below. Normal Short is opposite.
  // If a legacy drawing is malformed, preserve the closest side implied by the
  // target because that is the primary profit level.
  if (target <= entry && stop >= entry) return "short";
  return "long";
}

function normalizePositionLevels(
  points: Point[],
  tickSize: number,
  side = positionSideFromPoints(points),
): Point[] {
  const tick = safeTickSize(tickSize);
  if (!points[0] || !points[1] || !points[2]) return points;

  const entry = roundToTick(points[0].price, tick);
  const targetTicks = Math.max(
    1,
    Math.round(Math.abs(points[1].price - entry) / tick),
  );
  const stopTicks = Math.max(
    1,
    Math.round(Math.abs(points[2].price - entry) / tick),
  );

  points[0].price = entry;
  points[1].price = levelFromTicks(
    entry,
    targetTicks,
    side === "long" ? 1 : -1,
    tick,
  );
  points[2].price = levelFromTicks(
    entry,
    stopTicks,
    side === "long" ? -1 : 1,
    tick,
  );
  return points;
}

export function movePosition(
  origPoints: readonly Point[],
  pointer: Point,
  dragStart: Point,
  tickSize: number,
): Point[] {
  const tick = safeTickSize(tickSize);
  const dt = finiteOr(pointer.time - dragStart.time, 0);
  const dp = finiteOr(pointer.price - dragStart.price, 0);
  return origPoints.map((point) => ({
    time: finiteOr(point.time + dt, point.time),
    price: roundToTick(point.price + dp, tick),
  }));
}

export function movePositionAnchor(
  origPoints: readonly Point[],
  anchorIndex: number,
  pointer: Point,
  tickSize: number,
): Point[] {
  const tick = safeTickSize(tickSize);
  const next = origPoints.map((point) => ({ ...point }));
  if (!next[0]) return next;
  const side = positionSideFromPoints(origPoints);

  const leftTime = next[0].time;
  const rightTime = next[1]?.time ?? leftTime + MIN_TIME_SPAN;
  const safeTime = finiteOr(pointer.time, leftTime);
  const safePrice = roundToTick(finiteOr(pointer.price, next[0].price), tick);

  const setLeftTime = (time: number) => {
    next[0].time = Math.min(time, rightTime - MIN_TIME_SPAN);
  };
  const setRightTime = (time: number) => {
    const right = Math.max(time, next[0].time + MIN_TIME_SPAN);
    if (next[1]) next[1].time = right;
    if (next[2]) next[2].time = right;
  };

  switch (anchorIndex as PositionAnchorIndex) {
    case POSITION_ANCHORS.TARGET_LEFT:
      setLeftTime(safeTime);
      if (next[1]) next[1].price = safePrice;
      break;
    case POSITION_ANCHORS.ENTRY_LEFT:
      setLeftTime(safeTime);
      next[0].price = safePrice;
      break;
    case POSITION_ANCHORS.STOP_LEFT:
      setLeftTime(safeTime);
      if (next[2]) next[2].price = safePrice;
      break;
    case POSITION_ANCHORS.TARGET_RIGHT:
      setRightTime(safeTime);
      if (next[1]) next[1].price = safePrice;
      break;
    case POSITION_ANCHORS.ENTRY_RIGHT:
      setRightTime(safeTime);
      next[0].price = safePrice;
      break;
    case POSITION_ANCHORS.STOP_RIGHT:
      setRightTime(safeTime);
      if (next[2]) next[2].price = safePrice;
      break;
    default:
      return next;
  }

  return normalizePositionLevels(next, tick, side);
}
