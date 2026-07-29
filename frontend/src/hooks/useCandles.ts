'use client';
/**
 * useCandles (Phase 1, Step 9).
 *
 * Read-only selector over `marketDataStore`. Returns the candle series for a
 * symbol+timeframe (defaults to the active selection). Atomic selector → the
 * component only re-renders when that specific series array changes. Never opens
 * a socket — connection lifecycle is owned by MarketDataService.
 */
import { useAtomValue } from 'jotai';
import { marketCandleSeriesAtom } from '@/store/marketDataStore';
import type { MarketCandle, Timeframe } from '@/types';

export function useCandles(symbol?: string, timeframe?: Timeframe): MarketCandle[] {
  return useAtomValue(marketCandleSeriesAtom(symbol, timeframe));
}
