import type { Candle } from "@/types";
import type { ChartPaneState } from "@/store/replayLayoutStore";

const EMPTY_CANDLES: Candle[] = [];

export interface ChartSeriesSnapshot {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  source: "live" | "replay";
}

/**
 * Keep the last live frame visible while an active chart remounts as a preview.
 * A keyed market-data series replaces this fallback as soon as it is available.
 */
export function selectPaneLiveSeries(
  pane: ChartPaneState,
  current: Candle[],
  retained?: ChartSeriesSnapshot,
): Candle[] {
  if (current.length > 0) return current;
  if (
    retained?.source === "live" &&
    retained.symbol === pane.symbol &&
    retained.timeframe === pane.timeframe
  ) {
    return retained.candles;
  }
  return EMPTY_CANDLES;
}
