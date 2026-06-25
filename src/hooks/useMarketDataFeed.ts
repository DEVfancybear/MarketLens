'use client';
/**
 * useMarketDataFeed (Phase 1, Step 9) — the realtime aggregate read hook.
 *
 * Combines the active symbol/timeframe, its candle series, latest quote and the
 * connection status from `marketDataStore` using atomic selectors. This is the
 * read-only "useMarketData" for the realtime pipeline; it will take over the
 * `useMarketData.ts` filename in Step 11 once the mock chart loader is retired.
 *
 * Read-only — never opens a socket. The connection lifecycle (connect /
 * subscribe / history priming) is driven by MarketDataService from a single
 * bootstrap point added in Steps 10–13.
 */
import { useMarketDataStore } from '@/store/marketDataStore';
import { useCandles } from './useCandles';
import { useQuote } from './useQuote';
import type { ConnectionStatus, MarketCandle, MarketQuote, Timeframe } from '@/types';

export interface MarketDataFeed {
  symbol: string;
  timeframe: Timeframe;
  status: ConnectionStatus;
  candles: MarketCandle[];
  quote: MarketQuote | undefined;
}

export function useMarketDataFeed(): MarketDataFeed {
  const symbol = useMarketDataStore((s) => s.selectedSymbol);
  const timeframe = useMarketDataStore((s) => s.selectedTimeframe);
  const status = useMarketDataStore((s) => s.connectionStatus);
  const candles = useCandles(symbol, timeframe);
  const quote = useQuote(symbol);
  return { symbol, timeframe, status, candles, quote };
}
