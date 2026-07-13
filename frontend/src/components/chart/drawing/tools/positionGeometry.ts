import type { Point } from "@/types";
import { levelFromTicks, roundToTick, safeTickSize } from "./positionMetrics";
import type { DrawingAdapterInteractionContext } from "./ToolRegistry";
import { candleIndexAtOrBefore } from "../coordinates/drawingCoordinates";

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

const FALLBACK_MIN_TIME_SPAN = 1;
export const POSITION_MIN_RESIZE_WIDTH_PX = 12;

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
  tickSizeOrContext: number | DrawingAdapterInteractionContext,
): Point[] {
  const context = typeof tickSizeOrContext === "number"
    ? undefined
    : tickSizeOrContext;
  const tickSize = typeof tickSizeOrContext === "number"
    ? tickSizeOrContext
    : tickSizeOrContext.tickSize;
  const tick = safeTickSize(tickSize);
  const dt = finiteOr(pointer.time - dragStart.time, 0);
  const dp = finiteOr(pointer.price - dragStart.price, 0);
  const moved = origPoints.map((point) => ({
    time: finiteOr(point.time + dt, point.time),
    price: roundToTick(point.price + dp, tick),
  }));

  const candles = context?.candles ?? [];
  const interval = context?.barIntervalSeconds;
  if (
    moved.length < 3 ||
    candles.length < 2 ||
    !Number.isFinite(interval) ||
    Number(interval) <= 0
  ) {
    return moved;
  }

  const logicalIndex = (time: number): number | null => {
    const floor = candleIndexAtOrBefore(candles, time);
    if (floor == null) return null;
    if (candles[floor].time === time) return floor;
    if (time < candles[0].time) {
      return (time - candles[0].time) / Number(interval);
    }
    const lastIndex = candles.length - 1;
    if (time > candles[lastIndex].time) {
      return lastIndex + (time - candles[lastIndex].time) / Number(interval);
    }
    const next = Math.min(lastIndex, floor + 1);
    const timeSpan = candles[next].time - candles[floor].time;
    return timeSpan > 0
      ? floor + (time - candles[floor].time) / timeSpan
      : floor;
  };
  const timeAtLogicalIndex = (logical: number): number => {
    const rounded = Math.round(logical);
    if (rounded <= 0) {
      return candles[0].time + rounded * Number(interval);
    }
    const lastIndex = candles.length - 1;
    if (rounded >= lastIndex) {
      return candles[lastIndex].time + (rounded - lastIndex) * Number(interval);
    }
    return candles[rounded].time;
  };

  const originalLeft = logicalIndex(origPoints[0].time);
  const originalRight = logicalIndex(origPoints[1].time);
  const barSpan = originalLeft != null && originalRight != null
    ? Math.round(originalRight - originalLeft)
    : Math.round((origPoints[1].time - origPoints[0].time) / Number(interval));
  const nextLeftLogical = logicalIndex(moved[0].time);
  if (!Number.isFinite(barSpan) || barSpan < 1 || nextLeftLogical == null) {
    return moved;
  }
  const snappedLeftLogical = Math.round(nextLeftLogical);
  const leftTime = timeAtLogicalIndex(snappedLeftLogical);
  const rightTime = timeAtLogicalIndex(snappedLeftLogical + barSpan);
  moved[0].time = leftTime;
  moved[1].time = rightTime;
  moved[2].time = rightTime;
  return moved;
}

export function movePositionAnchor(
  origPoints: readonly Point[],
  anchorIndex: number,
  pointer: Point,
  tickSizeOrContext: number | DrawingAdapterInteractionContext,
): Point[] {
  const context = typeof tickSizeOrContext === "number"
    ? undefined
    : tickSizeOrContext;
  const tickSize = typeof tickSizeOrContext === "number"
    ? tickSizeOrContext
    : tickSizeOrContext.tickSize;
  const tick = safeTickSize(tickSize);
  const next = origPoints.map((point) => ({ ...point }));
  if (!next[0]) return next;
  const side = positionSideFromPoints(origPoints);

  const leftTime = next[0].time;
  const interval = Number.isFinite(context?.barIntervalSeconds) &&
    Number(context?.barIntervalSeconds) > 0
    ? Number(context?.barIntervalSeconds)
    : FALLBACK_MIN_TIME_SPAN;
  const candles = context?.candles ?? [];
  const minimumBarSpan = Number.isFinite(context?.barSpacing) &&
    Number(context?.barSpacing) > 0
    ? Math.max(1, Math.ceil(POSITION_MIN_RESIZE_WIDTH_PX / Number(context?.barSpacing)))
    : 1;
  const logicalIndex = (time: number): number | null => {
    if (candles.length === 0) return null;
    const floor = candleIndexAtOrBefore(candles, time);
    if (floor == null) return null;
    if (time < candles[0].time) {
      return (time - candles[0].time) / interval;
    }
    if (candles[floor].time === time) return floor;
    const lastIndex = candles.length - 1;
    if (time > candles[lastIndex].time) {
      return lastIndex + (time - candles[lastIndex].time) / interval;
    }
    const next = Math.min(lastIndex, floor + 1);
    const span = candles[next].time - candles[floor].time;
    return span > 0 ? floor + (time - candles[floor].time) / span : floor;
  };
  const timeAtLogicalIndex = (logical: number): number => {
    const rounded = Math.round(logical);
    if (candles.length === 0) return rounded * interval;
    if (rounded <= 0) return candles[0].time + rounded * interval;
    const lastIndex = candles.length - 1;
    if (rounded >= lastIndex) {
      return candles[lastIndex].time + (rounded - lastIndex) * interval;
    }
    return candles[rounded].time;
  };
  const offsetLogicalTime = (time: number, barDelta: number): number => {
    const logical = logicalIndex(time);
    if (logical == null) return time + barDelta * interval;
    return timeAtLogicalIndex(Math.round(logical) + barDelta);
  };
  const rightTime = next[1]?.time ?? offsetLogicalTime(leftTime, minimumBarSpan);
  const safeTime = finiteOr(pointer.time, leftTime);
  const safePrice = roundToTick(finiteOr(pointer.price, next[0].price), tick);

  const setLeftTime = (time: number) => {
    next[0].time = Math.min(
      time,
      offsetLogicalTime(rightTime, -minimumBarSpan),
    );
  };
  const setRightTime = (time: number) => {
    const right = Math.max(
      time,
      offsetLogicalTime(next[0].time, minimumBarSpan),
    );
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
