'use client';
/**
 * useQuote (Phase 1, Step 9).
 *
 * Read-only selector for a single symbol's latest quote. Use one call per
 * watchlist row (atomic selectors) so a tick on one symbol never re-renders the
 * others. Never opens a socket.
 */
import { useMarketDataStore } from '@/store/marketDataStore';
import type { MarketQuote } from '@/types';

export function useQuote(symbol: string): MarketQuote | undefined {
  return useMarketDataStore((s) => s.quotes[symbol]);
}

/** Convenience: the last price for a symbol (or undefined). */
export function useLastPrice(symbol: string): number | undefined {
  return useMarketDataStore((s) => s.quotes[symbol]?.last);
}
