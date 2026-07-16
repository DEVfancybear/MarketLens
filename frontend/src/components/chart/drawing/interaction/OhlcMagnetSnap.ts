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

/** A projected value emitted by an overlay indicator (not a separate pane). */
export interface IndicatorMagnetPoint {
  time: number;
  value: number;
  /** Stable ids are useful for diagnostics and future per-indicator filters. */
  sourceId?: string;
  seriesKey?: string;
}

export interface IndicatorMagnetSnapOptions {
  point: Point;
  indicators: readonly IndicatorMagnetPoint[];
  toX: (time: number) => number | null;
  toY: (price: number) => number | null;
  weakDistancePx?: number;
}

export interface IndicatorMagnetSnapResult {
  point: Point;
  snapped: boolean;
  sourceId?: string;
  seriesKey?: string;
  distancePx?: number;
}

export interface CombinedMagnetSnapOptions {
  point: Point;
  candles: readonly Candle[];
  indicators: readonly IndicatorMagnetPoint[];
  mode: DrawingMagnetMode;
  snapToIndicators: boolean;
  toX: (time: number) => number | null;
  toY: (price: number) => number | null;
  weakDistancePx?: number;
}

export interface CombinedMagnetSnapResult {
  point: Point;
  snapped: boolean;
  source?: "ohlc" | "indicator";
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
    point: { ...options.point, time: best.candleTime!, price: best.price },
    snapped: true,
    candleTime: best.candleTime,
    field: best.field,
    distancePx: best.distancePx,
  };
}

/**
 * Snap to the nearest value from visible overlay indicators.  TradingView's
 * “Snap to indicators” is an explicit magnet mode, so it intentionally does
 * not fall back to OHLC when no indicator value is available.  A weak pixel
 * guard is still honoured when supplied by callers; the default accepts the
 * nearest finite indicator point because the mode itself is an explicit opt-in.
 */
export function snapPointToIndicator(
  options: IndicatorMagnetSnapOptions,
): IndicatorMagnetSnapResult {
  const pointX = options.toX(options.point.time);
  const pointY = options.toY(options.point.price);
  if (pointX == null || pointY == null || options.indicators.length === 0) {
    return { point: { ...options.point }, snapped: false };
  }
  let best: (IndicatorMagnetPoint & { distancePx: number }) | null = null;
  for (const candidate of options.indicators) {
    if (!Number.isFinite(candidate.time) || !Number.isFinite(candidate.value)) continue;
    const x = options.toX(candidate.time);
    const y = options.toY(candidate.value);
    if (x == null || y == null) continue;
    const distancePx = Math.hypot(x - pointX, y - pointY);
    if (!best || distancePx < best.distancePx) {
      best = { ...candidate, distancePx };
    }
  }
  if (!best) return { point: { ...options.point }, snapped: false };
  const threshold = options.weakDistancePx;
  if (threshold != null && best.distancePx > threshold) {
    return { point: { ...options.point }, snapped: false };
  }
  return {
    point: { ...options.point, time: best.time, price: best.value },
    snapped: true,
    sourceId: best.sourceId,
    seriesKey: best.seriesKey,
    distancePx: best.distancePx,
  };
}

/**
 * Indicator values augment OHLC candidates under the current Weak/Strong
 * policy. Both sources use the same projected CSS-pixel distance and the
 * nearest candidate wins; ties deliberately keep the native OHLC candidate.
 */
export function snapPointWithMagnetSources(
  options: CombinedMagnetSnapOptions,
): CombinedMagnetSnapResult {
  const weakDistancePx = options.weakDistancePx ?? WEAK_MAGNET_DISTANCE_PX;
  const ohlc = snapPointToOhlc({
    point: options.point,
    candles: options.candles,
    mode: options.mode,
    toX: options.toX,
    toY: options.toY,
    weakDistancePx,
  });
  const indicator = options.snapToIndicators
    ? snapPointToIndicator({
        point: options.point,
        indicators: options.indicators,
        toX: options.toX,
        toY: options.toY,
        weakDistancePx: options.mode === "weak" ? weakDistancePx : undefined,
      })
    : { point: { ...options.point }, snapped: false as const };

  if (
    indicator.snapped &&
    (!ohlc.snapped || (indicator.distancePx ?? Infinity) < (ohlc.distancePx ?? Infinity))
  ) {
    return {
      point: indicator.point,
      snapped: true,
      source: "indicator",
      distancePx: indicator.distancePx,
    };
  }
  if (ohlc.snapped) {
    return {
      point: ohlc.point,
      snapped: true,
      source: "ohlc",
      distancePx: ohlc.distancePx,
    };
  }
  return { point: { ...options.point }, snapped: false };
}
