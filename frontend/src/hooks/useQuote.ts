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
import { resolveObservedSymbol } from '@/services/alertSymbols';

export function useQuote(symbol: string): MarketQuote | undefined {
  return useMarketDataStore((s) => {
    const resolved = resolveObservedSymbol(symbol, Object.keys(s.quotes));
    const quote = resolved ? s.quotes[resolved] : undefined;
    return quote && Number.isFinite(quote.last) && quote.last > 0
      ? quote
      : undefined;
  });
}

/** Convenience: the last price for a symbol (or undefined). */
export function useLastPrice(symbol: string): number | undefined {
  return useMarketDataStore((s) => {
    const resolved = resolveObservedSymbol(symbol, Object.keys(s.quotes));
    const price = resolved ? s.quotes[resolved]?.last : undefined;
    return price !== undefined && Number.isFinite(price) && price > 0
      ? price
      : undefined;
  });
}
