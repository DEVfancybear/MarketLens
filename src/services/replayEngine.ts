/**
 * Replay engine helpers.
 *
 * The replay cursor (in replayStore) is the ONLY gate on visibility: callers
 * derive the visible slice as candles[0..cursor]. These helpers never look
 * beyond a supplied index/time, preserving the no-look-ahead guarantee.
 */
import type { Candle, Direction, Timeframe } from '@/types';
import { TF_SECONDS } from '@/types';
import { utcHours } from '@/utils/time';
import type { ReplaySpeed } from '@/store/replayStore';

/** Milliseconds between auto-steps for a given speed (1x ≈ 1s per candle). */
export function speedToIntervalMs(speed: ReplaySpeed): number {
  return Math.max(16, 1000 / speed);
}

export function replaySpeedLabel(speed: ReplaySpeed): string {
  return `${speed}x`;
}

export function replaySpeedDescription(speed: ReplaySpeed): string {
  if (speed < 1) {
    const seconds = Math.round(1 / speed);
    return `1 update per ${seconds} sec`;
  }
  return `${speed} update${speed === 1 ? "" : "s"} per sec`;
}

/** Largest index whose candle time is <= `time` (binary search). */
export function indexAtOrBefore(candles: Candle[], time: number): number {
  if (candles.length === 0) return -1;
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Index of the candle whose open time is closest to `time`. */
export function indexNearestByTime(candles: Candle[], time: number): number {
  if (candles.length === 0) return -1;
  const before = indexAtOrBefore(candles, time);
  if (before < 0) return 0;
  if (before >= candles.length - 1) return candles.length - 1;
  const after = before + 1;
  return Math.abs(candles[before].time - time) <=
    Math.abs(candles[after].time - time)
    ? before
    : after;
}

/** Simple structural trend from a window of closes (replay-safe). */
export function quickTrend(visible: Candle[]): Direction | 'ranging' {
  const n = visible.length;
  if (n < 20) return 'ranging';
  const window = visible.slice(-50);
  const first = window[0].close;
  const last = window[window.length - 1].close;
  const change = (last - first) / first;
  const threshold = 0.0015;
  if (change > threshold) return 'bullish';
  if (change < -threshold) return 'bearish';
  return 'ranging';
}

export type SessionLabel = 'Asian' | 'London' | 'New York' | 'Closed';

/** Current trading session for a UTC timestamp. */
export function sessionAt(time: number): SessionLabel {
  const h = utcHours(time);
  // London 07–16, New York 13–21 (overlap favours NY), Asian 23–08.
  if (h >= 13 && h < 21) return 'New York';
  if (h >= 7 && h < 16) return 'London';
  if (h >= 23 || h < 8) return 'Asian';
  return 'Closed';
}

export interface MtfRow {
  timeframe: Timeframe;
  candle: Candle | null;
  trend: Direction | 'ranging';
}

/**
 * Multi-timeframe snapshot at a replay timestamp. Pure: the per-timeframe history
 * is supplied by the caller (`seriesByTf`, loaded from the real
 * HistoricalDataService — see `useMtfSnapshotSeries`). Each series is truncated to
 * bars opened at/just before `time`, so no higher-TF bar reveals information past
 * the replay cursor (the no-look-ahead guarantee).
 */
export function mtfSnapshot(
  time: number,
  seriesByTf: Partial<Record<Timeframe, Candle[]>>,
  timeframes: Timeframe[] = ['5m', '15m', '1H', '4H', '1D'],
): MtfRow[] {
  return timeframes.map((tf) => {
    const series = seriesByTf[tf] ?? [];
    if (series.length === 0) return { timeframe: tf, candle: null, trend: 'ranging' };
    // Only bars whose *open* time has begun by `time`. The forming bar is the
    // last with open <= time; we treat it as the current (developing) candle.
    const idx = indexAtOrBefore(series, time);
    const visible = series.slice(0, idx + 1);
    return { timeframe: tf, candle: visible[visible.length - 1] ?? null, trend: quickTrend(visible) };
  });
}

/** Convenience: bar span label for the active timeframe. */
export function barSpanSeconds(tf: Timeframe): number {
  return TF_SECONDS[tf];
}
