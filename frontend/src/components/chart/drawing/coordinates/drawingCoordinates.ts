import type { Candle, Point } from "../../../../types";

export interface TimeCoordinateExtrapolation {
  time: number;
  anchorTime: number;
  anchorX: number;
  referenceTime: number;
  referenceX: number;
  indexSpan: number;
  /** Canonical chart timeframe. Candle spacing is only a legacy fallback. */
  barIntervalSeconds?: number;
}

/**
 * Resolve the logical interval represented by the candle slice. A median of
 * several samples ignores isolated weekend/session gaps, while also keeping
 * fixture/replay slices whose actual cadence differs from the selected toolbar
 * timeframe internally reversible.
 */
export function resolveCandleBarIntervalSeconds(
  candles: readonly Pick<Candle, "time">[],
  configuredInterval?: number,
  fallbackInterval = 3600,
): number {
  const deltas: number[] = [];
  const firstSample = Math.max(1, candles.length - 65);
  for (let index = firstSample; index < candles.length; index++) {
    const delta = candles[index].time - candles[index - 1].time;
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
  }
  deltas.sort((left, right) => left - right);
  if (deltas.length >= 3) return deltas[Math.floor(deltas.length / 2)];
  if (Number.isFinite(configuredInterval) && Number(configuredInterval) > 0) {
    return Number(configuredInterval);
  }
  if (deltas.length > 0) return deltas[Math.floor(deltas.length / 2)];
  return Number.isFinite(fallbackInterval) && fallbackInterval > 0
    ? fallbackInterval
    : 3600;
}

/**
 * Project a time that Lightweight Charts does not currently know (normally
 * future whitespace). Pixel spacing comes from the time scale's logical bars,
 * while elapsed bars come from the active timeframe. Wall-clock gaps between
 * adjacent candles must not compress or expand a nominal N-bar drawing.
 */
export function extrapolateTimeCoordinate({
  time,
  anchorTime,
  anchorX,
  referenceTime,
  referenceX,
  indexSpan,
  barIntervalSeconds,
}: TimeCoordinateExtrapolation): number | null {
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(anchorTime) ||
    !Number.isFinite(anchorX) ||
    !Number.isFinite(referenceTime) ||
    !Number.isFinite(referenceX) ||
    !Number.isFinite(indexSpan) ||
    indexSpan <= 0
  ) {
    return null;
  }

  const observedInterval = Math.abs(anchorTime - referenceTime) / indexSpan;
  const secondsPerBar =
    Number.isFinite(barIntervalSeconds) && Number(barIntervalSeconds) > 0
      ? Number(barIntervalSeconds)
      : observedInterval;
  const pixelsPerBar = (anchorX - referenceX) / indexSpan;
  if (
    !Number.isFinite(secondsPerBar) ||
    secondsPerBar <= 0 ||
    !Number.isFinite(pixelsPerBar) ||
    Math.abs(pixelsPerBar) < Number.EPSILON
  ) {
    return null;
  }

  const projected = anchorX + ((time - anchorTime) / secondsPerBar) * pixelsPerBar;
  return Number.isFinite(projected) ? projected : null;
}

export function updateDrawingPoint(
  points: readonly Point[],
  index: number,
  patch: Partial<Point>,
): Point[] {
  if (index < 0 || index >= points.length) return points.map((point) => ({ ...point }));
  const next = points.map((point) => ({ ...point }));
  const time = patch.time ?? next[index].time;
  const price = patch.price ?? next[index].price;
  if (!Number.isFinite(time) || !Number.isFinite(price)) return next;
  next[index] = { time, price };
  return next;
}

export function nearestCandleIndex(
  candles: readonly Pick<Candle, "time">[],
  time: number,
): number | null {
  if (candles.length === 0 || !Number.isFinite(time)) return null;
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle].time < time) low = middle + 1;
    else high = middle;
  }
  const right = Math.min(low, candles.length - 1);
  const left = Math.max(0, low - 1);
  return Math.abs(candles[left].time - time) <= Math.abs(candles[right].time - time)
    ? left
    : right;
}

/** Index of the candle at/before a timestamp, clamped to the first candle. */
export function candleIndexAtOrBefore(
  candles: readonly Pick<Candle, "time">[],
  time: number,
): number | null {
  if (candles.length === 0 || !Number.isFinite(time)) return null;
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export function timeAtCandleIndex(candles: readonly Candle[], index: number): number | null {
  if (candles.length === 0 || !Number.isFinite(index)) return null;
  const safe = Math.max(0, Math.min(candles.length - 1, Math.round(index)));
  return candles[safe].time;
}

export function toLocalDateTimeInput(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "";
  const date = new Date(unixSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalDateTimeInput(value: string): number | null {
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}
