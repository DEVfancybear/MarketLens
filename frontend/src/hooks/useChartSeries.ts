"use client";

import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { candlesAtom } from "@/store/chartStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import type { Candle } from "@/types";

/** Live candles, or the authoritative server-revealed Replay projection. */
export function useChartSeries(): Candle[] {
  const liveCandles = useAtomValue(candlesAtom);
  const projection = useReplayClientProjection();

  return useMemo(() => {
    const track = projection.snapshot?.tracks[0];
    if (!track && projection.connection === "connecting") return [];
    if (!track) return liveCandles;
    return (projection.barsByTrack[track.id] ?? []).map((bar) => ({
      time: Math.floor(Date.parse(bar.time) / 1000),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
  }, [liveCandles, projection]);
}
