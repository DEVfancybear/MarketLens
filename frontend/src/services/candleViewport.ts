import type { Candle, LinePoint } from "@/types";
import type { IndicatorLogicalRange } from "@/services/indicatorSeriesProjection";

export interface CandleRange {
  first: number;
  last: number;
}

export interface CandleViewport {
  visible: CandleRange;
  overscan: CandleRange;
  direction: "left" | "right" | "idle";
  revision: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function resolveCandleViewport(
  candleCount: number,
  logicalRange: IndicatorLogicalRange | null | undefined,
  previous?: CandleViewport | null,
): CandleViewport | null {
  if (candleCount <= 0 || !logicalRange) return null;
  const maxIndex = candleCount - 1;
  const visible = {
    first: clamp(Math.floor(logicalRange.from), 0, maxIndex),
    last: clamp(Math.ceil(logicalRange.to), 0, maxIndex),
  };
  if (visible.last < visible.first) visible.last = visible.first;

  const center = (visible.first + visible.last) / 2;
  const previousCenter = previous
    ? (previous.visible.first + previous.visible.last) / 2
    : center;
  const direction = center < previousCenter - 0.5
    ? "left"
    : center > previousCenter + 0.5
      ? "right"
      : "idle";

  if (previous) {
    const leftBuffer = previous.visible.first - previous.overscan.first;
    const rightBuffer = previous.overscan.last - previous.visible.last;
    const safeFirst = previous.overscan.first + Math.max(1, Math.floor(leftBuffer * 0.25));
    const safeLast = previous.overscan.last - Math.max(1, Math.floor(rightBuffer * 0.25));
    if (visible.first >= safeFirst && visible.last <= safeLast) {
      return {
        visible,
        overscan: previous.overscan,
        direction,
        revision: previous.revision,
      };
    }
  }

  const visibleBars = visible.last - visible.first + 1;
  let leftOverscan = Math.max(200, visibleBars * 2);
  const rightOverscan = Math.max(80, visibleBars);
  if (direction === "left") leftOverscan *= 2;
  const overscan = {
    first: clamp(visible.first - leftOverscan, 0, maxIndex),
    last: clamp(visible.last + rightOverscan, 0, maxIndex),
  };
  return {
    visible,
    overscan,
    direction,
    revision: (previous?.revision ?? 0) + 1,
  };
}

function lowerBound(points: readonly LinePoint[], time: number) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].time < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(points: readonly LinePoint[], time: number) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function indicatorPointsInViewport(
  points: readonly LinePoint[],
  candles: readonly Candle[],
  viewport: CandleViewport | null | undefined,
): LinePoint[] {
  if (!viewport || candles.length === 0 || points.length === 0) return [...points];
  const firstTime = candles[viewport.overscan.first]?.time;
  const lastTime = candles[viewport.overscan.last]?.time;
  if (firstTime == null || lastTime == null) return [...points];
  // Live Pine objects can extend into right-offset whitespace, and their labels
  // use those future timestamps as anchors. Keep them once the window reaches
  // the data tail; historical windows still discard unrelated future points.
  const reachesLatestCandle = viewport.overscan.last >= candles.length - 1;
  const end = reachesLatestCandle ? points.length : upperBound(points, lastTime);
  return points.slice(lowerBound(points, firstTime), end);
}
