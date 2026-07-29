'use client';
/**
 * useQuote (Phase 1, Step 9).
 *
 * Read-only selector for a single symbol's latest quote. Use one call per
 * watchlist row (atomic selectors) so a tick on one symbol never re-renders the
 * others. Never opens a socket.
 */
import { useAtomValue } from 'jotai';
import {
  marketLastPriceAtom,
  marketQuoteAtom,
} from '@/store/marketDataStore';
import type { MarketQuote } from '@/types';

export function useQuote(symbol: string): MarketQuote | undefined {
  const quote = useAtomValue(marketQuoteAtom(symbol));
  return quote && Number.isFinite(quote.last) && quote.last > 0
    ? quote
    : undefined;
}

/** Convenience: the last price for a symbol (or undefined). */
export function useLastPrice(symbol: string): number | undefined {
  return useAtomValue(marketLastPriceAtom(symbol));
}
