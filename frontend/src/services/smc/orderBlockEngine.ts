/**
 * Order Block detection.
 *
 * An order block is the last opposite-colour candle before an impulsive move
 * that breaks structure. We anchor OBs to confirmed BOS/MSS events (so they are
 * only ever shown once their originating break is itself confirmed) and require
 * a displacement leg for higher-quality blocks.
 *
 *   Bullish OB → last bearish candle before a bullish break  (demand)
 *   Bearish OB → last bullish candle before a bearish break  (supply)
 *
 * States: fresh → mitigated (price returns into zone) → invalidated (zone broken).
 */
import type { Candle, MarketStructure, OrderBlock } from '@/types';
import { uid } from '@/utils/id';
import { isBull } from '@/utils/math';
import { isDisplacement } from './displacementEngine';

export interface OrderBlockOptions {
  /** How far back to search for the originating candle. */
  lookback: number;
  /** Require a displacement candle in the impulse leg. */
  requireDisplacement: boolean;
}

export const DEFAULT_OB: OrderBlockOptions = { lookback: 15, requireDisplacement: false };

export function detectOrderBlocks(
  candles: Candle[],
  structures: MarketStructure[],
  opts: OrderBlockOptions = DEFAULT_OB,
): OrderBlock[] {
  const blocks: OrderBlock[] = [];

  for (const s of structures) {
    const ci = s.confirmedAtIndex;
    const wantBullishCandle = s.direction === 'bearish'; // bearish OB = last UP candle
    let obIndex = -1;

    for (let j = ci - 1; j >= Math.max(0, ci - opts.lookback); j--) {
      if (isBull(candles[j]) === wantBullishCandle) {
        obIndex = j;
        break;
      }
    }
    if (obIndex < 0) continue;

    // Displacement present anywhere in the impulse leg (obIndex, ci]?
    let hasDisp = false;
    for (let j = obIndex + 1; j <= ci; j++) {
      if (isDisplacement(candles, j)) { hasDisp = true; break; }
    }
    if (opts.requireDisplacement && !hasDisp) continue;

    const oc = candles[obIndex];
    const block: OrderBlock = {
      id: uid('ob'),
      direction: s.direction,
      top: oc.high,
      bottom: oc.low,
      index: obIndex,
      time: oc.time,
      state: 'fresh',
      hasDisplacement: hasDisp,
      bosIndex: ci,
    };

    // Evaluate state from the break onward.
    for (let j = ci + 1; j < candles.length; j++) {
      const k = candles[j];
      if (block.direction === 'bullish') {
        if (k.close < block.bottom) { block.state = 'invalidated'; block.mitigatedAtIndex = j; break; }
        if (k.low <= block.top) { block.state = 'mitigated'; block.mitigatedAtIndex = j; break; }
      } else {
        if (k.close > block.top) { block.state = 'invalidated'; block.mitigatedAtIndex = j; break; }
        if (k.high >= block.bottom) { block.state = 'mitigated'; block.mitigatedAtIndex = j; break; }
      }
    }

    blocks.push(block);
  }

  // De-duplicate overlapping OBs anchored to the same candle.
  const seen = new Set<number>();
  return blocks.filter((b) => (seen.has(b.index) ? false : (seen.add(b.index), true)));
}
