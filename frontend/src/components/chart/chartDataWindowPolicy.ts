interface CandleWindowPoint {
  time: number;
}

export interface CandleDataWindowResetInput {
  previous: readonly CandleWindowPoint[];
  next: readonly CandleWindowPoint[];
  structuralDataWindowChange: boolean;
  marketSeriesChanged: boolean;
}

function candleWindowsOverlap(
  previous: readonly CandleWindowPoint[],
  next: readonly CandleWindowPoint[],
): boolean {
  const previousFirst = previous[0]?.time;
  const previousLast = previous.at(-1)?.time;
  const nextFirst = next[0]?.time;
  const nextLast = next.at(-1)?.time;
  if (
    previousFirst == null ||
    previousLast == null ||
    nextFirst == null ||
    nextLast == null
  ) {
    return false;
  }
  return previousFirst <= nextLast && nextFirst <= previousLast;
}

/**
 * A symbol/timeframe identity change is always a fresh data window.
 *
 * Timestamp overlap alone cannot identify a history prepend: FX symbols share
 * the same trading calendar, so two unrelated series usually overlap exactly.
 */
export function isCandleDataWindowReset({
  previous,
  next,
  structuralDataWindowChange,
  marketSeriesChanged,
}: CandleDataWindowResetInput): boolean {
  return marketSeriesChanged ||
    (structuralDataWindowChange && !candleWindowsOverlap(previous, next));
}
