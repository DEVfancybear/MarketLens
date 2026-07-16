/**
 * MarketQuote.volume is a cumulative session/24h value for the current feeds.
 * Convert it into the measured volume attributable to one quote update.
 */
export function measuredCumulativeVolumeDelta(
  current: number,
  previous: number | undefined,
): number | undefined {
  if (
    !Number.isFinite(current) ||
    current <= 0 ||
    previous == null ||
    !Number.isFinite(previous)
  ) return undefined;
  const delta = current - previous;
  return Number.isFinite(delta) && delta > 0 ? delta : undefined;
}

export function normalizedCumulativeVolume(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
