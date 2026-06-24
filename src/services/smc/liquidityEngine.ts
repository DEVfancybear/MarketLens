/**
 * Liquidity engine: equal highs / equal lows (resting liquidity pools) and the
 * sweeps that run them.
 *
 *   Equal Highs (EQH) → buy-side liquidity resting above
 *   Equal Lows  (EQL) → sell-side liquidity resting below
 *
 * A sweep is detected when price spikes beyond a pool then closes back on the
 * other side (a stop run / liquidity grab).
 */
import type { Candle, LiquidityZone, SwingPoint } from '@/types';
import { uid } from '@/utils/id';
import { atrAt } from '@/utils/math';

export interface LiquidityOptions {
  /** Cluster tolerance as a fraction of price. */
  tolerancePct: number;
  /** Minimum equal touches to form a pool. */
  minTouches: number;
}

export const DEFAULT_LIQUIDITY: LiquidityOptions = { tolerancePct: 0.0006, minTouches: 2 };

export function detectLiquidity(
  candles: Candle[],
  swings: SwingPoint[],
  opts: LiquidityOptions = DEFAULT_LIQUIDITY,
): LiquidityZone[] {
  const zones: LiquidityZone[] = [];
  const highs = swings.filter((s) => s.kind === 'high');
  const lows = swings.filter((s) => s.kind === 'low');

  zones.push(...cluster(highs, 'EQH', candles, opts));
  zones.push(...cluster(lows, 'EQL', candles, opts));

  // Sweep detection.
  for (const z of zones) {
    const lastFormIdx = Math.max(...z.indices);
    for (let j = lastFormIdx + 1; j < candles.length; j++) {
      const k = candles[j];
      if (z.kind === 'EQH' && k.high > z.price && k.close < z.price) {
        z.swept = true;
        z.sweptAtIndex = j;
        break;
      }
      if (z.kind === 'EQL' && k.low < z.price && k.close > z.price) {
        z.swept = true;
        z.sweptAtIndex = j;
        break;
      }
    }
  }

  return zones;
}

function cluster(
  points: SwingPoint[],
  kind: 'EQH' | 'EQL',
  candles: Candle[],
  opts: LiquidityOptions,
): LiquidityZone[] {
  const out: LiquidityZone[] = [];
  const used = new Set<number>();

  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const base = points[i];
    const tol = Math.max(base.price * opts.tolerancePct, atrAt(candles, base.index, 14) * 0.15);
    const group = [base];
    const idxs = [i];
    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(points[j].price - base.price) <= tol) {
        group.push(points[j]);
        idxs.push(j);
      }
    }
    if (group.length >= opts.minTouches) {
      idxs.forEach((k) => used.add(k));
      const price = group.reduce((s, p) => s + p.price, 0) / group.length;
      out.push({
        id: uid('liq'),
        kind,
        side: kind === 'EQH' ? 'buyside' : 'sellside',
        price,
        indices: group.map((p) => p.index),
        time: group[group.length - 1].time,
        swept: false,
      });
    }
  }
  return out;
}
