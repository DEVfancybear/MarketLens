/** MT5 charts and historical OHLC are Bid-based, so alerts must use Bid too. */
export function mt5ChartPrice(bid: number, ask: number): number | undefined {
  if (Number.isFinite(bid) && bid > 0) return bid;
  if (Number.isFinite(ask) && ask > 0) return ask;
  return undefined;
}
