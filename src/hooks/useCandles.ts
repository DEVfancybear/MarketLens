'use client';
/**
 * useCandles (Phase 1, Step 9).
 *
 * Read-only selector over `marketDataStore`. Returns the candle series for a
 * symbol+timeframe (defaults to the active selection). Atomic selector → the
 * component only re-renders when that specific series array changes. Never opens
 * a socket — connection lifecycle is owned by MarketDataService.
 */
import { useMarketDataStore } from '@/store/marketDataStore';
import { subscriptionKey, type MarketCandle, type Timeframe } from '@/types';

const EMPTY: MarketCandle[] = [];

export function useCandles(symbol?: string, timeframe?: Timeframe): MarketCandle[] {
  return useMarketDataStore((s) => {
    const sym = symbol ?? s.selectedSymbol;
    const tf = timeframe ?? s.selectedTimeframe;
    return s.candles[subscriptionKey(sym, tf)] ?? EMPTY;
  });
}
