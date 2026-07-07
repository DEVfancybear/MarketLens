import type { MarketCandle } from "@/types";

export type RealtimeSeriesUpdatePlan = "replace" | "update-latest" | "append";

export interface CandleGap {
  afterTime: number;
  beforeTime: number;
  missingBars: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeMarketCandle(
  candle: MarketCandle,
): MarketCandle | null {
  if (
    !isFiniteNumber(candle.time) ||
    !isFiniteNumber(candle.open) ||
    !isFiniteNumber(candle.high) ||
    !isFiniteNumber(candle.low) ||
    !isFiniteNumber(candle.close)
  ) {
    return null;
  }

  const high = Math.max(candle.high, candle.open, candle.close);
  const low = Math.min(candle.low, candle.open, candle.close);

  return {
    ...candle,
    time: Math.floor(candle.time),
    open: candle.open,
    high,
    low,
    close: candle.close,
    volume: isFiniteNumber(candle.volume) ? candle.volume : 0,
  };
}

export function normalizeMarketCandleSeries(
  candles: readonly MarketCandle[],
  maxCandles?: number,
): MarketCandle[] {
  const byTime = new Map<number, MarketCandle>();
  for (const candle of candles) {
    const normalized = normalizeMarketCandle(candle);
    if (normalized) byTime.set(normalized.time, normalized);
  }

  const sorted = [...byTime.values()].sort((a, b) => a.time - b.time);
  return maxCandles && sorted.length > maxCandles
    ? sorted.slice(sorted.length - maxCandles)
    : sorted;
}

function candlesEqual(a: MarketCandle, b: MarketCandle): boolean {
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume &&
    a.closed === b.closed
  );
}

export function marketCandleSeriesEqual(
  a: readonly MarketCandle[],
  b: readonly MarketCandle[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (!candlesEqual(a[index], b[index])) return false;
  }
  return true;
}

/**
 * Upsert one realtime candle into an already-sorted series.
 *
 * Realtime providers are not guaranteed to deliver bars strictly in order after
 * reconnects, tab sleep, or REST/history races. Dropping every candle older
 * than the current last bar leaves visible holes on the chart. This helper
 * inserts/replaces by timestamp while preserving object references for the
 * unchanged prefix/suffix, so PriceChart can still choose the O(1) append/update
 * path for normal in-order ticks and fall back to setData() only for structural
 * repairs.
 */
export function upsertMarketCandleIntoSeries(
  series: readonly MarketCandle[],
  candle: MarketCandle,
  maxCandles?: number,
): MarketCandle[] {
  const normalized = normalizeMarketCandle(candle);
  if (!normalized) return [...series];

  let low = 0;
  let high = series.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (series[mid].time < normalized.time) low = mid + 1;
    else high = mid;
  }

  let next: MarketCandle[];
  if (low < series.length && series[low].time === normalized.time) {
    if (candlesEqual(series[low], normalized)) return [...series];
    next = [...series.slice(0, low), normalized, ...series.slice(low + 1)];
  } else {
    next = [...series.slice(0, low), normalized, ...series.slice(low)];
  }

  return maxCandles && next.length > maxCandles
    ? next.slice(next.length - maxCandles)
    : next;
}

export function findRecentCandleGap(
  series: readonly { time: number }[],
  expectedStepSeconds: number,
  maxMissingBars = 50,
): CandleGap | null {
  if (!Number.isFinite(expectedStepSeconds) || expectedStepSeconds <= 0) {
    return null;
  }

  for (let index = series.length - 1; index > 0; index -= 1) {
    const before = series[index];
    const after = series[index - 1];
    const delta = before.time - after.time;
    if (delta <= expectedStepSeconds) continue;

    const missingBars = Math.round(delta / expectedStepSeconds) - 1;
    if (missingBars <= 0) continue;
    if (missingBars > maxMissingBars) return null;

    return {
      afterTime: after.time,
      beforeTime: before.time,
      missingBars,
    };
  }

  return null;
}

export function mergeHistoryWithLiveCandles(
  history: readonly MarketCandle[],
  live: readonly MarketCandle[],
  maxCandles?: number,
): MarketCandle[] {
  const normalizedHistory = normalizeMarketCandleSeries(history);
  const normalizedLive = normalizeMarketCandleSeries(live);
  if (normalizedLive.length === 0) {
    return normalizeMarketCandleSeries(normalizedHistory, maxCandles);
  }
  if (normalizedHistory.length === 0) {
    return normalizeMarketCandleSeries(normalizedLive, maxCandles);
  }

  const historyFirstTime = normalizedHistory[0].time;
  const historyLastTime = normalizedHistory.at(-1)?.time ?? -Infinity;
  const byTime = new Map<number, MarketCandle>(
    normalizedHistory.map((candle) => [candle.time, candle]),
  );

  for (const candle of normalizedLive) {
    const liveFormingBar = candle.closed === false;
    const outsideHistoryWindow =
      candle.time < historyFirstTime || candle.time > historyLastTime;
    if (
      outsideHistoryWindow ||
      (liveFormingBar && candle.time >= historyLastTime)
    ) {
      byTime.set(candle.time, candle);
    }
  }

  return normalizeMarketCandleSeries([...byTime.values()], maxCandles);
}

function prefixReferencesMatch<T>(
  previous: readonly T[],
  next: readonly T[],
  count: number,
): boolean {
  for (let index = 0; index < count; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

export function resolveRealtimeSeriesUpdatePlan<T extends { time: number }>(
  previous: readonly T[],
  next: readonly T[],
  sameStyleContext: boolean,
): RealtimeSeriesUpdatePlan {
  if (!sameStyleContext || previous.length === 0 || next.length === 0) {
    return "replace";
  }

  const previousLast = previous[previous.length - 1];
  const nextLast = next[next.length - 1];

  if (
    next.length === previous.length &&
    nextLast?.time === previousLast?.time &&
    prefixReferencesMatch(previous, next, Math.max(0, next.length - 1))
  ) {
    return "update-latest";
  }

  if (
    next.length === previous.length + 1 &&
    next[next.length - 2] === previousLast &&
    prefixReferencesMatch(previous, next, previous.length)
  ) {
    return "append";
  }

  return "replace";
}
