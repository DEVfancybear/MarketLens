/** MT5 charts and historical OHLC are Bid-based, so alerts must use Bid too. */
export function mt5ChartPrice(bid: number, ask: number): number | undefined {
  if (Number.isFinite(bid) && bid > 0) return bid;
  if (Number.isFinite(ask) && ask > 0) return ask;
  return undefined;
}

export function isFreshMt5Tick(
  timestampMs: number,
  nowMs = Date.now(),
  maxAgeMs = 60_000,
): boolean {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false;
  const age = nowMs - timestampMs;
  return age >= -5_000 && age <= maxAgeMs;
}

export function isOrderedMt5Tick(
  timestampMs: number,
  previousTimestampMs: number | undefined,
): boolean {
  return (
    Number.isFinite(timestampMs) &&
    timestampMs > 0 &&
    (previousTimestampMs === undefined || timestampMs >= previousTimestampMs)
  );
}
