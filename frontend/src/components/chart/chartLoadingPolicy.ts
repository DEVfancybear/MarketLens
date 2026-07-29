export interface ChartLoadingPolicyInput {
  benchmark: boolean;
  replayOwnsChart: boolean;
  replayConnecting: boolean;
  loading: boolean;
  candleCount: number;
}

/**
 * A warm cache is already interactive. Only cover an empty chart while its
 * first authoritative window is loading.
 */
export function shouldShowChartLoading({
  benchmark,
  replayOwnsChart,
  replayConnecting,
  loading,
  candleCount,
}: ChartLoadingPolicyInput): boolean {
  if (benchmark) return false;
  if (replayOwnsChart) return replayConnecting && candleCount === 0;
  return loading && candleCount === 0;
}
