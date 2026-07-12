import type { Candle, Point } from "../../../../types";
import type { DrawingMagnetMode } from "../settings/drawingToolPreferences";

export const WEAK_MAGNET_DISTANCE_PX = 12;

export interface OhlcMagnetSnapOptions {
  point: Point;
  candles: readonly Candle[];
  mode: DrawingMagnetMode;
  toX: (time: number) => number | null;
  toY: (price: number) => number | null;
  weakDistancePx?: number;
}

export interface OhlcMagnetSnapResult {
  point: Point;
  snapped: boolean;
  candleTime?: number;
  field?: "open" | "high" | "low" | "close";
  distancePx?: number;
}

const OHLC_FIELDS = ["open", "high", "low", "close"] as const;

function nearestTimeCandidateIndexes(candles: readonly Candle[], time: number): number[] {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return [...new Set([Math.min(low, candles.length - 1), Math.max(0, low - 1)])];
}

/** Resolve persisted mode plus TradingView's Ctrl/Cmd temporary inversion. */
export function effectiveMagnetMode(
  enabled: boolean,
  mode: DrawingMagnetMode,
  temporaryToggle: boolean,
): DrawingMagnetMode | null {
  return enabled !== temporaryToggle ? mode : null;
}

/**
 * Pure CSS-pixel snap service. It selects the nearest projected candle on the
 * time axis, then the closest distinct OHLC value on that candle. Strong mode
 * always accepts it; weak mode accepts only within the configured 2D radius.
 */
export function snapPointToOhlc(options: OhlcMagnetSnapOptions): OhlcMagnetSnapResult {
  const pointX = options.toX(options.point.time);
  const pointY = options.toY(options.point.price);
  if (pointX == null || pointY == null || options.candles.length === 0) {
    return { point: { ...options.point }, snapped: false };
  }

  let candle: Candle | null = null;
  let candleX = 0;
  let bestXDistance = Number.POSITIVE_INFINITY;
  for (const index of nearestTimeCandidateIndexes(options.candles, options.point.time)) {
    const candidate = options.candles[index];
    const x = options.toX(candidate.time);
    if (x == null) continue;
    const distance = Math.abs(x - pointX);
    if (distance < bestXDistance) {
      candle = candidate;
      candleX = x;
      bestXDistance = distance;
    }
  }
  if (!candle) return { point: { ...options.point }, snapped: false };

  let best: Omit<OhlcMagnetSnapResult, "point" | "snapped"> & { price: number } | null = null;
  const seenPrices = new Set<number>();
  for (const field of OHLC_FIELDS) {
    const price = candle[field];
    if (!Number.isFinite(price) || seenPrices.has(price)) continue;
    seenPrices.add(price);
    const y = options.toY(price);
    if (y == null) continue;
    const distancePx = Math.hypot(candleX - pointX, y - pointY);
    if (!best || distancePx < best.distancePx!) {
      best = { price, candleTime: candle.time, field, distancePx };
    }
  }
  if (!best) return { point: { ...options.point }, snapped: false };

  const threshold = options.weakDistancePx ?? WEAK_MAGNET_DISTANCE_PX;
  if (options.mode === "weak" && best.distancePx! > threshold) {
    return { point: { ...options.point }, snapped: false };
  }
  return {
    point: { time: best.candleTime!, price: best.price },
    snapped: true,
    candleTime: best.candleTime,
    field: best.field,
    distancePx: best.distancePx,
  };
}
