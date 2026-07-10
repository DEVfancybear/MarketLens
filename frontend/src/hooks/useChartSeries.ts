"use client";

import { useMemo, useRef } from "react";
import { useAtomValue } from "jotai";
import { candlesAtom } from "@/store/chartStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import {
  createReplayCandleProjector,
  type ReplayCandleProjector,
} from "@/components/chart/replayCandlePresentation";
import type { Candle } from "@/types";

/** Live candles, or the authoritative server-revealed Replay projection. */
export function useChartSeries(): Candle[] {
  const liveCandles = useAtomValue(candlesAtom);
  const projection = useReplayClientProjection();
  const projectorRef = useRef<ReplayCandleProjector | null>(null);
  projectorRef.current ??= createReplayCandleProjector();
  const trackId = projection.snapshot?.tracks[0]?.id;
  const replayBars = trackId ? projection.barsByTrack[trackId] : undefined;

  return useMemo(() => {
    if (!trackId && projection.connection === "connecting") return [];
    if (!trackId) return liveCandles;
    return (replayBars ?? []).map(projectorRef.current!);
  }, [liveCandles, projection.connection, replayBars, trackId]);
}
