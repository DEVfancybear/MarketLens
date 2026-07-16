import type {
  Candle,
  DrawingDataSample,
  DrawingDataSnapshot,
  DrawingDataTick,
  Point,
} from "@/types";
import { sanitizeDrawingDataSamples } from "./drawingDataSamples";
import { hasCompleteLowerTimeframeCoverage } from "./volumeProfileDetail";

export type DrawingDataSnapshotMode = "anchor-to-latest" | "between-anchors";
export const MAX_DRAWING_DATA_SAMPLES = 1000;

export interface DrawingDataSnapshotDetail {
  lowerTimeframeBars?: readonly Candle[];
  ticks?: readonly DrawingDataTick[];
  /** Oldest/newest market timestamp retained by the source tick ring. */
  tickCoverage?: Readonly<{ start: number; end: number }>;
}

function coverageContains(
  coverage: DrawingDataSnapshotDetail["tickCoverage"],
  start: number,
  end: number,
): boolean {
  return Boolean(
    coverage &&
    Number.isFinite(coverage.start) &&
    Number.isFinite(coverage.end) &&
    coverage.start <= start &&
    coverage.end >= end,
  );
}

function inferredChartInterval(candles: readonly Candle[]): number {
  const deltas = candles
    .slice(1)
    .map((candle, index) => candle.time - candles[index].time)
    .filter((delta) => Number.isFinite(delta) && delta > 0)
    .sort((a, b) => a - b);
  return deltas[0] ?? 60;
}

function attachSnapshotDetail(
  selected: readonly Candle[],
  chartCandles: readonly Candle[],
  detail: DrawingDataSnapshotDetail | undefined,
  tickRange: Readonly<{ start: number; end: number }>,
): DrawingDataSample[] {
  const interval = inferredChartInterval(chartCandles);
  const hasExplicitSubBars = detail?.lowerTimeframeBars !== undefined;
  const hasExplicitTicks = detail?.ticks !== undefined;
  const ticksCoverRange = coverageContains(
    detail?.tickCoverage,
    tickRange.start,
    tickRange.end,
  );
  const samples = selected.map((candle) => {
    const sample: DrawingDataSample = { ...(candle as DrawingDataSample) };
    const end = candle.time + interval;
    const subBars = detail?.lowerTimeframeBars?.filter(
      (bar) => bar.time >= candle.time && bar.time < end,
    );
    if (hasExplicitSubBars) {
      delete sample.subBars;
      delete sample.subBarsComplete;
    }
    if (hasExplicitSubBars && subBars?.length) {
      sample.subBars = subBars.map((bar) => ({ ...bar }));
    }
    const ticks = detail?.ticks?.filter((tick) => {
      const time = tick.time;
      return time !== undefined && time >= candle.time && time < end;
    });
    if (hasExplicitTicks) {
      delete sample.ticks;
      delete sample.ticksComplete;
    }
    if (hasExplicitTicks && ticks?.length) {
      sample.ticks = ticks.map((tick) => ({ ...tick }));
      sample.ticksComplete = ticksCoverRange;
    }
    return sample;
  });
  if (samples.some((sample) => sample.subBars?.length)) {
    const complete = hasCompleteLowerTimeframeCoverage(samples, interval);
    for (const sample of samples) {
      if (sample.subBars?.length) sample.subBarsComplete = complete;
    }
  }
  return samples;
}

export function buildDrawingDataSnapshot(
  mode: DrawingDataSnapshotMode,
  points: readonly Point[],
  candles: readonly Candle[],
  symbol: string,
  capturedAt = Math.floor(Date.now() / 1000),
  detail?: DrawingDataSnapshotDetail,
): DrawingDataSnapshot | undefined {
  if (!points[0] || candles.length === 0) return undefined;
  const start = mode === "between-anchors" && points[1]
    ? Math.min(points[0].time, points[1].time)
    : points[0].time;
  const end = mode === "between-anchors" && points[1]
    ? Math.max(points[0].time, points[1].time)
    : Number.POSITIVE_INFINITY;
  const selected = candles.filter((candle) => candle.time >= start && candle.time <= end);
  if (selected.length === 0) return undefined;
  const interval = inferredChartInterval(candles);
  const requestedTickEnd = mode === "between-anchors"
    ? Math.min(selected.at(-1)!.time + interval, capturedAt)
    : capturedAt;
  const samples = sanitizeDrawingDataSamples(
    attachSnapshotDetail(selected, candles, detail, {
      start: selected[0].time,
      end: Math.max(selected[0].time, requestedTickEnd),
    }),
    MAX_DRAWING_DATA_SAMPLES,
  );
  if (samples.length === 0) return undefined;
  return {
    version: 1,
    symbol: symbol.trim().slice(0, 120),
    capturedAt,
    // The chart normally supplies plain candles. Providers that attach
    // lower-timeframe bars or ticks keep that detail through the same bounded
    // sanitizer used by persistence decoding.
    samples,
  };
}
