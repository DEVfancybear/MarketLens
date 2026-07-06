import type { MarketCandle } from "@/types";

export type RealtimeSeriesUpdatePlan = "replace" | "update-latest" | "append";

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

  const historyLastTime = normalizedHistory.at(-1)?.time ?? -Infinity;
  const byTime = new Map<number, MarketCandle>(
    normalizedHistory.map((candle) => [candle.time, candle]),
  );

  for (const candle of normalizedLive) {
    const liveFormingBar = candle.closed === false;
    if (candle.time > historyLastTime || (liveFormingBar && candle.time >= historyLastTime)) {
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
