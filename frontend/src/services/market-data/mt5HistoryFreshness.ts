import type { Timeframe } from "../../types";

export interface Mt5FreshnessSnapshot {
  lastError?: string;
  stale?: boolean;
  refreshPending?: boolean;
  freshnessKnown?: boolean;
  lastBarTime?: number;
  minimumFreshBarTime?: number;
  refreshExhausted?: boolean;
}

export interface Mt5HistoryPublicationSnapshot extends Mt5FreshnessSnapshot {
  authoritative?: boolean;
}

/** Backward-compatible classification for latest-window MT5 responses. */
export function isAuthoritativeMt5HistorySnapshot(snapshot: Mt5FreshnessSnapshot): boolean {
  if (snapshot.lastError || snapshot.stale || snapshot.refreshPending || snapshot.refreshExhausted) {
    return false;
  }
  if (snapshot.freshnessKnown === true) {
    return (
      Number.isFinite(snapshot.lastBarTime) &&
      Number.isFinite(snapshot.minimumFreshBarTime) &&
      (snapshot.lastBarTime ?? 0) >= (snapshot.minimumFreshBarTime ?? Number.POSITIVE_INFINITY)
    );
  }
  if (snapshot.freshnessKnown === false) return false;
  // Older backends omit freshness evidence. Preserve compatibility while new
  // backends mark unknown cached windows refreshPending until revalidated.
  return true;
}

/**
 * Latest MT5 history may expose a stale cache while a native refresh is still
 * warming. It is useful as backend fallback evidence, but publishing it to the
 * chart before the authoritative window lands makes the last bar disappear and
 * reappear, shifting the logical range and price autoscale twice.
 */
export function canPublishMt5HistoryPage(
  snapshot: Mt5HistoryPublicationSnapshot,
): boolean {
  return snapshot.authoritative === true &&
    isAuthoritativeMt5HistorySnapshot(snapshot);
}

export function mt5HistoryFreshnessError(
  snapshot: Mt5FreshnessSnapshot,
  symbol: string,
  timeframe: Timeframe,
): string {
  if (snapshot.lastError) return snapshot.lastError;
  if (snapshot.refreshExhausted) {
    return `MT5 ${symbol} ${timeframe} refresh exhausted before reaching the current bar`;
  }
  if (snapshot.stale) return `MT5 ${symbol} ${timeframe} history is stale`;
  if (snapshot.refreshPending) return `MT5 ${symbol} ${timeframe} history refresh is still pending`;
  return `MT5 ${symbol} ${timeframe} freshness could not be verified`;
}
