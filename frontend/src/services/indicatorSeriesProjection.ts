import type { Candle, IndicatorSeries, LinePoint } from "@/types";

export interface IndicatorLogicalRange {
  from: number;
  to: number;
}

function lastFinitePoint(points: readonly LinePoint[]): LinePoint | null {
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index];
    if (Number.isFinite(point.value)) return point;
  }
  return null;
}

function intervalSeconds(candles: readonly Candle[]): number {
  for (let index = candles.length - 1; index > 0; index--) {
    const delta = candles[index].time - candles[index - 1].time;
    if (Number.isFinite(delta) && delta > 0) return delta;
  }
  return 60;
}

function timeAtLogicalIndex(candles: readonly Candle[], index: number): number {
  const lastIndex = candles.length - 1;
  if (index <= 0) return candles[0].time;
  if (index <= lastIndex) return candles[index].time;
  return candles[lastIndex].time + (index - lastIndex) * intervalSeconds(candles);
}

/**
 * Pine reference outputs such as `hline()` and `fill()` are viewport guides,
 * not ordinary time series. The backend marks them with
 * `extendToVisibleRange`, and the frontend re-projects those sparse reference
 * values onto the current logical viewport. This also covers TradingView's
 * right-offset whitespace: if the last candle is not at the pane's right edge,
 * synthetic future slots keep the fill/hline painted through that whitespace.
 */
export function indicatorSeriesDataForCandles(
  series: IndicatorSeries,
  candles: readonly Candle[],
  visibleRange?: IndicatorLogicalRange | null,
): LinePoint[] {
  if (!series.extendToVisibleRange) return series.data;
  if (candles.length === 0) return [];

  const point = lastFinitePoint(series.data);
  if (!point) return [];

  const fromIndex = Math.max(0, Math.floor(visibleRange?.from ?? 0));
  const toIndex = Math.max(
    fromIndex,
    Math.ceil(visibleRange?.to ?? candles.length - 1),
  );
  const firstTime = timeAtLogicalIndex(candles, fromIndex);
  const lastTime = timeAtLogicalIndex(candles, toIndex);
  const first: LinePoint = { time: firstTime, value: point.value };
  const last: LinePoint = { time: lastTime, value: point.value };
  if (point.color) {
    first.color = point.color;
    last.color = point.color;
  }
  return firstTime === lastTime ? [first] : [first, last];
}
