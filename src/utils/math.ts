import type { Candle } from '@/types';

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** True range for candle i given previous candle. */
export function trueRange(c: Candle, prev?: Candle): number {
  if (!prev) return c.high - c.low;
  return Math.max(
    c.high - c.low,
    Math.abs(c.high - prev.close),
    Math.abs(c.low - prev.close),
  );
}

/**
 * Wilder's ATR computed up to (and including) index `end`, looking back
 * `period` bars. Never touches data beyond `end` — safe for replay.
 */
export function atrAt(candles: Candle[], end: number, period = 14): number {
  if (end < 1) return candles[end] ? candles[end].high - candles[end].low : 0;
  const start = Math.max(1, end - period + 1);
  let sum = 0;
  let n = 0;
  for (let i = start; i <= end; i++) {
    sum += trueRange(candles[i], candles[i - 1]);
    n++;
  }
  return n ? sum / n : 0;
}

export function candleBody(c: Candle): number {
  return Math.abs(c.close - c.open);
}

export function candleRange(c: Candle): number {
  return c.high - c.low;
}

export function isBull(c: Candle): boolean {
  return c.close >= c.open;
}

export function roundTo(value: number, tick: number): number {
  if (tick <= 0) return value;
  return Math.round(value / tick) * tick;
}
