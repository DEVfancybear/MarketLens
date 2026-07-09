import type { Candle, IndicatorResult } from "@/types";
import type { IndicatorLogicalRange } from "@/services/indicatorSeriesProjection";

export interface IndicatorPaneAnchorPoint {
  time: number;
  value: number;
}

function firstFiniteIndicatorValue(result: IndicatorResult): number | null {
  for (const series of result.series) {
    for (const point of series.data) {
      if (Number.isFinite(point.value)) return point.value;
    }
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
 * Lightweight Charts synchronizes panes by logical index, not by timestamp.
 * Separate-pane indicators often omit `na` points, so their own time scale can
 * have fewer logical indexes than the main candle chart. This invisible anchor
 * adds every candle timestamp to the pane's time scale while using a harmless
 * in-range value so autoscale impact is minimal.
 */
export function indicatorPaneTimeAnchorData(
  candles: readonly Candle[],
  result: IndicatorResult,
  visibleRange?: IndicatorLogicalRange | null,
): IndicatorPaneAnchorPoint[] {
  if (candles.length === 0) return [];
  const fallback = firstFiniteIndicatorValue(result) ?? 0;
  const toIndex = Math.max(
    candles.length - 1,
    Math.ceil(visibleRange?.to ?? candles.length - 1),
  );
  const points: IndicatorPaneAnchorPoint[] = [];
  for (let index = 0; index <= toIndex; index++) {
    points.push({ time: timeAtLogicalIndex(candles, index), value: fallback });
  }
  return points;
}
