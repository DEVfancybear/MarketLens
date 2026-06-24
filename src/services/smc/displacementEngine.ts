/**
 * Displacement detection.
 *
 * A displacement is an impulsive candle whose range is a large ATR multiple,
 * with a dominant body and elevated relative volume — the footprint of smart
 * money moving price. Used to validate order blocks and qualify MSS events.
 */
import type { Candle, Displacement } from '@/types';
import { atrAt, candleBody, candleRange, isBull, mean } from '@/utils/math';
import { uid } from '@/utils/id';

export interface DisplacementOptions {
  atrPeriod: number;
  atrMultiple: number; // minimum range / ATR
  bodyRatio: number; // minimum body / range
  volMultiple: number; // minimum volume / avg volume
}

export const DEFAULT_DISPLACEMENT: DisplacementOptions = {
  atrPeriod: 14,
  atrMultiple: 1.6,
  bodyRatio: 0.55,
  volMultiple: 1.3,
};

/** Returns true if candle `i` qualifies as a displacement. */
export function isDisplacement(
  candles: Candle[],
  i: number,
  opts: DisplacementOptions = DEFAULT_DISPLACEMENT,
): boolean {
  if (i < opts.atrPeriod) return false;
  const c = candles[i];
  const atr = atrAt(candles, i - 1, opts.atrPeriod);
  if (atr <= 0) return false;
  const range = candleRange(c);
  const body = candleBody(c);
  const avgVol = mean(candles.slice(Math.max(0, i - 20), i).map((k) => k.volume)) || 1;
  return (
    range >= atr * opts.atrMultiple &&
    body >= range * opts.bodyRatio &&
    c.volume >= avgVol * opts.volMultiple
  );
}

export function displacementMetrics(
  candles: Candle[],
  i: number,
  opts: DisplacementOptions = DEFAULT_DISPLACEMENT,
): Displacement | null {
  if (!isDisplacement(candles, i, opts)) return null;
  const c = candles[i];
  const atr = atrAt(candles, i - 1, opts.atrPeriod) || 1;
  const avgVol = mean(candles.slice(Math.max(0, i - 20), i).map((k) => k.volume)) || 1;
  return {
    id: uid('disp'),
    direction: isBull(c) ? 'bullish' : 'bearish',
    index: i,
    time: c.time,
    atrMultiple: candleRange(c) / atr,
    bodyExpansion: candleBody(c) / (candleRange(c) || 1),
    relativeVolume: c.volume / avgVol,
  };
}

/** Scan the whole visible window for displacements. */
export function detectDisplacements(
  candles: Candle[],
  opts: DisplacementOptions = DEFAULT_DISPLACEMENT,
): Displacement[] {
  const out: Displacement[] = [];
  for (let i = opts.atrPeriod; i < candles.length; i++) {
    const d = displacementMetrics(candles, i, opts);
    if (d) out.push(d);
  }
  return out;
}
