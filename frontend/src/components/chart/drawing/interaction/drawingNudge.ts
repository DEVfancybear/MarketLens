import type { Point } from "@/types";
import type { DrawingAdapterInteractionContext } from "../tools/ToolRegistry";

export type DrawingNudgeDirection = "left" | "right" | "up" | "down";

type LogicalTimeScale = {
  logicalIndex(time: number): number;
  timeAtLogicalIndex(index: number): number;
};

function logicalTimeScale(
  context: DrawingAdapterInteractionContext | undefined,
): LogicalTimeScale | null {
  const candles = context?.candles ?? [];
  const interval = Number(context?.barIntervalSeconds);
  if (
    candles.length < 2 ||
    !Number.isFinite(interval) ||
    interval <= 0
  ) {
    return null;
  }

  const logicalIndex = (time: number): number => {
    const first = candles[0].time;
    const lastIndex = candles.length - 1;
    const last = candles[lastIndex].time;
    if (time <= first) return (time - first) / interval;
    if (time >= last) return lastIndex + (time - last) / interval;

    let low = 0;
    let high = lastIndex;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (candles[mid].time <= time) low = mid;
      else high = mid;
    }
    const span = candles[high].time - candles[low].time;
    return span > 0
      ? low + (time - candles[low].time) / span
      : low;
  };

  const timeAtLogicalIndex = (index: number): number => {
    if (index <= 0) return candles[0].time + index * interval;
    const lastIndex = candles.length - 1;
    if (index >= lastIndex) {
      return candles[lastIndex].time + (index - lastIndex) * interval;
    }
    const left = Math.floor(index);
    const fraction = index - left;
    return candles[left].time +
      fraction * (candles[left + 1].time - candles[left].time);
  };

  return { logicalIndex, timeAtLogicalIndex };
}

/**
 * TradingView-style keyboard nudge: one logical bar horizontally or one
 * minimum price tick vertically. All points move by the same semantic delta,
 * so every adapter keeps its shape.
 */
export function nudgeDrawingPoints(
  points: readonly Point[],
  direction: DrawingNudgeDirection,
  context?: DrawingAdapterInteractionContext,
): Point[] {
  if (direction === "left" || direction === "right") {
    const scale = logicalTimeScale(context);
    if (!scale) return points.map((point) => ({ ...point }));
    const delta = direction === "left" ? -1 : 1;
    return points.map((point) => ({
      ...point,
      time: scale.timeAtLogicalIndex(scale.logicalIndex(point.time) + delta),
    }));
  }

  const tickSize = Number(context?.tickSize);
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    return points.map((point) => ({ ...point }));
  }
  const delta = direction === "up" ? tickSize : -tickSize;
  return points.map((point) => ({
    ...point,
    price: point.price + delta,
  }));
}
