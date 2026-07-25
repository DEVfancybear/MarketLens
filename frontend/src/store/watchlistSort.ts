import type { MarketQuote } from "@/types";
import type { SortDir, SortKey } from "./watchlistStore";

export interface SortableWatchlistSymbol {
  ticker: string;
  index: number;
}

function sortValue(
  ticker: string,
  sortKey: SortKey,
  quotes: Record<string, MarketQuote>,
): number | undefined {
  const quote = quotes[ticker];
  if (!quote) return undefined;
  if (sortKey === "price") return quote.last;
  if (sortKey === "change") {
    return Number.isFinite(quote.changePct)
      ? Number(quote.changePct.toFixed(2))
      : undefined;
  }
  if (sortKey === "changeAbs") return quote.change;
  if (sortKey === "volume") return quote.volume;
  return undefined;
}

/** Shared stable sort policy for desktop rows and mobile market cards. */
export function sortWatchlistSymbols(
  entries: readonly SortableWatchlistSymbol[],
  sortKey: SortKey,
  sortDir: SortDir,
  quotes: Record<string, MarketQuote>,
): SortableWatchlistSymbol[] {
  if (sortKey === "manual") return [...entries];
  const direction = sortDir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (sortKey === "symbol") {
      return a.ticker.localeCompare(b.ticker) * direction;
    }
    const aValue = sortValue(a.ticker, sortKey, quotes);
    const bValue = sortValue(b.ticker, sortKey, quotes);
    const aMissing = aValue === undefined || !Number.isFinite(aValue);
    const bMissing = bValue === undefined || !Number.isFinite(bValue);
    if (aMissing && bMissing) return a.index - b.index;
    if (aMissing) return 1;
    if (bMissing) return -1;
    const delta = (aValue - bValue) * direction;
    return delta || a.index - b.index;
  });
}
