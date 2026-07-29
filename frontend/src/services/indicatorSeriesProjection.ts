import type { Candle, IndicatorSeries, LinePoint } from "@/types";

export interface IndicatorLogicalRange {
  from: number;
  to: number;
}

const finiteIndicatorSeriesCache = new WeakMap<
  readonly LinePoint[],
  LinePoint[]
>();

/**
 * Runtime indicator payloads cross a JSON boundary, where Pine warm-up values
 * can arrive as `null` even though the frontend type is numeric. Lightweight
 * Charts throws synchronously when any native series receives a non-finite
 * time/value, so sanitize once before viewport/cutoff projection.
 *
 * Runtime results are immutable cache snapshots. Cache the projection by input
 * identity so every mounted chart sanitizes a snapshot once, preserving the
 * original array when valid and the same filtered array when invalid. This
 * avoids repeated full-series scans and projection churn on live/Replay ticks.
 */
export function finiteIndicatorSeriesData(
  points: readonly LinePoint[],
): LinePoint[] {
  const cached = finiteIndicatorSeriesCache.get(points);
  if (cached) return cached;

  let finite: LinePoint[] | null = null;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (Number.isFinite(point.time) && Number.isFinite(point.value)) {
      finite?.push(point);
      continue;
    }
    finite ??= points.slice(0, index);
  }
  const result = finite ?? (points as LinePoint[]);
  finiteIndicatorSeriesCache.set(points, result);
  return result;
}

/**
 * Keep indicator geometry inside a Replay data boundary. Object indicators
 * commonly encode a right extension as a future point; when that happens we
 * carry the last known value to the cutoff rather than allowing the extension
 * to recreate a future chart region.
 */
export function indicatorSeriesDataThroughCutoff(
  points: readonly LinePoint[],
  cutoff?: number,
  carryBoundary = true,
): LinePoint[] {
  if (cutoff == null || !Number.isFinite(cutoff)) return points as LinePoint[];
  const bounded: LinePoint[] = [];
  let crossed = false;
  for (const point of points) {
    if (point.time <= cutoff) {
      bounded.push(point);
      continue;
    }
    crossed = true;
    break;
  }
  const last = bounded.at(-1);
  if (carryBoundary && crossed && last && last.time < cutoff) {
    bounded.push({ ...last, time: cutoff });
  }
  return bounded;
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
  const data = finiteIndicatorSeriesData(series.data);
  if (!series.extendToVisibleRange) return data;
  if (candles.length === 0) return [];

  const point = lastFinitePoint(data);
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
