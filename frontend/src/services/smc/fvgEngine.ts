/**
 * Fair Value Gap detection.
 *
 * 3-candle imbalance:
 *   Bullish FVG  → low[i] > high[i-2]      gap = [high[i-2], low[i]]
 *   Bearish FVG  → high[i] < low[i-2]      gap = [high[i], low[i-2]]
 *
 * A gap is "mitigated" once a later candle trades back into it. Fully filled
 * gaps can be auto-removed by the caller.
 */
import type { Candle, FairValueGap } from '@/types';
import { uid } from '@/utils/id';

export interface FvgOptions {
  /** Minimum gap size as a fraction of price (filters microscopic gaps). */
  minSizePct: number;
  /** Drop gaps once fully filled. */
  removeFilled: boolean;
}

export const DEFAULT_FVG: FvgOptions = { minSizePct: 0.0003, removeFilled: true };

export function detectFvgs(candles: Candle[], opts: FvgOptions = DEFAULT_FVG): FairValueGap[] {
  const gaps: FairValueGap[] = [];

  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const c = candles[i];
    const mid = i - 1;

    // Bullish gap
    if (c.low > a.high) {
      const top = c.low;
      const bottom = a.high;
      if ((top - bottom) / c.close >= opts.minSizePct) {
        gaps.push({
          id: uid('fvg'),
          direction: 'bullish',
          top,
          bottom,
          index: mid,
          time: candles[mid].time,
          state: 'active',
        });
      }
    }
    // Bearish gap
    else if (c.high < a.low) {
      const top = a.low;
      const bottom = c.high;
      if ((top - bottom) / c.close >= opts.minSizePct) {
        gaps.push({
          id: uid('fvg'),
          direction: 'bearish',
          top,
          bottom,
          index: mid,
          time: candles[mid].time,
          state: 'active',
        });
      }
    }
  }

  // Mitigation: scan forward from each gap's formation.
  for (const g of gaps) {
    for (let j = g.index + 2; j < candles.length; j++) {
      const k = candles[j];
      const entered = g.direction === 'bullish' ? k.low <= g.top : k.high >= g.bottom;
      if (entered) {
        g.state = 'mitigated';
        g.mitigatedAtIndex = j;
        break;
      }
    }
  }

  if (opts.removeFilled) {
    return gaps.filter((g) => {
      if (g.state !== 'mitigated' || g.mitigatedAtIndex == null) return true;
      // Keep unless price has wholly traversed the gap (fully filled).
      const k = candles[g.mitigatedAtIndex];
      const filled = g.direction === 'bullish' ? k.low <= g.bottom : k.high >= g.top;
      return !filled;
    });
  }
  return gaps;
}
