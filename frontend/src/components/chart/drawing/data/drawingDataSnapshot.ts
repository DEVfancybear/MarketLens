import type { Candle, DrawingDataSnapshot, Point } from "@/types";

export type DrawingDataSnapshotMode = "anchor-to-latest" | "between-anchors";
export const MAX_DRAWING_DATA_SAMPLES = 1000;

export function buildDrawingDataSnapshot(
  mode: DrawingDataSnapshotMode,
  points: readonly Point[],
  candles: readonly Candle[],
  symbol: string,
  capturedAt = Math.floor(Date.now() / 1000),
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
  return {
    version: 1,
    symbol: symbol.trim().slice(0, 120),
    capturedAt,
    samples: selected.slice(-MAX_DRAWING_DATA_SAMPLES).map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: Math.max(0, candle.volume),
    })),
  };
}
