/**
 * Market-structure engine: swing detection, HH/HL/LH/LL labelling and
 * BOS / CHOCH / MSS events.
 *
 * Replay-safety: a swing at index s is only "confirmed" `strength` bars later
 * (s + strength). Because the engine runs over the visible slice, the final
 * `strength` candles can't yet have confirmed swings — exactly mirroring how a
 * trader can only confirm a pivot after the fact. No future data is consulted.
 */
import type { Candle, Direction, MarketStructure, SwingPoint } from '@/types';
import { uid } from '@/utils/id';
import { isDisplacement } from './displacementEngine';

export interface StructureOptions {
  /** Fractal strength: bars on each side that a pivot must exceed. */
  strength: number;
}

export const DEFAULT_STRUCTURE: StructureOptions = { strength: 2 };

/** Confirmed fractal swing points (excluding the unconfirmed tail). */
export function detectSwings(candles: Candle[], strength = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = strength; i < candles.length - strength; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= strength; j++) {
      if (candles[i - j].high >= c.high || candles[i + j].high > c.high) isHigh = false;
      if (candles[i - j].low <= c.low || candles[i + j].low < c.low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, time: c.time, price: c.high, kind: 'high' });
    if (isLow) swings.push({ index: i, time: c.time, price: c.low, kind: 'low' });
  }
  swings.sort((a, b) => a.index - b.index);
  labelSwings(swings);
  return swings;
}

/** Assign HH/HL/LH/LL by comparing each swing to the previous one of its kind. */
function labelSwings(swings: SwingPoint[]) {
  let prevHigh: SwingPoint | null = null;
  let prevLow: SwingPoint | null = null;
  for (const s of swings) {
    if (s.kind === 'high') {
      if (prevHigh) s.label = s.price > prevHigh.price ? 'HH' : 'LH';
      prevHigh = s;
    } else {
      if (prevLow) s.label = s.price < prevLow.price ? 'LL' : 'HL';
      prevLow = s;
    }
  }
}

export interface StructureResult {
  swings: SwingPoint[];
  structures: MarketStructure[];
  trend: Direction | 'ranging';
}

/**
 * Single forward pass that emits BOS / CHOCH / MSS as price closes through the
 * most recent confirmed swing high/low.
 *
 *  - BOS   : break in the direction of the prevailing trend (continuation)
 *  - CHOCH : first break against the prevailing trend (character change)
 *  - MSS   : a CHOCH whose breaking candle is a displacement (decisive shift)
 */
export function computeStructure(
  candles: Candle[],
  opts: StructureOptions = DEFAULT_STRUCTURE,
): StructureResult {
  const strength = opts.strength;
  const swings = detectSwings(candles, strength);
  const structures: MarketStructure[] = [];

  // Index at which each swing becomes usable (confirmation lag).
  const confirmAt = (s: SwingPoint) => s.index + strength;

  let activeHigh: SwingPoint | null = null;
  let activeLow: SwingPoint | null = null;
  let trend: Direction | 'ranging' = 'ranging';
  let swingPtr = 0;

  for (let i = strength; i < candles.length; i++) {
    // Promote swings whose confirmation bar has arrived.
    while (swingPtr < swings.length && confirmAt(swings[swingPtr]) <= i) {
      const s = swings[swingPtr++];
      if (s.kind === 'high') activeHigh = s;
      else activeLow = s;
    }

    const close = candles[i].close;

    // Bullish break of the active swing high.
    if (activeHigh && close > activeHigh.price) {
      const event = trend === 'bearish' ? (isDisplacement(candles, i) ? 'MSS' : 'CHOCH') : 'BOS';
      structures.push({
        id: uid('ms'),
        event,
        direction: 'bullish',
        price: activeHigh.price,
        confirmedAtIndex: i,
        confirmedAtTime: candles[i].time,
        fromIndex: activeHigh.index,
        fromTime: activeHigh.time,
      });
      trend = 'bullish';
      activeHigh = null; // consume; next confirmed high becomes the new target
    }
    // Bearish break of the active swing low.
    else if (activeLow && close < activeLow.price) {
      const event = trend === 'bullish' ? (isDisplacement(candles, i) ? 'MSS' : 'CHOCH') : 'BOS';
      structures.push({
        id: uid('ms'),
        event,
        direction: 'bearish',
        price: activeLow.price,
        confirmedAtIndex: i,
        confirmedAtTime: candles[i].time,
        fromIndex: activeLow.index,
        fromTime: activeLow.time,
      });
      trend = 'bearish';
      activeLow = null;
    }
  }

  return { swings, structures, trend };
}
