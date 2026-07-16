import {
  subscriptionKey,
  TF_SECONDS,
  TIMEFRAMES,
  type Candle,
  type Point,
  type Timeframe,
} from "../../../../types";
import { MAX_DRAWING_DATA_SAMPLES, type DrawingDataSnapshotMode } from "./drawingDataSnapshot";
import { selectCompleteLowerTimeframeCandidate } from "./volumeProfileDetail";

export const MAX_VOLUME_PROFILE_DETAIL_BARS = 5_000;

export interface VolumeProfileHistoryRequest {
  mode: DrawingDataSnapshotMode;
  points: readonly Point[];
  candles: readonly Candle[];
  symbol: string;
  timeframe: Timeframe;
  capturedAt: number;
}

export type VolumeProfileHistoryLoader = (request: {
  symbol: string;
  timeframe: Timeframe;
  limit: number;
  before: number;
}) => Promise<readonly Candle[]>;

async function loadFromChartHistory(
  input: Parameters<VolumeProfileHistoryLoader>[0],
): Promise<readonly Candle[]> {
  const { getHistoricalDataService } = await import(
    "../../../../services/market-data/HistoricalDataService"
  );
  return getHistoricalDataService().loadHistory(input);
}

export function volumeProfileSnapshotParents(
  request: VolumeProfileHistoryRequest,
): Candle[] {
  const first = request.points[0];
  if (!first) return [];
  const start = request.mode === "between-anchors" && request.points[1]
    ? Math.min(first.time, request.points[1].time)
    : first.time;
  const end = request.mode === "between-anchors" && request.points[1]
    ? Math.max(first.time, request.points[1].time)
    : Number.POSITIVE_INFINITY;
  return request.candles
    .filter((candle) => candle.time >= start && candle.time <= end)
    .slice(-MAX_DRAWING_DATA_SAMPLES)
    .map((candle) => ({ ...candle }));
}

/** Finest-to-coarsest lower timeframes represented by the shared market catalog. */
export function lowerTimeframeCandidates(timeframe: Timeframe): Timeframe[] {
  const parentSeconds = TF_SECONDS[timeframe];
  return TIMEFRAMES
    .filter((candidate) => TF_SECONDS[candidate] < parentSeconds)
    .sort((left, right) => TF_SECONDS[left] - TF_SECONDS[right]);
}

export function selectCachedVolumeProfileHistory(
  request: VolumeProfileHistoryRequest,
  cachedCandles: Readonly<Record<string, readonly Candle[]>>,
): Candle[] | undefined {
  const parents = volumeProfileSnapshotParents(request);
  const candidates = lowerTimeframeCandidates(request.timeframe).map((candidate) => ({
    id: candidate,
    bars: cachedCandles[subscriptionKey(request.symbol, candidate)] ?? [],
  }));
  return selectCompleteLowerTimeframeCandidate(
    parents,
    TF_SECONDS[request.timeframe],
    candidates,
    MAX_VOLUME_PROFILE_DETAIL_BARS,
  )?.bars;
}

function historyLoadCandidates(
  timeframe: Timeframe,
  parentCount: number,
): Timeframe[] {
  const all = lowerTimeframeCandidates(timeframe);
  const parentSeconds = TF_SECONDS[timeframe];
  const bounded = all.filter((candidate) =>
    parentCount * Math.ceil(parentSeconds / TF_SECONDS[candidate]) <=
      MAX_VOLUME_PROFILE_DETAIL_BARS,
  );
  // Session markets can contain far fewer bars than their wall-clock ratio.
  // If every estimate exceeds the bound, one coarsest attempt can still prove
  // completeness through exact parent-volume conservation.
  return bounded.length > 0 ? bounded : all.slice(-1);
}

/**
 * Uses the same HistoricalDataService as the chart. Candidates are attempted
 * from finest to coarsest, and only a fully-covered result is returned.
 */
export async function loadCompleteVolumeProfileHistory(
  request: VolumeProfileHistoryRequest,
  loadHistory: VolumeProfileHistoryLoader = loadFromChartHistory,
): Promise<Candle[] | undefined> {
  const parents = volumeProfileSnapshotParents(request);
  if (parents.length === 0) return undefined;
  const parentInterval = TF_SECONDS[request.timeframe];
  const rangeEnd = parents.at(-1)!.time + parentInterval;
  for (const candidate of historyLoadCandidates(request.timeframe, parents.length)) {
    try {
      const bars = await loadHistory({
        symbol: request.symbol,
        timeframe: candidate,
        limit: MAX_VOLUME_PROFILE_DETAIL_BARS,
        before: rangeEnd,
      });
      const selected = selectCompleteLowerTimeframeCandidate(
        parents,
        parentInterval,
        [{ id: candidate, bars }],
        MAX_VOLUME_PROFILE_DETAIL_BARS,
      );
      if (selected) return selected.bars;
    } catch {
      // Providers can omit individual timeframes. Continue to a coarser source;
      // the caller retains its deterministic chart-timeframe fallback.
    }
  }
  return undefined;
}
